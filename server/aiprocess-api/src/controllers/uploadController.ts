import { Request, Response } from 'express';
import { getUploadSignedUrl, makeFilePublic } from '../services/storageService';
import { 
  getOSSUploadSignedUrl, 
  makeOSSFilePublic 
} from '../services/ossStorageService';
import type { ApiResponse } from '../types';

/**
 * 根据模型获取对应存储的上传签名 URL
 * 
 * 策略：按模型直传到不同存储
 * - gemini: 直传 GCS
 * - paraformer-v2 / qwen3-asr-flash-filetrans: 直传 OSS 新加坡
 */
export async function getSignedUploadUrl(req: Request, res: Response) {
  const { fileName, model, contentType } = req.query;

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少文件名参数',
    } as ApiResponse);
  }

  if (!model || typeof model !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少模型参数',
    } as ApiResponse);
  }

  const mimeType = (contentType as string) || 'audio/mpeg';
  let result: { signedUrl: string; fileUrl: string; filePath: string };
  let storageType: 'gcs' | 'oss-singapore';

  // 根据模型选择存储
  if (model === 'gemini') {
    // Gemini 使用 GCS
    result = await getUploadSignedUrl(fileName, mimeType);
    storageType = 'gcs';
  } else {
    // 其他模型（paraformer-v2, qwen3-asr-flash-filetrans）使用 OSS 新加坡
    result = await getOSSUploadSignedUrl(fileName, mimeType);
    storageType = 'oss-singapore';
  }

  console.log(`📤 生成上传签名 URL: model=${model}, storage=${storageType}, fileName=${fileName}`);

  return res.json({
    success: true,
    data: {
      signedUrl: result.signedUrl,
      fileUrl: result.fileUrl,
      filePath: result.filePath,
      storageType,
      model,
    },
  } as ApiResponse);
}

/**
 * 确认文件上传完成，设置文件为公开
 */
export async function confirmUpload(req: Request, res: Response) {
  const { filePath, storageType } = req.body;

  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少文件路径参数',
    } as ApiResponse);
  }

  if (!storageType || typeof storageType !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少存储类型参数',
    } as ApiResponse);
  }

  // 根据存储类型设置文件为公开
  switch (storageType) {
    case 'gcs':
      await makeFilePublic(filePath);
      break;

    case 'oss-singapore':
      await makeOSSFilePublic(filePath);
      break;

    default:
      return res.status(400).json({
        success: false,
        error: '无效的存储类型',
      } as ApiResponse);
  }

  console.log(`✅ 文件已设置为公开: ${filePath} (${storageType})`);

  return res.json({
    success: true,
    message: '文件上传确认成功',
  } as ApiResponse);
}

/**
 * 获取实时录音上传的签名 URL（使用 OSS 新加坡）
 */
export async function getAudioUploadSignedUrl(req: Request, res: Response) {
  const { fileName, contentType } = req.query;

  if (!fileName || typeof fileName !== 'string') {
    return res.status(400).json({
      success: false,
      error: '缺少文件名参数',
    } as ApiResponse);
  }

  const mimeType = (contentType as string) || 'audio/webm';
  const result = await getOSSUploadSignedUrl(fileName, mimeType);

  console.log(`📤 生成实时录音上传签名 URL: fileName=${fileName}`);

  return res.json({
    success: true,
    data: {
      signedUrl: result.signedUrl,
      fileUrl: result.fileUrl,
      filePath: result.filePath,
      storageType: 'oss-singapore',
    },
  } as ApiResponse);
}
