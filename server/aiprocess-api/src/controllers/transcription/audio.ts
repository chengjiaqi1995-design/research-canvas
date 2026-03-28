import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import prisma from '../../utils/db';
import { ApiResponse } from '../../types';
import { downloadFile } from '../../services/storageService';

export async function getAudioFile(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const transcription = await prisma.transcription.findFirst({
    where: {
      id,
      userId, // 确保只能访问自己的数据
    },
  });

  if (!transcription) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  if (!transcription.filePath) {
    return res.status(404).json({
      success: false,
      error: '音频文件不存在',
    } as ApiResponse);
  }

  // 如果是 GCS URL，通过服务端代理返回（bucket 启用了 uniform access，文件非公开）
  if (transcription.filePath.startsWith('http://') || transcription.filePath.startsWith('https://')) {
    try {
      const buffer = await downloadFile(transcription.filePath);
      const ext = path.extname(new URL(transcription.filePath).pathname).toLowerCase();
      const mimeTypes: { [key: string]: string } = {
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac', '.aac': 'audio/aac',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'audio/mpeg');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.send(buffer);
    } catch (error) {
      console.error('GCS 代理下载失败:', error);
      return res.status(500).json({ success: false, error: '音频文件加载失败' } as ApiResponse);
    }
  }

  // 本地文件（开发环境）
  if (!fs.existsSync(transcription.filePath)) {
    return res.status(404).json({
      success: false,
      error: '音频文件不存在',
    } as ApiResponse);
  }

  // 设置响应头，支持音频播放
  const ext = path.extname(transcription.filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
  };
  const mimeType = mimeTypes[ext] || 'audio/mpeg';

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(transcription.fileName)}"`);
  res.setHeader('Accept-Ranges', 'bytes');

  // 支持范围请求（用于音频播放的跳转）
  if (fs) {
    const fileStats = fs.statSync(transcription.filePath);
    const fileSize = fileStats.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(transcription.filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      };
      res.writeHead(200, head);
      fs.createReadStream(transcription.filePath).pipe(res);
    }
  } else {
    return res.status(500).json({
      success: false,
      error: '文件系统不可用',
    } as ApiResponse);
  }
}

/**
 * 上传音频文件到已存在的转录记录（用于实时录音）
 */
export async function uploadAudioToTranscription(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  // 验证转录记录存在 — 不严格要求 userId 匹配，因为实时转录可能
  // 用 anonymous fallback 创建记录，而上传时用真实用户身份
  const transcription = await prisma.transcription.findFirst({
    where: { id },
  });

  if (!transcription) {
    return res.status(404).json({
      success: false,
      error: '转录记录不存在',
    } as ApiResponse);
  }

  // 如果转录记录是 anonymous 创建的，绑定到真实用户
  if (transcription.userId === 'anonymous' && userId !== 'anonymous') {
    await prisma.transcription.update({
      where: { id },
      data: { userId },
    });
    console.log(`[Upload] 绑定 anonymous 转录 ${id} 到用户 ${userId}`);
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: '未上传音频文件',
    } as ApiResponse);
  }

  // 获取文件路径（本地开发或 GCS URL）
  const filePath = (req.file as any).gcsUrl || (req.file as any).path || '';
  const fileSize = req.file.size;

  if (!filePath) {
    return res.status(500).json({
      success: false,
      error: '文件保存失败',
    } as ApiResponse);
  }

  // 更新转录记录
  const updatedTranscription = await prisma.transcription.update({
    where: { id },
    data: {
      filePath,
      fileSize,
    },
  });

  console.log(`音频文件已上传到转录记录 ${id}: ${filePath}`);

  return res.json({
    success: true,
    data: updatedTranscription,
    message: '音频文件上传成功',
  } as ApiResponse);
}
