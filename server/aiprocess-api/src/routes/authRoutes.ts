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
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// #region agent log
console.log('[DEBUG] Google OAuth env vars check:', {
  hasClientId: !!GOOGLE_CLIENT_ID,
  hasClientSecret: !!GOOGLE_CLIENT_SECRET,
  clientIdLength: GOOGLE_CLIENT_ID.length,
  clientSecretLength: GOOGLE_CLIENT_SECRET.length,
  frontendUrl: FRONTEND_URL,
  hypothesisId: 'A'
});
// #endregion

// 构建回调 URL - 生产环境使用 FRONTEND_URL 的域名（确保 HTTPS）
const getCallbackURL = () => {
  if (process.env.FRONTEND_URL) {
    return `${process.env.FRONTEND_URL}/api/auth/google/callback`;
  }
  // 本地开发：使用端口 8080
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
    const referer = req.headers.referer || req.headers.origin;
    let frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
    
    if (referer) {
      try {
        const url = new URL(referer);
        frontendOrigin = `${url.protocol}//${url.host}`;
      } catch (e) {
        // 使用默认值
      }
    }
    
    console.log(`🔐 OAuth 开始，来源: ${frontendOrigin}`);
    
    // 动态构建 callbackURL（生产环境从请求中推断）
    const dynamicCallbackURL = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/api/auth/google/callback`
      : `${frontendOrigin}/api/auth/google/callback`;

    console.log(`🔐 OAuth callbackURL: ${dynamicCallbackURL}`);

    // 将前端地址编码到 state 参数中
    (passport.authenticate as any)('google', {
      scope: ['profile', 'email'],
      state: Buffer.from(frontendOrigin).toString('base64'),
      callbackURL: dynamicCallbackURL,
    })(req, res, next);
  }
);

// Google OAuth 回调
router.get(
  '/google/callback',
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('Google OAuth 未配置')}`);
    }

    // 从 state 参数还原前端 origin，构建动态 callbackURL（必须和 /google 路由一致）
    let callbackOrigin = process.env.FRONTEND_URL || '';
    if (!callbackOrigin && req.query.state) {
      try {
        callbackOrigin = Buffer.from(req.query.state as string, 'base64').toString();
      } catch (e) {
        // fallback
      }
    }
    const dynamicCallbackURL = callbackOrigin
      ? `${callbackOrigin}/api/auth/google/callback`
      : getCallbackURL();

    (passport.authenticate as any)('google', { session: false, callbackURL: dynamicCallbackURL })(req, res, next);
  },
  asyncHandler(authController.handleGoogleCallback)
);

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

// 登出
router.post('/logout', authenticateToken, asyncHandler(authController.logout as any));

export default router;

