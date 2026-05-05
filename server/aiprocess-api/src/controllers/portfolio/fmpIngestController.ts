import { Request, Response } from 'express';
import prisma from '../../utils/db';
import { runFmpPortfolioIngest, type FmpIngestMode } from '../../services/fmpPortfolioIngestService';

function isOpenClawRequest(req: Request): boolean {
  const key = process.env.OPENCLAW_API_KEY || '';
  return Boolean(key && req.headers.authorization === `Bearer ${key}`);
}

function isAllowed(req: Request): boolean {
  return Boolean(req.isInternalCall || isOpenClawRequest(req) || process.env.NODE_ENV !== 'production');
}

async function resolveTargetUserId(req: Request): Promise<string> {
  if (req.userId) return req.userId;
  if (req.isInternalCall && req.body?.targetUserId) return String(req.body.targetUserId);
  const firstUser = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (!firstUser) {
    const err = new Error('No users found for FMP ingest');
    (err as any).status = 404;
    throw err;
  }
  return firstUser.id;
}

function normalizeMode(value: unknown): FmpIngestMode {
  return value === 'news' || value === 'transcripts' || value === 'all' ? value : 'all';
}

export async function run(req: Request, res: Response) {
  if (!isAllowed(req)) {
    return res.status(403).json({ success: false, error: 'FMP ingest is restricted to internal/admin callers' });
  }
  const userId = await resolveTargetUserId(req);
  const mode = normalizeMode(req.body?.mode);
  const data = await runFmpPortfolioIngest(userId, mode);
  return res.json({ success: true, data });
}
