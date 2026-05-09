import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { authenticateToken } from '../middleware/auth';
import type { Request as ExpressRequest } from 'express';
import * as authController from '../controllers/authController';
import { asyncHandler } from '../middleware/asyncHandler';

const router = express.Router();

// Google OAuth 配置
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174';
const OAUTH_CALLBACK_ORIGIN =
  process.env.OAUTH_CALLBACK_ORIGIN ||
  process.env.API_PUBLIC_URL ||
  process.env.PUBLIC_API_URL ||
  '';
const LOCAL_OAUTH_CALLBACK_PATH = process.env.LOCAL_OAUTH_CALLBACK_PATH || '/api/auth/google/callback';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const firstHeaderValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0];
  return value?.split(',')[0]?.trim();
};

const isLocalOrigin = (origin: string) => {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

const getRequestOrigin = (req?: ExpressRequest) => {
  if (!req) return '';
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol || 'http';
  const host = firstHeaderValue(req.headers.host);
  return host ? `${proto}://${host}` : '';
};

const getFrontendOrigin = (req: ExpressRequest) => {
  const referer = req.headers.referer || req.headers.origin;
  let frontendOrigin = FRONTEND_URL;

  if (referer) {
    try {
      const url = new URL(referer);
      frontendOrigin = `${url.protocol}//${url.host}`;
    } catch (e) {
      // 使用默认值
    }
  }

  return trimTrailingSlash(frontendOrigin);
};

const getRequestedAccessMode = (req: ExpressRequest) => {
  return req.query.mode === 'viewer' || req.query.readOnly === '1' ? 'viewer' : 'default';
};

const getRequestedReturnTo = (req: ExpressRequest) => {
  const raw = typeof req.query.returnTo === 'string' ? req.query.returnTo : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && localHosts.has(url.hostname)) {
      return url.toString();
    }
  } catch {
    // Ignore invalid return targets.
  }
  return '';
};

const getOriginFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
};

const encodeOAuthState = (frontendOrigin: string, mode: string, returnTo?: string) => {
  return Buffer.from(JSON.stringify({ frontendOrigin, mode, returnTo })).toString('base64');
};

// #region agent log
console.log('[DEBUG] Google OAuth env vars check:', {
  hasClientId: !!GOOGLE_CLIENT_ID,
  hasClientSecret: !!GOOGLE_CLIENT_SECRET,
  clientIdLength: GOOGLE_CLIENT_ID.length,
  clientSecretLength: GOOGLE_CLIENT_SECRET.length,
  frontendUrl: FRONTEND_URL,
  oauthCallbackOrigin: OAUTH_CALLBACK_ORIGIN,
  hypothesisId: 'A'
});
// #endregion

// 构建 Google OAuth 回调 URL。
// 注意：OAuth callback 必须指向 API 服务本身；登录完成后再通过 state 回跳前端。
const getCallbackURL = (req?: ExpressRequest, frontendOrigin?: string) => {
  const configuredOrigin = OAUTH_CALLBACK_ORIGIN ? trimTrailingSlash(OAUTH_CALLBACK_ORIGIN) : '';
  if (configuredOrigin) return `${configuredOrigin}/api/auth/google/callback`;

  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && !isLocalOrigin(requestOrigin)) {
    return `${trimTrailingSlash(requestOrigin)}/api/auth/google/callback`;
  }

  if (frontendOrigin && isLocalOrigin(frontendOrigin)) {
    return `${trimTrailingSlash(frontendOrigin)}${LOCAL_OAUTH_CALLBACK_PATH}`;
  }

  // 本地完整后端开发：浏览器经 gateway 8080 进入，再由 gateway 代理到 aiprocess 8081。
  return 'http://localhost:8080/api/auth/google/callback';
};

// #region agent log
const callbackUrl = getCallbackURL();
console.log('[DEBUG] Callback URL generated:', {
  callbackUrl,
  nodeEnv: process.env.NODE_ENV,
  hypothesisId: 'D'
});
// #endregion

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  // #region agent log
  console.log('[DEBUG] Registering Google strategy:', {
    hasClientId: !!GOOGLE_CLIENT_ID,
    hasClientSecret: !!GOOGLE_CLIENT_SECRET,
    hypothesisId: 'B'
  });
  // #endregion
  // 配置 Google OAuth Strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: getCallbackURL(),
        proxy: true, // 信任代理，使用 X-Forwarded-Proto 头
        passReqToCallback: true,
      },
      async (req: any, accessToken: string, refreshToken: string, profile: any, done: any) => {
        // profile 会被传递给回调函数
        return done(null, profile);
      }
    )
  );
  // #region agent log
  console.log('[DEBUG] Google strategy registered successfully', {
    hypothesisId: 'C',
    registeredStrategies: Object.keys((passport as any)._strategies || {})
  });
  // #endregion

  // 序列化用户（用于 session，虽然我们使用 JWT，但 passport 需要这个）
  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });
} else {
  // #region agent log
  console.log('[DEBUG] Google OAuth NOT configured - strategy NOT registered:', {
    hasClientId: !!GOOGLE_CLIENT_ID,
    hasClientSecret: !!GOOGLE_CLIENT_SECRET,
    hypothesisId: 'A'
  });
  // #endregion
  console.warn('⚠️  Google OAuth 未配置，请设置 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET');
}

// Google 登录路由
router.get(
  '/google',
  (req, res, next) => {
    // #region agent log
    const strategies = (passport as any)._strategies || {};
    const hasGoogleStrategy = !!strategies.google;
    console.log('[DEBUG] Before passport.authenticate google:', {
      hasGoogleStrategy,
      registeredStrategies: Object.keys(strategies),
      hypothesisId: 'C'
    });
    // #endregion
    
    // 检查策略是否已注册
    if (!hasGoogleStrategy) {
      console.error('[ERROR] Google OAuth strategy not registered. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
      return res.status(500).json({
        success: false,
        error: 'Google OAuth 未配置。请检查服务器环境变量 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET 是否正确设置。',
      });
    }
    
    // 从 referer 获取前端地址，保存到 state 参数中
    const returnTo = getRequestedReturnTo(req);
    const frontendOrigin = returnTo ? getOriginFromUrl(returnTo) : getFrontendOrigin(req);
    
    console.log(`🔐 OAuth 开始，来源: ${frontendOrigin}`);
    
    const dynamicCallbackURL = getCallbackURL(req, frontendOrigin);

    console.log(`🔐 OAuth callbackURL: ${dynamicCallbackURL}`);

    // 将前端地址编码到 state 参数中
    (passport.authenticate as any)('google', {
      scope: ['profile', 'email'],
      state: encodeOAuthState(frontendOrigin, getRequestedAccessMode(req), returnTo || undefined),
      callbackURL: dynamicCallbackURL,
    })(req, res, next);
  }
);

// Google OAuth 回调
router.get(
  ['/google/callback', '/login2'],
  (req, res, next) => {
    // #region agent log
    const strategies = (passport as any)._strategies || {};
    const hasGoogleStrategy = !!strategies.google;
    console.log('[DEBUG] Before passport.authenticate google callback:', {
      hasGoogleStrategy,
      registeredStrategies: Object.keys(strategies),
      hypothesisId: 'C'
    });
    // #endregion
    
    // 检查策略是否已注册
    if (!hasGoogleStrategy) {
      console.error('[ERROR] Google OAuth strategy not registered in callback. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
      return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('Google OAuth 未配置')}`);
    }

    let frontendOrigin = '';
    if (req.query.state) {
      try {
        frontendOrigin = Buffer.from(req.query.state as string, 'base64').toString();
      } catch (e) {
        // fallback
      }
    }
    const dynamicCallbackURL = getCallbackURL(req, frontendOrigin || undefined);

    (passport.authenticate as any)('google', { session: false, callbackURL: dynamicCallbackURL })(req, res, next);
  },
  asyncHandler(authController.handleGoogleCallback)
);

// Google One Tap / Credential 登录。Gateway 会把 /api/auth/login 代理到这里，
// 这样登录授权可以读取数据库里的只读访问白名单。
router.post('/login', asyncHandler(authController.handleGoogleCredentialLogin as any));

// 开发环境专用登录（绕过 Google OAuth，不依赖数据库）
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev-login', asyncHandler(async (req, res) => {
    const email = req.body.email || 'dev@localhost.com';
    const name = req.body.name || 'Dev User';
    const { generateToken } = await import('../middleware/auth');

    // 尝试从数据库查找/创建用户，失败则用模拟数据
    let userData = { id: 'dev-local-user', email, name, picture: null as string | null };
    try {
      const prisma = (await import('../utils/db')).default;
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: { googleId: `dev-${Date.now()}`, email, name, picture: null },
        });
      }
      userData = { id: user.id, email: user.email, name: user.name, picture: user.picture };
    } catch (e) {
      console.warn('⚠️ 数据库不可用，使用模拟用户数据');
    }

    const token = generateToken({ id: userData.id, email: userData.email, name: userData.name });
    console.log(`🔧 Dev login: ${email}`);
    return res.json({ success: true, token, user: userData });
  }));
}

// 获取当前用户信息（需要认证）
router.get('/me', authenticateToken, asyncHandler(authController.getCurrentUser as any));

// 已登录用户切换“自己的空间 / Jiaqi 只读”访问模式
router.post('/switch-mode', authenticateToken, asyncHandler(authController.switchAccessMode as any));

// 登出
router.post('/logout', authenticateToken, asyncHandler(authController.logout as any));

export default router;
