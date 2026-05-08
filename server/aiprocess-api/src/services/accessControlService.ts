import crypto from 'crypto';
import prisma from '../utils/db';

export type AccessRole = 'editor' | 'viewer';
export type AccessMode = 'default' | 'viewer';

export interface AuthAccess {
  allowed: boolean;
  role: AccessRole;
  readOnly: boolean;
  dataUserId: string;
  source?: 'env' | 'db' | 'google' | 'none';
}

export interface AuthAccessOptions {
  mode?: AccessMode;
}

export interface AccessRule {
  id: string;
  email: string;
  role: AccessRole;
  dataUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseEmailSet(value: string | undefined): Set<string> {
  return new Set((value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

const DEFAULT_EDITOR_EMAILS = process.env.EDITOR_EMAILS || process.env.ALLOWED_EMAILS || 'chengjiaqi1995@gmail.com,catherinefkd@gmail.com';
const EDITOR_EMAILS = parseEmailSet(DEFAULT_EDITOR_EMAILS);
const ENV_VIEWER_EMAILS = parseEmailSet(process.env.READONLY_EMAILS || process.env.VIEWER_EMAILS);
const READONLY_DATA_USER_ID = process.env.READONLY_DATA_USER_ID || process.env.OWNER_USER_ID || process.env.OPENCLAW_USER_ID || '104921709359061938941';

let accessRulesReady: Promise<void> | null = null;

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('请输入有效邮箱');
  }
  return normalized;
}

async function ensureAccessRulesTable() {
  if (!accessRulesReady) {
    accessRulesReady = prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AppAccessRule" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL UNIQUE,
        "role" TEXT NOT NULL DEFAULT 'viewer',
        "dataUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).then(() => undefined);
  }
  return accessRulesReady;
}

function normalizeRole(value: unknown): AccessRole {
  return value === 'editor' ? 'editor' : 'viewer';
}

function mapRule(row: any): AccessRule {
  return {
    id: String(row.id),
    email: normalizeEmail(row.email),
    role: normalizeRole(row.role),
    dataUserId: row.dataUserId ? String(row.dataUserId) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function isConfiguredEditorEmail(email: string): boolean {
  return EDITOR_EMAILS.has(normalizeEmail(email));
}

export function readonlyDataUserId(): string {
  return READONLY_DATA_USER_ID;
}

export async function listAccessRules(): Promise<AccessRule[]> {
  await ensureAccessRulesTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "id", "email", "role", "dataUserId", "createdAt", "updatedAt"
    FROM "AppAccessRule"
    ORDER BY "updatedAt" DESC, "email" ASC
  `);
  return rows.map(mapRule);
}

export async function upsertViewerAccessRule(email: string, dataUserId = READONLY_DATA_USER_ID): Promise<AccessRule> {
  const normalized = assertEmail(email);
  await ensureAccessRulesTable();
  const id = crypto.randomUUID();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `
      INSERT INTO "AppAccessRule" ("id", "email", "role", "dataUserId", "createdAt", "updatedAt")
      VALUES ($1, $2, 'viewer', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("email") DO UPDATE
      SET "role" = 'viewer',
          "dataUserId" = EXCLUDED."dataUserId",
          "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "email", "role", "dataUserId", "createdAt", "updatedAt"
    `,
    id,
    normalized,
    dataUserId || READONLY_DATA_USER_ID,
  );
  return mapRule(rows[0]);
}

export async function deleteAccessRule(email: string): Promise<void> {
  const normalized = assertEmail(email);
  await ensureAccessRulesTable();
  await prisma.$executeRawUnsafe(
    'DELETE FROM "AppAccessRule" WHERE "email" = $1',
    normalized,
  );
}

export async function resolveAuthAccess(email: string, googleId: string, options: AuthAccessOptions = {}): Promise<AuthAccess> {
  const normalized = normalizeEmail(email);
  const requestedViewerMode = options.mode === 'viewer';
  let dbRule: AccessRule | null = null;

  try {
    await ensureAccessRulesTable();
    const rows = await prisma.$queryRawUnsafe<any[]>(
      'SELECT "email", "role", "dataUserId" FROM "AppAccessRule" WHERE "email" = $1 LIMIT 1',
      normalized,
    );
    dbRule = rows[0] ? mapRule({ ...rows[0], id: 'rule', createdAt: new Date(), updatedAt: new Date() }) : null;
  } catch (error) {
    console.warn('读取应用内访问白名单失败，回退到环境变量:', error);
  }

  if (requestedViewerMode) {
    if (dbRule?.role === 'viewer') {
      return {
        allowed: true,
        role: 'viewer',
        readOnly: true,
        dataUserId: dbRule.dataUserId || READONLY_DATA_USER_ID,
        source: 'db',
      };
    }
    if (ENV_VIEWER_EMAILS.has(normalized)) {
      return { allowed: true, role: 'viewer', readOnly: true, dataUserId: READONLY_DATA_USER_ID, source: 'env' };
    }
    return { allowed: false, role: 'viewer', readOnly: true, dataUserId: READONLY_DATA_USER_ID, source: 'none' };
  }

  if (EDITOR_EMAILS.has(normalized)) {
    return { allowed: true, role: 'editor', readOnly: false, dataUserId: googleId, source: 'env' };
  }

  if (dbRule?.role === 'editor') {
    return { allowed: true, role: 'editor', readOnly: false, dataUserId: googleId, source: 'db' };
  }

  // Default login is the user's own workspace. Viewer allowlist only applies when
  // the user explicitly chooses viewer/read-only mode at login.
  return { allowed: true, role: 'editor', readOnly: false, dataUserId: googleId, source: 'google' };
}
