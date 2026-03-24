import OSS from 'ali-oss';

/**
 * 阿里云OSS存储服务 - 简化版
 * 统一使用新加坡 OSS，用于所有转录模型
 */

// OSS客户端配置
let ossClient: OSS | null = null;

/**
 * 新加坡区域 OSS 配置
 */
const OSS_CONFIG = {
  region: 'oss-ap-southeast-1',
  accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
  bucket: 'cjq-ainote',
};

/**
 * 初始化OSS客户端
 */
function getOSSClient(): OSS {
  if (!ossClient) {
    // 优先使用环境变量，如果没有则使用硬编码配置
    const region = process.env.ALIYUN_OSS_REGION || OSS_CONFIG.region;
    const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID || OSS_CONFIG.accessKeyId;
    const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || OSS_CONFIG.accessKeySecret;
    const bucket = process.env.ALIYUN_OSS_BUCKET || OSS_CONFIG.bucket;

    ossClient = new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket,
      secure: true,  // 强制使用 HTTPS
    });

    console.log(`✅ 阿里云OSS客户端已初始化: ${bucket} (${region})`);
  }

  return ossClient;
}

/**
 * 上传文件到阿里云OSS
 * @param fileBuffer 文件缓冲区
 * @param fileName 文件名
 * @param contentType MIME类型
 * @returns 文件的公开URL
 */
export async function uploadFileToOSS(
  fileBuffer: Buffer,
  fileName: string,
  contentType?: string
): Promise<string> {
  const client = getOSSClient();
  const bucket = process.env.ALIYUN_OSS_BUCKET || OSS_CONFIG.bucket;

  // 生成唯一文件名（添加时间戳避免冲突）
  const timestamp = Date.now();
  const uniqueFileName = `audio/${timestamp}-${fileName}`;

  try {
    console.log(`📤 正在上传文件到阿里云OSS: ${uniqueFileName}`);

    // 上传文件
    const result = await client.put(uniqueFileName, fileBuffer, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
      },
    });

    // 设置文件为公共读
    await client.putACL(uniqueFileName, 'public-read');

    // 生成公开URL
    const region = process.env.ALIYUN_OSS_REGION || OSS_CONFIG.region;
    const publicUrl = `https://${bucket}.${region}.aliyuncs.com/${uniqueFileName}`;

    console.log(`✅ 文件上传成功: ${publicUrl}`);
    return publicUrl;
  } catch (error: any) {
    console.error('❌ 上传文件到阿里云OSS失败:', error);
    throw new Error(`上传文件到OSS失败: ${error.message}`);
  }
}

/**
 * 上传本地文件到阿里云OSS
 * @param filePath 本地文件路径
 * @returns 文件的公开URL
 */
export async function uploadLocalFileToOSS(filePath: string): Promise<string> {
  const client = getOSSClient();
  const bucket = process.env.ALIYUN_OSS_BUCKET || OSS_CONFIG.bucket;
  const region = process.env.ALIYUN_OSS_REGION || OSS_CONFIG.region;

  // 从文件路径提取文件名
  const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
  const uniqueFileName = `audio/${Date.now()}-${fileName}`;

  try {
    console.log(`📤 正在上传本地文件到阿里云OSS: ${filePath}`);

    // 上传文件
    const result = await client.put(uniqueFileName, filePath);

    // 设置文件为公共读
    await client.putACL(uniqueFileName, 'public-read');

    // 生成公开URL
    const publicUrl = `https://${bucket}.${region}.aliyuncs.com/${uniqueFileName}`;

    console.log(`✅ 本地文件上传成功: ${publicUrl}`);
    return publicUrl;
  } catch (error: any) {
    console.error('❌ 上传本地文件到阿里云OSS失败:', error);
    throw new Error(`上传本地文件到OSS失败: ${error.message}`);
  }
}

/**
 * 从阿里云OSS删除文件
 * @param fileUrl 文件URL或文件名
 */
export async function deleteFileFromOSS(fileUrl: string): Promise<void> {
  const client = getOSSClient();

  try {
    // 从URL中提取文件名
    let fileName = fileUrl;
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      const url = new URL(fileUrl);
      fileName = url.pathname.substring(1); // 移除开头的 /
    }

    console.log(`🗑️  正在删除文件: ${fileName}`);
    await client.delete(fileName);
    console.log(`✅ 文件删除成功: ${fileName}`);
  } catch (error: any) {
    console.error('❌ 删除文件失败:', error);
    throw new Error(`删除OSS文件失败: ${error.message}`);
  }
}

/**
 * 检查文件是否存在
 * @param fileUrl 文件URL或文件名
 * @returns 是否存在
 */
export async function fileExistsInOSS(fileUrl: string): Promise<boolean> {
  const client = getOSSClient();

  try {
    // 从URL中提取文件名
    let fileName = fileUrl;
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      const url = new URL(fileUrl);
      fileName = url.pathname.substring(1);
    }

    await client.head(fileName);
    return true;
  } catch (error: any) {
    if (error.code === 'NoSuchKey') {
      return false;
    }
    console.error('检查文件存在错误:', error);
    return false;
  }
}

/**
 * 检查OSS配置是否完整
 * @returns 是否配置完整（有硬编码备用配置，始终返回 true）
 */
export function isOSSConfigured(): boolean {
  return true;
}

/**
 * 生成用于上传的 OSS 签名 URL
 * @param fileName 文件名
 * @param contentType MIME 类型
 * @param expiresInSeconds 有效期（秒），默认 1800 秒（30 分钟）
 * @returns { signedUrl, fileUrl, filePath } 签名 URL、最终公开 URL 和文件路径
 */
export async function getOSSUploadSignedUrl(
  fileName: string,
  contentType: string = 'audio/mpeg',
  expiresInSeconds: number = 1800
): Promise<{ signedUrl: string; fileUrl: string; filePath: string }> {
  const client = getOSSClient();
  const bucket = process.env.ALIYUN_OSS_BUCKET || OSS_CONFIG.bucket;
  const region = process.env.ALIYUN_OSS_REGION || OSS_CONFIG.region;

  // 生成简化的文件名（避免中文和特殊字符）
  const ext = fileName.split('.').pop() || 'mp3';
  const uniqueFileName = `audio/${Date.now()}.${ext}`;

  // 生成用于上传的签名 URL（客户端已配置 secure: true，自动使用 HTTPS）
  const signedUrl = client.signatureUrl(uniqueFileName, {
    method: 'PUT',
    expires: expiresInSeconds,
    'Content-Type': contentType,
  });

  // 最终的公开 URL
  const fileUrl = `https://${bucket}.${region}.aliyuncs.com/${uniqueFileName}`;

  console.log(`✅ 生成 OSS 上传签名 URL，有效期 ${expiresInSeconds} 秒`);

  return { signedUrl, fileUrl, filePath: uniqueFileName };
}

/**
 * 设置 OSS 文件为公共读
 * @param filePath 文件路径
 */
export async function makeOSSFilePublic(filePath: string): Promise<void> {
  const client = getOSSClient();
  await client.putACL(filePath, 'public-read');
  console.log(`✅ 文件已设置为公开: ${filePath}`);
}
