import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../utils/db';
import { generateToken, resolveAuthAccess } from '../middleware/auth';

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface GoogleProfile {
  id: string;
  emails: Array<{ value: string; verified?: boolean }>;
  displayName: string;
  photos?: Array<{ value: string }>;
}

async function createSessionForGoogleIdentity(input: {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
}) {
  const googleId = input.googleId;
  const email = input.email;
  const name = input.name || email.split('@')[0];
  const picture = input.picture;
  const access = await resolveAuthAccess(email, googleId);

  if (!access.allowed) {
    throw new Error('该账号未获授权，请联系管理员');
  }

  let user: any;

  if (access.readOnly) {
    user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: access.dataUserId },
          { id: access.dataUserId },
        ],
      },
    });

    if (!user) {
      throw new Error('只读模式未找到数据所有者，请先配置 READONLY_DATA_USER_ID/OWNER_USER_ID');
    }
  } else {
    user = await prisma.user.findUnique({
      where: { googleId },
    });

    if (!user) {
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        user = await prisma.user.update({
          where: { email },
          data: { googleId },
        });
      } else {
        user = await prisma.user.create({
          data: {
            googleId,
            email,
            name,
            picture,
          },
        });
      }
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          picture,
        },
      });
    }
  }

  const token = generateToken({
    id: user.id,
    googleId: user.googleId,
    email: access.readOnly ? email : user.email,
    name: access.readOnly ? name : user.name,
    picture: access.readOnly ? picture : user.picture,
  }, {
    role: access.role,
    readOnly: access.readOnly,
    dataUserId: access.readOnly ? (user.googleId || user.id) : undefined,
    userId: access.readOnly ? user.id : undefined,
    email: access.readOnly ? email : user.email,
    name: access.readOnly ? name : user.name,
    picture: access.readOnly ? picture : user.picture,
    actorSub: googleId,
    actorEmail: email,
  });

  return { token, user, access };
}

export async function handleGoogleCredentialLogin(req: Request, res: Response) {
  try {
    const credential = String((req.body || {}).credential || '');
    if (!credential) {
      return res.status(400).json({ success: false, error: 'Missing Google credential' });
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ success: false, error: 'Invalid Google credential' });
    }

    const { token, access } = await createSessionForGoogleIdentity({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null,
    });
    console.log(`✅ Login: ${payload.email} (${access.role}${access.source ? `/${access.source}` : ''})`);
    return res.json({ success: true, token });
  } catch (error: any) {
    console.error('Google credential 登录错误:', error);
    const status = error?.message?.includes('未获授权') ? 403 : 401;
    return res.status(status).json({
      success: false,
      error: error?.message || 'Invalid Google credential',
    });
  }
}

/**
 * Google OAuth 回调处理
 */
export async function handleGoogleCallback(req: Request, res: Response) {
  try {
    const profile = req.user as GoogleProfile;

    if (!profile || !profile.id || !profile.emails || !profile.emails[0]) {
      return res.status(400).json({
        success: false,
        error: '无法获取 Google 用户信息',
      });
    }

    const { token } = await createSessionForGoogleIdentity({
      googleId: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName || profile.emails[0].value.split('@')[0],
      picture: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
    });

    // 从 state 参数获取前端地址（OAuth 开始时保存的）
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    const state = req.query.state as string;
    if (state) {
      try {
        frontendUrl = Buffer.from(state, 'base64').toString('utf-8');
        console.log(`🔄 从 state 恢复前端地址: ${frontendUrl}`);
      } catch (e) {
        console.warn('⚠️ 无法解析 state 参数，使用默认前端地址');
      }
    }

    console.log(`🔄 OAuth 回调重定向到: ${frontendUrl}/auth/callback`);
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (error: any) {
    console.error('Google OAuth 回调错误:', error);
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    const state = req.query.state as string;
    if (state) {
      try {
        frontendUrl = Buffer.from(state, 'base64').toString('utf-8');
      } catch (e) {
        // 使用默认值
      }
    }
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(error.message)}`);
  }
}

/**
 * 获取当前用户信息
 */
export async function getCurrentUser(req: Request, res: Response) {
  const userId = (req as any).userId;
  const requestUser = (req as any).user;

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: '未认证',
    });
  }

  if ((req as any).readOnly && requestUser) {
    return res.json({
      success: true,
      data: {
        id: userId,
        email: requestUser.email,
        name: requestUser.name,
        picture: requestUser.picture || null,
        role: 'viewer',
        readOnly: true,
      },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      picture: true,
      createdAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: '用户不存在',
    });
  }

  return res.json({
    success: true,
    data: user,
  });
}

/**
 * 登出（前端处理，这里只是返回成功）
 */
export async function logout(req: Request, res: Response) {
  return res.json({
    success: true,
    message: '登出成功',
  });
}
