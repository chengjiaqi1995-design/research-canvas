import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../utils/db';
import { generateToken, resolveAuthAccess } from '../middleware/auth';
import { readonlyOwnerEmail } from '../services/accessControlService';

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

function decodeOAuthState(state: string | undefined): { frontendOrigin?: string; mode: 'default' | 'viewer' } {
  if (!state) return { mode: 'default' };
  try {
    const decodedState = Buffer.from(state, 'base64').toString('utf-8');
    try {
      const parsedState = JSON.parse(decodedState);
      if (parsedState && typeof parsedState === 'object') {
        return {
          frontendOrigin: typeof parsedState.frontendOrigin === 'string' ? parsedState.frontendOrigin : undefined,
          mode: parsedState.mode === 'viewer' ? 'viewer' : 'default',
        };
      }
    } catch {
      // Legacy OAuth state was just the frontend origin string.
    }
    return { frontendOrigin: decodedState, mode: 'default' };
  } catch {
    return { mode: 'default' };
  }
}

async function createSessionForGoogleIdentity(input: {
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
  mode?: 'default' | 'viewer';
}) {
  const googleId = input.googleId;
  const email = input.email;
  const name = input.name || email.split('@')[0];
  const picture = input.picture;
  const access = await resolveAuthAccess(email, googleId, { mode: input.mode });

  if (!access.allowed) {
    if (input.mode === 'viewer') {
      throw new Error('该账号没有只读访问权限，请先让管理员在活动监控盘添加该邮箱');
    }
    throw new Error('该账号未获授权，请联系管理员');
  }

  let user: any;

  if (access.readOnly) {
    const ownerEmail = readonlyOwnerEmail();
    const ownerCandidates = await prisma.user.findMany({
      where: {
        OR: [
          ...(ownerEmail ? [{ email: ownerEmail }] : []),
          { googleId: access.dataUserId },
          { id: access.dataUserId },
        ],
      },
      select: {
        id: true,
        googleId: true,
        email: true,
        name: true,
        picture: true,
        _count: {
          select: {
            transcriptions: true,
            portfolioPositions: true,
            feedItems: true,
          },
        },
      },
    });

    user = ownerCandidates
      .map((candidate: any) => {
        const contentScore =
          (candidate._count?.transcriptions || 0) +
          (candidate._count?.portfolioPositions || 0) +
          (candidate._count?.feedItems || 0);
        const identityScore =
          candidate.googleId === access.dataUserId ? 3 :
          candidate.id === access.dataUserId ? 2 :
          ownerEmail && candidate.email === ownerEmail ? 1 : 0;
        return { ...candidate, _readonlyScore: contentScore * 10 + identityScore };
      })
      .sort((a: any, b: any) => b._readonlyScore - a._readonlyScore)[0] || null;

    if (!user) {
      throw new Error('只读模式未找到数据所有者，请先配置 READONLY_DATA_USER_ID/OWNER_USER_ID');
    }
    console.log(`🔐 Read-only mapping: actor=${email}, canvasUser=${access.dataUserId}, dbUser=${user.id}, owner=${user.email}`);
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
    dataUserId: access.readOnly ? access.dataUserId : undefined,
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
    const mode = req.body?.mode === 'viewer' || req.body?.readOnly === true ? 'viewer' : 'default';
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
      mode,
    });
    console.log(`✅ Login: ${payload.email} (${access.role}${access.source ? `/${access.source}` : ''})`);
    return res.json({ success: true, token });
  } catch (error: any) {
    console.error('Google credential 登录错误:', error);
    const status = error?.message?.includes('未获授权') || error?.message?.includes('只读访问权限') ? 403 : 401;
    return res.status(status).json({
      success: false,
      error: error?.message || 'Invalid Google credential',
    });
  }
}

export async function switchAccessMode(req: Request, res: Response) {
  try {
    const mode = req.body?.mode === 'viewer' ? 'viewer' : 'default';
    const requestUser = (req as any).user || {};
    const actorSub = (req as any).actorSub || requestUser.actorSub || requestUser.id;
    const actorEmail = (req as any).actorEmail || requestUser.actorEmail || requestUser.email;

    if (!actorSub || !actorEmail) {
      return res.status(400).json({
        success: false,
        error: '当前会话缺少 Google 身份，无法切换模式。请退出后重新登录。',
      });
    }

    const { token, access } = await createSessionForGoogleIdentity({
      googleId: String(actorSub),
      email: String(actorEmail),
      name: requestUser.name || String(actorEmail).split('@')[0],
      picture: requestUser.picture || null,
      mode,
    });

    console.log(`🔁 Switch mode: ${actorEmail} -> ${access.role}${access.source ? `/${access.source}` : ''}`);
    return res.json({ success: true, token, mode, readOnly: access.readOnly });
  } catch (error: any) {
    console.error('切换访问模式失败:', error);
    const status = error?.message?.includes('只读访问权限') || error?.message?.includes('未获授权') ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: error?.message || '切换访问模式失败',
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

    const decodedState = decodeOAuthState(req.query.state as string | undefined);

    const { token } = await createSessionForGoogleIdentity({
      googleId: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName || profile.emails[0].value.split('@')[0],
      picture: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
      mode: decodedState.mode,
    });

    // 从 state 参数获取前端地址（OAuth 开始时保存的）
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    if (decodedState.frontendOrigin) {
      frontendUrl = decodedState.frontendOrigin;
      console.log(`🔄 从 state 恢复前端地址: ${frontendUrl}`);
    }

    console.log(`🔄 OAuth 回调重定向到: ${frontendUrl}/auth/callback`);
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (error: any) {
    console.error('Google OAuth 回调错误:', error);
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
    const decodedState = decodeOAuthState(req.query.state as string | undefined);
    if (decodedState.frontendOrigin) {
      frontendUrl = decodedState.frontendOrigin;
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
