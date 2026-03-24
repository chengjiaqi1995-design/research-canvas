import path from 'path';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { execSync } from 'child_process';

// 动态设置 FFmpeg 路径（兼容本地开发和云端 Alpine 环境）
function setupFFmpegPaths() {
  // 首先尝试使用系统安装的 ffmpeg（云端 Alpine）
  try {
    const systemFfmpegPath = execSync('which ffmpeg', { encoding: 'utf-8' }).trim();
    const systemFfprobePath = execSync('which ffprobe', { encoding: 'utf-8' }).trim();
    if (systemFfmpegPath && systemFfprobePath) {
      ffmpeg.setFfmpegPath(systemFfmpegPath);
      ffmpeg.setFfprobePath(systemFfprobePath);
      console.log(`📹 使用系统 FFmpeg: ${systemFfmpegPath}`);
      return;
    }
  } catch (e) {
    // 系统没有安装 ffmpeg，尝试使用 npm 包
  }

  // 回退到 @ffmpeg-installer 提供的二进制文件（本地开发环境）
  try {
    const { path: ffmpegPath } = require('@ffmpeg-installer/ffmpeg');
    const { path: ffprobePath } = require('@ffprobe-installer/ffprobe');
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    console.log(`📹 使用 npm 包 FFmpeg: ${ffmpegPath}`);
  } catch (e) {
    console.error('❌ 无法找到 FFmpeg，音频处理功能将不可用');
  }
}

// 初始化 FFmpeg 路径
setupFFmpegPaths();

/**
 * 获取音频文件时长（秒）
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
      if (err) {
        console.warn('无法获取音频时长:', err.message);
        resolve(0);
      } else {
        const duration = metadata.format.duration || 0;
        resolve(duration);
      }
    });
  });
}

/**
 * 使用 FFmpeg 压缩音频文件
 * @param audioData 原始音频数据
 * @param originalExt 原始文件扩展名
 * @param targetSizeMB 目标文件大小（MB）
 * @returns 压缩后的音频数据
 */
export async function compressAudio(audioData: Buffer, originalExt: string, targetSizeMB: number = 15): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tmpDir, `compress_input_${timestamp}${originalExt}`);
  const outputPath = path.join(tmpDir, `compress_output_${timestamp}.mp3`);

  try {
    // 保存原始音频到临时文件
    fs.writeFileSync(inputPath, audioData);

    const originalSizeMB = audioData.length / 1024 / 1024;
    console.log(`🗜️ 开始压缩音频: ${originalSizeMB.toFixed(2)}MB -> 目标 ${targetSizeMB}MB`);

    // 获取音频时长
    const duration = await getAudioDuration(inputPath);
    if (duration === 0) {
      console.warn('无法获取音频时长，跳过压缩');
      return audioData;
    }

    // 计算目标比特率（kbps）
    // 目标大小(bytes) = 比特率(kbps) * 时长(秒) / 8 * 1000
    // 比特率(kbps) = 目标大小(bytes) * 8 / 时长(秒) / 1000
    const targetSizeBytes = targetSizeMB * 1024 * 1024;
    let targetBitrate = Math.floor((targetSizeBytes * 8) / duration / 1000);

    // 限制比特率范围：最低 32kbps，最高 128kbps
    targetBitrate = Math.max(32, Math.min(128, targetBitrate));
    console.log(`📊 音频时长: ${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒, 目标比特率: ${targetBitrate}kbps`);

    // 使用 FFmpeg 压缩
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioBitrate(targetBitrate)
        .audioChannels(1) // 单声道进一步减小文件
        .audioFrequency(22050) // 降低采样率
        .outputOptions('-y') // 强制覆盖，避免在非交互环境中卡住
        .output(outputPath)
        .on('end', () => {
          console.log('✅ 音频压缩完成');
          resolve();
        })
        .on('error', (err: any) => {
          console.error('❌ 音频压缩失败:', err.message);
          reject(err);
        })
        .run();
    });

    // 读取压缩后的文件
    const compressedData = fs.readFileSync(outputPath);
    const compressedSizeMB = compressedData.length / 1024 / 1024;
    console.log(`✅ 压缩完成: ${originalSizeMB.toFixed(2)}MB -> ${compressedSizeMB.toFixed(2)}MB (节省 ${((1 - compressedSizeMB / originalSizeMB) * 100).toFixed(1)}%)`);

    return compressedData;
  } finally {
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (e) {
      // 忽略清理错误
    }
  }
}

/**
 * 使用 FFmpeg 分割音频文件
 */
export async function splitAudio(inputPath: string, outputDir: string, segmentDurationSeconds: number): Promise<string[]> {
  const duration = await getAudioDuration(inputPath);
  if (duration === 0) {
    console.warn('无法获取音频时长，将尝试整体转录');
    return [inputPath];
  }

  const numSegments = Math.ceil(duration / segmentDurationSeconds);
  console.log(`📊 音频总时长: ${Math.floor(duration / 60)} 分 ${Math.floor(duration % 60)} 秒`);
  console.log(`🔪 将分割成 ${numSegments} 段（每段 ${segmentDurationSeconds / 60} 分钟）`);

  const segmentPaths: string[] = [];
  const ext = path.extname(inputPath);

  // 检测是否在云端环境运行（Cloud Run 会设置 K_SERVICE 环境变量）
  const isCloudEnvironment = process.env.K_SERVICE || process.env.NODE_ENV === 'production';

  // 云端使用流复制（-c copy）加速，本地使用重新编码确保兼容性
  const ffmpegOptions = isCloudEnvironment
    ? ['-y', '-c', 'copy']  // 云端：直接流复制，极快
    : ['-y'];                // 本地：重新编码，兼容性更好

  if (isCloudEnvironment) {
    console.log(`   🚀 云端模式：使用流复制加速分割`);
  }

  for (let i = 0; i < numSegments; i++) {
    const startTime = i * segmentDurationSeconds;
    const outputPath = path.join(outputDir, `segment_${i}${ext}`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(segmentDurationSeconds)
        .outputOptions(ffmpegOptions)
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`   🎬 FFmpeg 开始执行: ${commandLine.substring(0, 100)}...`);
        })
        .on('stderr', (stderrLine) => {
          // 只打印关键信息，避免日志过多
          if (stderrLine.includes('time=') || stderrLine.includes('error') || stderrLine.includes('Error')) {
            console.log(`   📹 FFmpeg: ${stderrLine}`);
          }
        })
        .on('end', () => {
          console.log(`   ✅ 片段 ${i + 1}/${numSegments} 分割完成`);
          resolve();
        })
        .on('error', (err: any) => {
          console.error(`   ❌ 片段 ${i + 1}/${numSegments} 分割失败:`, err.message);
          // 最后一段可能因为时长不足而出错，忽略
          if (i === numSegments - 1) {
            resolve();
          } else {
            reject(err);
          }
        })
        .run();
    });

    // 检查文件是否存在且非空
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      segmentPaths.push(outputPath);
    }
  }

  return segmentPaths;
}
