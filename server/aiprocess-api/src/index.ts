// Only load .env in development — in production (Cloud Run), env vars are set by the platform.
// Loading dotenv in production would override Cloud Run env vars (e.g. JWT_SECRET) with stale
// values from the .env file baked into the Docker image, causing auth failures.
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv/config');
}
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { createServer } from 'http';
import path from 'path';
import transcriptionRoutes from './routes/transcriptionRoutes';
import projectRoutes from './routes/projectRoutes';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import knowledgeBaseRoutes from './routes/knowledgeBaseRoutes';
import translationRoutes from './routes/translationRoutes';
import shareRoutes from './routes/shareRoutes';
import wechatWorkRoutes from './routes/wechatWorkRoutes';
import uploadRoutes from './routes/uploadRoutes';
import backupRoutes from './routes/backupRoutes';
import portfolioRoutes from './routes/portfolioRoutes';
import feedRoutes from './routes/feedRoutes';
import { initializeWebSocketServer } from './services/realtimeWebsocketService';

const app = express();
const PORT = process.env.PORT || 8080;

// 信任代理（Cloud Run 等负载均衡器使用 HTTPS，但后端接收 HTTP）
// 这让 Express 使用 X-Forwarded-Proto 头来确定实际协议
app.set('trust proxy', true);

// 中间件
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:5173'];

// CORS 配置：允许所有请求（包括 Chrome 扩展和公司网络代理修改的请求）
app.use(cors({
  origin: true, // 允许所有来源
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Origin', 'Accept', 'X-Auth-Token', 'X-Internal-API-Key'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
}));

// 调试中间件：简化日志输出（一行）
app.use((req, res, next) => {
  if (req.path.includes('/api/')) {
    console.log(`📥 ${req.method} ${req.path}`);
  }
  next();
});
// 增加 body parser 的大小限制以支持大文件上传
// 注意：实际文件上传由 multer 处理，这里主要处理其他字段（如 customPrompt）
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// 支持企业微信 XML 消息
app.use(express.text({ type: 'text/xml', limit: '1mb' }));

// Session 配置（用于 Passport）
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// 初始化 Passport
app.use(passport.initialize());
app.use(passport.session());

// #region agent log
const strategies = (passport as any)._strategies || {};
console.log('[DEBUG] Passport initialized, checking strategies:', {
  registeredStrategies: Object.keys(strategies),
  hasGoogle: !!strategies.google,
  hypothesisId: 'E'
});
// #endregion

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/transcriptions', transcriptionRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/translation', translationRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/wechat-work', wechatWorkRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/feed', feedRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'AI Transcription API is running',
    features: {
      fileUpload: true,
      realtimeTranscription: true,
      ragKnowledgeBase: true,
      aiProviders: ['gemini', 'qwen', 'qwen-realtime', 'google-speech']
    }
  });
});

// [关键代码] 放在 API 路由之后
// 1. 托管静态文件 (对应 Dockerfile 里复制的位置)
app.use(express.static(path.join(__dirname, '../public')));

// 2. 所有未匹配的路由都返回 React 的 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// 全局错误处理中间件（asyncHandler 捕获的错误会到达这里）
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err.message || err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
  });
});

// 创建HTTP服务器
const server = createServer(app);

// 初始化WebSocket服务器（用于实时转录）
initializeWebSocketServer(server);

// 启动服务器
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
