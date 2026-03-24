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
  // 1. 拦截服务间调用（跳过 JWT）
  if (req.headers['x-internal-api-key'] === INTERNAL_API_KEY) {
    req.isInternalCall = true;
    return next();
  }

  // 2. 解析 JWT Token
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.headers['x-auth-token']) token = req.headers['x-auth-token'] as string;
  if (!token && req.query.token) token = req.query.token as string;

  if (!token) {
    return res.status(401).json({ success: false, error: '未提供认证Token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string; email?: string; name?: string; picture?: string };
    const userId = decoded.sub || decoded.userId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Token中缺少用户ID' });
    }

    req.userId = userId;
    req.isInternalCall = false;
    (req as any).user = { id: userId, email: decoded.email, name: decoded.name };

    // 3. 确保用户在数据库中存在（因为主后端不走 Prisma，只有本服务用，需要在此同步）
    const prisma = (await import('../utils/db')).default;
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: userId,
          googleId: userId,
          email: decoded.email || `${userId}@placeholder.com`,
          name: decoded.name || 'User',
          picture: decoded.picture || null,
        }
      });
      console.log(`👤 自动同步新用户至 AI 数据库: ${userId}`);
    }

    return next();
  } catch (error) {
    console.error('JWT 验证失败:', error instanceof Error ? error.message : 'Unknown');
    return res.status(401).json({ success: false, error: 'Token 无效或已过期' });
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
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string; email?: string; name?: string };
    const userId = decoded.sub || decoded.userId;
    if (userId) {
      req.userId = userId;
      (req as any).user = { id: userId, email: decoded.email, name: decoded.name };
    }
  } catch (error) {
    // 忽略无效Token
  }
  next();
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

