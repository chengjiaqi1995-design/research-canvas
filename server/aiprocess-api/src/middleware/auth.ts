import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import {
  readonlyDataUserId,
  resolveAuthAccess,
  type AccessRole as AuthRole,
} from '../services/accessControlService';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      isInternalCall?: boolean;
      readOnly?: boolean;
      userRole?: 'editor' | 'viewer';
      actorSub?: string;
      actorEmail?: string;
    }
  }
}

export interface AuthRequest extends Request {
  userId: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const READONLY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface SessionTokenOptions {
  role?: AuthRole;
  readOnly?: boolean;
  dataUserId?: string;
  userId?: string;
  email?: string;
  name?: string;
  picture?: string | null;
  actorSub?: string;
  actorEmail?: string;
}

export { resolveAuthAccess };

function isAllowedReadOnlyAction(req: Request): boolean {
  const fullPath = `${req.baseUrl || ''}${req.path || ''}`;
  if (req.method === 'POST' && fullPath === '/api/auth/logout') return true;
  if (req.method === 'POST' && fullPath === '/api/knowledge-base/search') return true;
  if (req.method === 'POST' && /^\/api\/feed\/[^/]+\/reference\/[^/]+$/.test(fullPath)) return true;
  return false;
}

export function requireEditor(req: Request, res: Response, next: NextFunction) {
  if (req.readOnly) {
    return res.status(403).json({
      success: false,
      error: '只读模式不能更改内容。请使用编辑账号登录后再操作。',
      readOnly: true,
    });
  }
  next();
}

export function requireEditorForWrite(req: Request, res: Response, next: NextFunction) {
  if (!req.readOnly) return next();
  if (READONLY_SAFE_METHODS.has(req.method) || isAllowedReadOnlyAction(req)) return next();
  return res.status(403).json({
    success: false,
    error: '只读模式不能更改内容。请使用编辑账号登录后再操作。',
    readOnly: true,
  });
}

/**
 * 验证 JWT token 的中间件
 * 支持从多个位置获取认证（按优先级）：
 * 0. X-Internal-API-Key header（服务间调用，跳过 JWT）
 * 1. Authorization header (Bearer TOKEN)
 * 2. X-Auth-Token header（备用，防止公司代理剥离 Authorization）
 * 3. query parameter（用于音频播放等场景）
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // 1. 拦截服务间调用（跳过 JWT）
  if (INTERNAL_API_KEY && req.headers['x-internal-api-key'] === INTERNAL_API_KEY) {
    const internalUserId = Array.isArray(req.headers['x-user-id'])
      ? req.headers['x-user-id'][0]
      : req.headers['x-user-id'];
    req.isInternalCall = true;
    if (typeof internalUserId === 'string' && internalUserId.trim()) {
      req.userId = internalUserId.trim();
      (req as any).user = { id: req.userId, email: 'internal@research-canvas', name: 'Internal Service' };
    }
    req.userRole = 'editor';
    req.readOnly = false;
    return next();
  }

  // 2. OpenClaw API key: 映射到 Jiaqi 的真实 Google 账号
  const authHeader = req.headers['authorization'];
  const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';
  const OPENCLAW_USER_ID = process.env.OPENCLAW_USER_ID || readonlyDataUserId();
  if (OPENCLAW_API_KEY && authHeader === `Bearer ${OPENCLAW_API_KEY}`) {
    req.userId = OPENCLAW_USER_ID;
    req.isInternalCall = false;
    req.userRole = 'editor';
    req.readOnly = false;
    (req as any).user = { id: OPENCLAW_USER_ID, email: 'jiaqi@openclaw', name: 'Jiaqi (OpenClaw)' };
    return next();
  }

  // 3. Local dev: dev-token bypass
  if (authHeader === 'Bearer dev-token') {
    req.userId = 'dev-local';
    req.isInternalCall = false;
    req.userRole = 'editor';
    req.readOnly = false;
    (req as any).user = { id: 'dev-local', email: 'dev@localhost', name: 'Dev User' };
    // Ensure dev user exists in DB
    try {
      const prisma = (await import('../utils/db')).default;
      const existing = await prisma.user.findUnique({ where: { id: 'dev-local' }, select: { id: true } });
      if (!existing) {
        await prisma.user.create({
          data: { id: 'dev-local', googleId: 'dev-local', email: 'dev@localhost', name: 'Dev User' }
        });
        console.log('👤 Created dev-local user in database');
      }
    } catch (e) {
      // non-blocking
    }
    return next();
  }

  // 3. 解析 JWT Token
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.headers['x-auth-token']) token = req.headers['x-auth-token'] as string;
  if (!token && req.query.token) token = req.query.token as string;

  if (!token) {
    return res.status(401).json({ success: false, error: '未提供认证Token' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as {
      sub?: string;
      userId?: string;
      email?: string;
      name?: string;
      picture?: string;
      role?: AuthRole;
      readOnly?: boolean;
      actorSub?: string;
      actorEmail?: string;
    };
  } catch (error) {
    console.error('JWT 验证失败:', error instanceof Error ? error.message : 'Unknown');
    return res.status(401).json({ success: false, error: 'Token 无效或已过期' });
  }

  const isReadOnly = decoded.readOnly === true || decoded.role === 'viewer';
  const tokenUserId = isReadOnly ? (decoded.userId || decoded.sub) : (decoded.sub || decoded.userId);

  if (!tokenUserId) {
    return res.status(401).json({ success: false, error: 'Token中缺少用户ID' });
  }

  req.userId = tokenUserId;
  req.isInternalCall = false;
  req.userRole = isReadOnly ? 'viewer' : 'editor';
  req.readOnly = isReadOnly;
  req.actorSub = decoded.actorSub || decoded.sub;
  req.actorEmail = decoded.actorEmail || decoded.email;
  (req as any).user = {
    id: tokenUserId,
    email: decoded.email,
    name: decoded.name,
    picture: decoded.picture,
    role: req.userRole,
    readOnly: isReadOnly,
    actorSub: req.actorSub,
    actorEmail: req.actorEmail,
  };

  try {
    // 3. 确保用户在数据库中存在
    const prisma = (await import('../utils/db')).default;
    let existingUser = await prisma.user.findUnique({
      where: { id: tokenUserId },
      select: { id: true, googleId: true, email: true, name: true, picture: true }
    });

    if (!existingUser) {
      existingUser = await prisma.user.findUnique({
        where: { googleId: tokenUserId },
        select: { id: true, googleId: true, email: true, name: true, picture: true }
      });
    }

    if (!existingUser && !isReadOnly && decoded.email) {
      // 检查邮箱是否已被占用（防止 @unique 报错）
      existingUser = await prisma.user.findUnique({
        where: { email: decoded.email },
        select: { id: true, googleId: true, email: true, name: true, picture: true }
      });
      if (existingUser) {
        // 更新现有账号的 googleId
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId: tokenUserId }
        });
        // 覆盖为已有的 DB 用户 ID
        req.userId = existingUser.id;
        (req as any).user = {
          id: existingUser.id,
          email: decoded.email || existingUser.email,
          name: decoded.name || existingUser.name,
          picture: decoded.picture || existingUser.picture,
          role: req.userRole,
          readOnly: isReadOnly,
          actorSub: req.actorSub,
          actorEmail: req.actorEmail,
        };
      }
    }

    if (existingUser && req.userId !== existingUser.id) {
      req.userId = existingUser.id;
      (req as any).user = {
        id: existingUser.id,
        email: decoded.email || existingUser.email,
        name: decoded.name || existingUser.name,
        picture: decoded.picture || existingUser.picture,
        role: req.userRole,
        readOnly: isReadOnly,
        actorSub: req.actorSub,
        actorEmail: req.actorEmail,
      };
    }

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: tokenUserId,
          googleId: tokenUserId,
          email: isReadOnly
            ? `readonly-owner-${tokenUserId}@placeholder.local`
            : decoded.email || `${tokenUserId}@placeholder.com`,
          name: isReadOnly ? 'Read-only Data Owner' : decoded.name || 'User',
          picture: decoded.picture || null,
        }
      });
      console.log(`👤 自动同步新用户至 AI 数据库: ${tokenUserId}`);
    }

    return next();
  } catch (error) {
    console.error('🔥 数据库同步用户失败（请求将继续）:', error instanceof Error ? error.message : error);
    // JWT 验证已通过，用户身份已确认。数据库同步失败不应阻塞请求。
    // 让后续路由处理器自行决定是否需要数据库。
    return next();
  }
}

/**
 * 可选的认证中间件（用于分享页面等场景，不强制要求登录）
 * 如果提供了 token，会验证并设置 req.userId 和 req.user
 * 如果没有提供 token，不会报错，继续执行
 */
export function optionalAuthenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.headers['x-auth-token']) token = req.headers['x-auth-token'] as string;
  if (!token && req.query.token) token = req.query.token as string;

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string; email?: string; name?: string; role?: AuthRole; readOnly?: boolean };
    const isReadOnly = decoded.readOnly === true || decoded.role === 'viewer';
    const userId = isReadOnly ? (decoded.userId || decoded.sub) : (decoded.sub || decoded.userId);
    if (userId) {
      req.userId = userId;
      req.userRole = isReadOnly ? 'viewer' : 'editor';
      req.readOnly = req.userRole === 'viewer';
      req.actorSub = (decoded as any).actorSub || decoded.sub;
      req.actorEmail = (decoded as any).actorEmail || decoded.email;
      (req as any).user = {
        id: userId,
        email: decoded.email,
        name: decoded.name,
        role: req.userRole,
        readOnly: req.readOnly,
        actorSub: req.actorSub,
        actorEmail: req.actorEmail,
      };
    }
  } catch (error) {
    // 忽略无效Token
  }
  next();
}

/**
 * 生成 JWT token
 */
export function generateToken(
  user: { id: string; email: string; name: string; googleId?: string | null; picture?: string | null },
  options: SessionTokenOptions = {}
): string {
  const role = options.role || 'editor';
  const readOnly = options.readOnly === true || role === 'viewer';
  const dataUserId = options.dataUserId || user.googleId || user.id;
  const tokenUserId = options.userId || user.id;
  const tokenEmail = options.email || user.email;
  const tokenName = options.name || user.name;
  return jwt.sign(
    {
      // Canvas/GCS data is keyed by Google subject; AI Process data is keyed by DB user id.
      sub: dataUserId,
      userId: tokenUserId,
      googleId: dataUserId,
      email: tokenEmail,
      name: tokenName,
      picture: options.picture ?? user.picture ?? null,
      role,
      readOnly,
      actorSub: options.actorSub || user.googleId || user.id,
      actorEmail: options.actorEmail || tokenEmail,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
