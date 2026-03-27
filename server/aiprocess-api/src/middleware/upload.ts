import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadFile } from '../services/storageService';
import { compressAudio } from '../services/aiService';

// 本地上传目录
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 根据环境选择存储方式
const isProduction = process.env.NODE_ENV === 'production';

// 本地存储配置 — also used in production to avoid holding large files in memory
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

// 文件过滤器
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/ogg',
    'audio/webm',
    'audio/flac',
    'audio/aac',
  ];

  if (allowedMimeTypes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|ogg|webm|flac|aac)$/i)) {
    cb(null, true);
  } else {
    cb(new Error('只支持音频文件格式: MP3, WAV, M4A, OGG, WEBM, FLAC, AAC'));
  }
};

// 配置 multer - 本地开发用磁盘存储，生产环境用内存存储（然后上传到 GCS）
// 文件大小限制：默认 500MB，可通过环境变量 MAX_FILE_SIZE 配置（单位：字节）
// 500MB = 524288000 字节
// Always use disk storage to avoid holding large files in memory (prevents OOM on Cloud Run)
const upload = multer({
  storage: diskStorage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '524288000'), // 默认500MB
  },
});

// 中间件：上传文件到 GCS（仅生产环境使用），并在上传前压缩音频文件
export const uploadToGCS = async (req: any, res: any, next: any) => {
  if (!req.file) {
    return next();
  }

  // 本地开发环境：压缩后保存到本地
  if (!isProduction) {
    try {
      const originalSize = req.file.size;
      const originalExt = path.extname(req.file.originalname).toLowerCase() || '.mp3';
      const originalPath = req.file.path;
      
      console.log(`📁 本地开发模式：压缩音频文件 (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);
      
      // 读取原始文件
      const originalBuffer = fs.readFileSync(originalPath);
      
      // 压缩音频文件
      let compressedBuffer: Buffer;
      try {
        compressedBuffer = await compressAudio(originalBuffer, originalExt, 15);
        console.log(`✅ 压缩完成: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
      } catch (compressError: any) {
        console.warn('压缩失败，使用原始文件:', compressError.message);
        compressedBuffer = originalBuffer;
      }
      
      // 如果压缩成功，替换原始文件
      if (compressedBuffer.length < originalSize) {
        // 更新文件扩展名为 .mp3（压缩后统一为 mp3）
        const newPath = originalPath.replace(originalExt, '.mp3');
        fs.writeFileSync(newPath, compressedBuffer);
        
        // 删除原始文件（如果路径不同）
        if (newPath !== originalPath && fs.existsSync(originalPath)) {
          fs.unlinkSync(originalPath);
        }
        
        // 更新 req.file 信息
        req.file.path = newPath;
        req.file.size = compressedBuffer.length;
        req.file.filename = path.basename(newPath);
      }
      
      console.log('📁 本地开发模式：文件保存到', req.file.path);
      return next();
    } catch (error: any) {
      console.error('本地文件压缩错误:', error);
      // 压缩失败时继续使用原始文件
      return next();
    }
  }

  // 生产环境：从磁盘读取 → 压缩 → 上传到 GCS → 清理临时文件
  try {
    // 解码文件名（Multer 使用 Latin-1 编码，需要转换为 UTF-8）
    let decodedFileName = req.file.originalname;
    try {
      decodedFileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      if (decodedFileName.includes('')) {
        decodedFileName = req.file.originalname;
      }
    } catch (e) {
      decodedFileName = req.file.originalname;
    }

    const originalPath = req.file.path;
    const originalSize = req.file.size;
    const originalExt = path.extname(decodedFileName).toLowerCase() || '.mp3';

    console.log(`📁 生产环境：压缩音频文件 (${(originalSize / 1024 / 1024).toFixed(2)}MB)`);

    // Read from disk instead of memory buffer
    const originalBuffer = fs.readFileSync(originalPath);

    // 压缩音频文件
    let compressedBuffer: Buffer;
    try {
      compressedBuffer = await compressAudio(originalBuffer, originalExt, 15);
      console.log(`✅ 压缩完成: ${(originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    } catch (compressError: any) {
      console.warn('压缩失败，使用原始文件:', compressError.message);
      compressedBuffer = originalBuffer;
    }

    // 更新文件名扩展名为 .mp3（压缩后统一为 mp3）
    const compressedFileName = decodedFileName.replace(originalExt, '.mp3');

    // 上传压缩后的文件到 GCS
    const fileUrl = await uploadFile(
      compressedBuffer,
      compressedFileName,
      'audio/mpeg' // 压缩后统一为 mp3 格式
    );

    // Clean up temp file from disk
    try { fs.unlinkSync(originalPath); } catch { /* ignore */ }

    // 将 GCS URL 保存到 req.file.path（保持兼容性）
    req.file.path = fileUrl;
    req.file.gcsUrl = fileUrl;
    req.file.size = compressedBuffer.length; // 更新为压缩后的文件大小

    next();
  } catch (error: any) {
    console.error('上传到 GCS 错误:', error);
    return res.status(500).json({
      success: false,
      error: '文件上传失败: ' + error.message,
    });
  }
};

export default upload;
