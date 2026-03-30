import { Router } from 'express';
import upload, { uploadToGCS } from '../middleware/upload';
import { authenticateToken } from '../middleware/auth';
import * as transcriptionController from '../controllers/transcription';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// 调试中间件：简化日志（一行）
router.use((req, res, next) => {
  console.log(`🔍 转录: ${req.method} ${req.path}`);
  next();
});

// 所有路由都需要认证
router.use(authenticateToken as any);

// 创建转录（上传音频）- 先上传到内存，然后上传到 GCS
// 添加错误处理中间件来捕获文件大小限制错误
router.post('/', (req, res, next) => {
  upload.single('audio')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE || '524288000') / (1024 * 1024);
        return res.status(413).json({
          success: false,
          error: `文件太大。最大允许大小：${maxSizeMB}MB。请压缩文件或使用更小的文件。`,
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || '文件上传失败',
      });
    }
    next();
  });
}, uploadToGCS, asyncHandler(transcriptionController.createTranscription));

// 诊断接口：检查数据统计和数据库连接
router.get('/diagnostics', asyncHandler(transcriptionController.getDiagnostics));

// 获取转录列表
router.get('/', asyncHandler(transcriptionController.getTranscriptions));

// 从文本创建笔记 (Chrome 扩展使用) - 必须在 /:id 路由之前
router.post('/from-text', asyncHandler(transcriptionController.createFromText));

// 导入 Markdown 笔记 (批量) - 必须在 /:id 路由之前
router.post('/import-md', asyncHandler(transcriptionController.importMarkdown));

// 通过文件 URL 创建转录（Signed URL 直传方案）- 必须在 /:id 路由之前
router.post('/from-url', asyncHandler(transcriptionController.createTranscriptionFromUrl));

// 创建合并历史 - 必须在 /:id 路由之前，否则会被 /:id 拦截
router.post('/merge', asyncHandler(transcriptionController.createMergeHistory));

// 生成周度总结 - 必须在 /:id 路由之前
router.post('/generate-weekly', asyncHandler(transcriptionController.generateWeeklySummaryController));

// 周报设置（Skill + Prompts）
router.get('/weekly-settings', asyncHandler(transcriptionController.getWeeklySettings));
router.put('/weekly-settings', asyncHandler(transcriptionController.updateWeeklySettings));

// 获取 Directory 页面数据（轻量级） - 必须在 /:id 路由之前
router.get('/directory', asyncHandler(transcriptionController.getDirectoryData));

// Canvas 同步：获取未同步的已完成转录 - 必须在 /:id 路由之前
router.get('/unsynced-for-canvas', asyncHandler(transcriptionController.getUnsyncedForCanvas));

// Canvas 同步：批量标记已同步
router.post('/mark-synced-to-canvas', asyncHandler(transcriptionController.markSyncedToCanvas));

// 批量重新分类行业 - 必须在 /:id 路由之前
router.post('/reclassify-industries', asyncHandler(transcriptionController.reclassifyIndustries));

// 批量归一化公司名称 - 必须在 /:id 路由之前
router.post('/normalize-companies', asyncHandler(transcriptionController.normalizeCompanies));

// 手动覆盖公司行业归属
router.put('/update-industry', asyncHandler(transcriptionController.updateOrganizationIndustry));

// 获取单个转录
router.get('/:id', asyncHandler(transcriptionController.getTranscription));

// 更新转录总结
router.patch('/:id/summary', asyncHandler(transcriptionController.updateTranscriptionSummary));

// 更新转录中文总结
router.patch('/:id/translated-summary', asyncHandler(transcriptionController.updateTranscriptionTranslatedSummary));

// 更新转录文件名
router.patch('/:id/file-name', asyncHandler(transcriptionController.updateTranscriptionFileName));

// 更新转录标签
router.patch('/:id/tags', asyncHandler(transcriptionController.updateTranscriptionTags));

// 更新转录实际发生日期
router.patch('/:id/actual-date', asyncHandler(transcriptionController.updateTranscriptionActualDate));

// 更新转录所属项目
router.patch('/:id/project', asyncHandler(transcriptionController.updateTranscriptionProject));

// 更新转录元数据（主题、机构、参与人、发生时间）
// 注意：必须在 /:id 路由之后，但 Express 会按 HTTP 方法匹配，所以没问题
router.patch('/:id/metadata', asyncHandler(transcriptionController.updateTranscriptionMetadata));

// 删除转录
router.delete('/:id', asyncHandler(transcriptionController.deleteTranscription));

// 重新生成总结
router.post('/:id/regenerate-summary', asyncHandler(transcriptionController.regenerateSummary));

// 强制重新处理转录
router.post('/:id/reprocess', asyncHandler(transcriptionController.reprocessTranscription));

// 获取音频文件
router.get('/:id/audio', asyncHandler(transcriptionController.getAudioFile));

// 上传音频文件到已存在的转录记录（用于实时录音）
router.post('/:id/upload-audio', (req, res, next) => {
  upload.single('audio')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxSizeMB = parseInt(process.env.MAX_FILE_SIZE || '524288000') / (1024 * 1024);
        return res.status(413).json({
          success: false,
          error: `文件太大。最大允许大小：${maxSizeMB}MB。请压缩文件或使用更小的文件。`,
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || '文件上传失败',
      });
    }
    next();
  });
}, uploadToGCS, asyncHandler(transcriptionController.uploadAudioToTranscription));

export default router;
