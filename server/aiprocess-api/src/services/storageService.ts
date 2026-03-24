import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';

// 初始化 Google Cloud Storage 客户端
const storage = new Storage({
  // 如果设置了 GOOGLE_APPLICATION_CREDENTIALS，会自动使用
  // 否则会使用默认凭据（在 Cloud Run 中自动提供）
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // 本地开发时使用
});

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'ainotebook';
const bucket = storage.bucket(BUCKET_NAME);

/**
 * 确保存储桶存在
 */
export async function ensureBucketExists() {
  try {
    const [exists] = await bucket.exists();
    if (!exists) {
      console.log(`创建存储桶: ${BUCKET_NAME}`);
      await bucket.create({
        location: process.env.GCS_BUCKET_LOCATION || 'us-central1',
        storageClass: 'STANDARD',
      });
      console.log(`存储桶 ${BUCKET_NAME} 创建成功`);
    }
  } catch (error: any) {
    // 如果存储桶已存在或其他错误，继续执行
    if (error.code !== 409) {
      console.error('检查/创建存储桶错误:', error);
    }
  }
}

/**
 * 上传文件到 Google Cloud Storage
 * @param fileBuffer 文件缓冲区
 * @param fileName 文件名
 * @param contentType MIME 类型
 * @returns 文件的公开 URL
 */
export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  contentType?: string
): Promise<string> {
  // 确保存储桶存在
  await ensureBucketExists();

  // 生成唯一文件名（添加时间戳避免冲突）
  const timestamp = Date.now();
  const uniqueFileName = `${timestamp}-${fileName}`;

  // 创建文件对象
  const file = bucket.file(uniqueFileName);

  // 上传文件
  const stream = file.createWriteStream({
    metadata: {
      contentType: contentType || 'application/octet-stream',
    },
    resumable: false,
  });

  return new Promise((resolve, reject) => {
    stream.on('error', (error: any) => {
      console.error('上传文件错误:', error);
      reject(error);
    });

    stream.on('finish', async () => {
      try {
        // 使文件公开可访问（用于音频播放）
        await file.makePublic();
        
        // 返回文件的公开 URL
        const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${uniqueFileName}`;
        console.log(`文件上传成功: ${publicUrl}`);
        resolve(publicUrl);
      } catch (error) {
        console.error('设置文件公开访问错误:', error);
        // 即使设置公开失败，也返回 URL（可能需要认证）
        const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${uniqueFileName}`;
        resolve(publicUrl);
      }
    });

    stream.end(fileBuffer);
  });
}

/**
 * 从 Google Cloud Storage 下载文件
 * @param fileUrl 文件 URL 或文件名
 * @returns 文件缓冲区
 */
export async function downloadFile(fileUrl: string): Promise<Buffer> {
  // 从 URL 中提取文件名（如果传入的是完整 URL）
  let fileName = fileUrl;
  if (fileUrl.includes(BUCKET_NAME)) {
    fileName = fileUrl.split(`${BUCKET_NAME}/`)[1] || fileUrl;
  } else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    // 从完整 URL 中提取路径
    try {
      const url = new URL(fileUrl);
      fileName = url.pathname.substring(1); // 移除开头的 /
    } catch (e) {
      // 如果解析失败，尝试直接使用
      fileName = fileUrl;
    }
  }

  const file = bucket.file(fileName);
  const [buffer] = await file.download();
  return buffer;
}

/**
 * 从 Google Cloud Storage 获取文件流（用于大文件）
 * @param fileName 文件名
 * @returns 可读流
 */
export async function getFileStream(fileName: string): Promise<Readable> {
  const file = bucket.file(fileName);
  return file.createReadStream();
}

/**
 * 删除文件
 * @param fileName 文件名或 URL
 */
export async function deleteFile(fileName: string): Promise<void> {
  try {
    // 从 URL 中提取文件名（如果传入的是完整 URL）
    let filePath = fileName;
    if (fileName.includes(BUCKET_NAME)) {
      filePath = fileName.split(`${BUCKET_NAME}/`)[1] || fileName;
    } else if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      try {
        const url = new URL(fileName);
        filePath = url.pathname.substring(1);
      } catch (e) {
        filePath = fileName;
      }
    }

    const file = bucket.file(filePath);
    await file.delete();
    console.log(`文件删除成功: ${filePath}`);
  } catch (error: any) {
    if (error.code === 404) {
      console.warn(`文件不存在: ${fileName}`);
    } else {
      console.error('删除文件错误:', error);
      throw error;
    }
  }
}

/**
 * 生成 GCS 文件的 Signed URL（用于临时授权访问）
 * @param fileUrl 文件 URL 或文件名
 * @param expiresInMinutes 有效期（分钟），默认 60 分钟
 * @returns Signed URL
 */
export async function getSignedUrl(fileUrl: string, expiresInMinutes: number = 60): Promise<string> {
  // 从 URL 中提取文件名
  let fileName = fileUrl;
  if (fileUrl.includes(BUCKET_NAME)) {
    fileName = fileUrl.split(`${BUCKET_NAME}/`)[1] || fileUrl;
  } else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
    try {
      const url = new URL(fileUrl);
      // 处理路径，移除开头的 / 和 bucket 名称
      let path = url.pathname.substring(1);
      if (path.startsWith(BUCKET_NAME + '/')) {
        path = path.substring(BUCKET_NAME.length + 1);
      }
      fileName = path;
    } catch (e) {
      fileName = fileUrl;
    }
  }

  const file = bucket.file(fileName);
  
  // 生成 Signed URL
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });

  console.log(`✅ 生成 Signed URL，有效期 ${expiresInMinutes} 分钟`);
  return signedUrl;
}

/**
 * 生成用于上传的 GCS Signed URL
 * @param fileName 文件名
 * @param contentType MIME 类型
 * @param expiresInMinutes 有效期（分钟），默认 30 分钟
 * @returns { signedUrl, fileUrl } 签名 URL 和最终的文件公开 URL
 */
export async function getUploadSignedUrl(
  fileName: string,
  contentType: string = 'audio/mpeg',
  expiresInMinutes: number = 30
): Promise<{ signedUrl: string; fileUrl: string; filePath: string }> {
  // 确保存储桶存在
  await ensureBucketExists();

  // 生成唯一文件名（添加时间戳避免冲突）
  const timestamp = Date.now();
  const uniqueFileName = `${timestamp}-${fileName}`;

  const file = bucket.file(uniqueFileName);

  // 生成用于上传的 Signed URL
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    contentType: contentType,
  });

  // 最终的公开 URL
  const fileUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${uniqueFileName}`;

  console.log(`✅ 生成 GCS 上传签名 URL，有效期 ${expiresInMinutes} 分钟`);
  
  return { signedUrl, fileUrl, filePath: uniqueFileName };
}

/**
 * 设置文件为公开可访问
 * @param filePath 文件路径（不含 bucket 名称）
 */
export async function makeFilePublic(filePath: string): Promise<void> {
  const file = bucket.file(filePath);
  await file.makePublic();
  console.log(`✅ 文件已设置为公开: ${filePath}`);
}

/**
 * 检查文件是否存在
 * @param fileName 文件名或 URL
 * @returns 是否存在
 */
export async function fileExists(fileName: string): Promise<boolean> {
  try {
    let filePath = fileName;
    if (fileName.includes(BUCKET_NAME)) {
      filePath = fileName.split(`${BUCKET_NAME}/`)[1] || fileName;
    } else if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      try {
        const url = new URL(fileName);
        filePath = url.pathname.substring(1);
      } catch (e) {
        filePath = fileName;
      }
    }
    
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    return exists;
  } catch (error) {
    console.error('检查文件存在错误:', error);
    return false;
  }
}

