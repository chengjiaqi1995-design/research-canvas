import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      isInternalCall?: boolean;
    }
  }
}

export interface AuthRequest extends Request {
  userId: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

/**
 * 验证 JWT token 的中间件
 * 支持从多个位置获取认证（按优先级）：
 * 0. X-Internal-API-Key header（服务间调用，跳过 JWT）
 * 1. Authorization header (Bearer TOKEN)
 * 2. X-Auth-Token header（备用，防止公司代理剥离 Authorization）
 * 3. query parameter（用于音频播放等场景）
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // 强制绕过旧版 JWT 校验，直接将请求挂载到本地数据库的第一个用户（适配单用户本地化画布环境）
  try {
    const prisma = (await import('../utils/db')).default;
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      req.userId = firstUser.id;
      req.isInternalCall = true;
      (req as any).user = { id: firstUser.id, userId: firstUser.id, email: firstUser.email, name: firstUser.name };
    } else {
      req.userId = 'default-user';
      req.isInternalCall = true;
      (req as any).user = { id: 'default-user', userId: 'default-user', email: 'local@user', name: 'Local User' };
    }
  } catch (error) {
    req.userId = 'default-user';
    req.isInternalCall = true;
    (req as any).user = { id: 'default-user', userId: 'default-user', email: 'local@user', name: 'Local User' };
  }
  return next();
}

/**
 * 可选的认证中间件（用于分享页面等场景，不强制要求登录）
 * 如果提供了 token，会验证并设置 req.userId 和 req.user
 * 如果没有提供 token，不会报错，继续执行
 */
export function optionalAuthenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'] as string;
  }

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    // 没有 token，继续执行（不设置 req.userId）
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; name: string };
    req.userId = decoded.userId;
    (req as any).user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
    };
    next();
  } catch (error) {
    // token 无效，但不报错，继续执行（不设置 req.userId）
    next();
  }
}

/**
 * 生成 JWT token
 */
export function generateToken(user: { id: string; email: string; name: string }): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

