import path from 'path';
import os from 'os';
import fs from 'fs';
import { downloadFile } from '../storageService';
import { uploadLocalFileToOSS, isOSSConfigured } from '../ossStorageService';
import { compressAudio } from './audioProcessing';
import { convertTraditionalToSimplified } from './textProcessing';
import type { TranscriptionResult, TitleAndTopics } from './aiTypes';

/**
 * 使用 Qwen 进行音频转录（文件转录，使用 DashScope 文件转录 API）
 */
export async function transcribeWithQwen(filePath: string, providedApiKey?: string, model?: string): Promise<TranscriptionResult> {
  try {
    // API 密钥必须由客户端提供
    const rawApiKey = providedApiKey;
    if (!rawApiKey) {
      throw new Error('QWEN_API_KEY 或 DASHSCOPE_API_KEY 未设置，请在客户端配置或环境变量中设置');
    }
    const apiKey = rawApiKey.trim();

    console.log('🔑 使用通义千问 API 进行文件转录...');
    console.log(`📁 文件路径: ${filePath}`);

    // 检查文件路径类型
    let fileUrlOrPath = filePath;
    const isHttpUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
    const isGCSUrl = filePath.includes('storage.googleapis.com') || filePath.includes('storage.cloud.google.com');
    const isOSSUrl = filePath.includes('.aliyuncs.com');

    // 打印 OSS 配置状态（调试用）
    const ossConfigured = isOSSConfigured();
    console.log(`🔧 OSS 配置状态: ${ossConfigured ? '已配置' : '未配置'}`);
    console.log(`🔧 环境变量检查:`);
    console.log(`   - ALIYUN_OSS_REGION: ${process.env.ALIYUN_OSS_REGION ? '已设置' : '❌ 未设置'}`);
    console.log(`   - ALIYUN_OSS_ACCESS_KEY_ID: ${process.env.ALIYUN_OSS_ACCESS_KEY_ID ? '已设置' : '❌ 未设置'}`);
    console.log(`   - ALIYUN_OSS_ACCESS_KEY_SECRET: ${process.env.ALIYUN_OSS_ACCESS_KEY_SECRET ? '已设置' : '❌ 未设置'}`);
    console.log(`   - ALIYUN_OSS_BUCKET: ${process.env.ALIYUN_OSS_BUCKET ? '已设置' : '❌ 未设置'}`);

    const selectedModel = model || 'paraformer-v2';
    console.log(`🎯 使用转录模型: ${selectedModel}`);

    let tempOssFileUrl: string | null = null;

    // 如果是 GCS URL，需要通过 OSS 中转（DashScope 无法直接访问 GCS）
    if (isGCSUrl) {
      if (!ossConfigured) {
        throw new Error(
          '检测到 GCS URL，但阿里云 OSS 未配置。\n' +
          'DashScope 无法直接访问 Google Cloud Storage 文件，需要通过 OSS 中转。'
        );
      }

      console.log('📥 检测到 GCS URL，通过 OSS 中转供 DashScope 访问...');
      try {
        // 从 GCS 下载文件
        let audioData = await downloadFile(filePath);
        if (!audioData) {
          throw new Error('无法从 GCS 下载文件');
        }

        const originalSizeMB = audioData.length / 1024 / 1024;
        console.log(`✅ 已从 GCS 下载文件，大小: ${originalSizeMB.toFixed(2)}MB`);

        // 如果文件超过 30MB 或者是 Qwen 不兼容的格式，进行压缩/转储
        const compressThresholdMB = 30;
        const ext = path.extname(filePath).toLowerCase() || '.mp3';
        const needsConversion = ['.webm', '.ogg', '.weba'].includes(ext);
        let finalExt = ext;

        if (originalSizeMB > compressThresholdMB || needsConversion) {
          console.log(`⚠️ 文件超过 ${compressThresholdMB}MB 或格式不兼容 Qwen (${ext})，开始转码压缩...`);
          try {
            audioData = await compressAudio(audioData, ext, 15);
            finalExt = '.mp3';
            console.log(`✅ 转码/压缩后大小: ${(audioData.length / 1024 / 1024).toFixed(2)}MB`);
          } catch (compressError: any) {
            console.warn('转码/压缩失败，继续使用原始文件:', compressError.message);
          }
        }

        // 统一上传到新加坡 OSS
        const tempDir = os.tmpdir();
        const tempFileName = `temp_audio_${Date.now()}${finalExt}`;
        const tempFilePath = path.join(tempDir, tempFileName);

        fs.writeFileSync(tempFilePath, audioData);
        console.log(`✅ 临时文件已保存: ${tempFilePath}`);

        fileUrlOrPath = await uploadLocalFileToOSS(tempFilePath);
        tempOssFileUrl = fileUrlOrPath; // 记录临时 OSS 文件以便后续清理
        console.log(`✅ 文件已转存到新加坡 OSS: ${fileUrlOrPath}`);

        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          // 忽略删除失败
        }
      } catch (error: any) {
        console.error(`❌ GCS 转存到 OSS 失败: ${error.message}`);
        throw new Error(`无法将 GCS 文件转存到 OSS: ${error.message}`);
      }
    }
    // 如果已经是 OSS URL，直接使用
    else if (isOSSUrl) {
      console.log('✅ 已是阿里云 OSS URL，直接使用');
    }
    // 如果是本地文件且配置了OSS，先上传到OSS获取公开URL
    else if (!isHttpUrl && ossConfigured) {
      console.log('📤 检测到阿里云OSS配置，正在上传文件到OSS...');
      try {
        // 检查本地文件大小，超过 30MB 先压缩
        const localFileStats = fs.statSync(filePath);
        const localFileSizeMB = localFileStats.size / 1024 / 1024;
        console.log(`📦 本地文件大小: ${localFileSizeMB.toFixed(2)}MB`);

        let uploadPath = filePath;
        const compressThresholdMB = 30;
        const ext = path.extname(filePath).toLowerCase() || '.mp3';
        const needsConversion = ['.webm', '.ogg', '.weba'].includes(ext);

        if (localFileSizeMB > compressThresholdMB || needsConversion) {
          console.log(`⚠️ 文件超过 ${compressThresholdMB}MB 或格式不兼容 Qwen (${ext})，开始转码压缩...`);
          try {
            const localAudioData = fs.readFileSync(filePath);
            const compressedData = await compressAudio(localAudioData, ext, 15);

            // 保存压缩后的文件
            const tempDir = os.tmpdir();
            const compressedPath = path.join(tempDir, `compressed_${Date.now()}.mp3`);
            fs.writeFileSync(compressedPath, compressedData);
            uploadPath = compressedPath;
            console.log(`✅ 转码/压缩后大小: ${(compressedData.length / 1024 / 1024).toFixed(2)}MB`);
          } catch (compressError: any) {
            console.warn('转码/压缩失败，继续使用原始文件:', compressError.message);
          }
        }

        // 统一上传到新加坡 OSS
        fileUrlOrPath = await uploadLocalFileToOSS(uploadPath);
        tempOssFileUrl = fileUrlOrPath; // 记录临时 OSS 文件以便后续清理
        console.log(`✅ 文件已上传到新加坡 OSS: ${fileUrlOrPath}`);

        // 清理临时压缩文件
        if (uploadPath !== filePath) {
          try { fs.unlinkSync(uploadPath); } catch (e) { }
        }
      } catch (error: any) {
        console.warn(`⚠️  上传到OSS失败，将使用临时文件服务: ${error.message}`);
        // 如果OSS上传失败，继续使用本地路径（Python脚本会使用file.io）
      }
    } else if (!isHttpUrl) {
      console.log('ℹ️  未配置阿里云OSS，将使用临时文件服务（file.io）上传');

      // 本地文件使用 file.io 前也检查是否需要压缩/转码
      const localFileStats = fs.statSync(filePath);
      const localFileSizeMB = localFileStats.size / 1024 / 1024;
      const compressThresholdMB = 30;
      const ext = path.extname(filePath).toLowerCase() || '.mp3';
      const needsConversion = ['.webm', '.ogg', '.weba'].includes(ext);

      if (localFileSizeMB > compressThresholdMB || needsConversion) {
        console.log(`⚠️ 文件超过 ${compressThresholdMB}MB 或格式不兼容 Qwen (${ext})，开始转码压缩...`);
        try {
          const localAudioData = fs.readFileSync(filePath);
          const compressedData = await compressAudio(localAudioData, ext, 15);

          // 保存压缩后的文件，Python 脚本将使用这个文件
          const compressedPath = filePath.replace(/\.[^.]+$/, `_compressed_${Date.now()}.mp3`);
          fs.writeFileSync(compressedPath, compressedData);
          fileUrlOrPath = compressedPath;
          console.log(`✅ 转码/压缩后大小: ${(compressedData.length / 1024 / 1024).toFixed(2)}MB`);
        } catch (compressError: any) {
          console.warn('转码/压缩失败，继续使用原始文件:', compressError.message);
        }
      }
    } else if (isHttpUrl && !isOSSUrl && !isGCSUrl) {
      // 其他 HTTP URL，可能无法被 DashScope 访问
      console.warn('⚠️  检测到非 OSS/GCS 的 HTTP URL，DashScope 可能无法访问');
    }

    // 使用 Python 服务进行文件转录
    const { spawn } = require('child_process');

    const pythonScript = path.join(__dirname, '../../../python_service/file_transcription.py');

    // 尝试找到正确的 Python 可执行文件
    let pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    // 在 Windows 上，尝试使用 py 命令（Python Launcher）
    if (process.platform === 'win32') {
      try {
        // 先尝试 python，如果失败再尝试 py
        pythonCmd = 'python';
      } catch {
        pythonCmd = 'py';
      }
    }

    console.log(`🐍 使用 Python 命令: ${pythonCmd}`);
    console.log(`📝 Python 脚本路径: ${pythonScript}`);
    console.log(`📁 文件路径/URL: ${fileUrlOrPath}`);

    return new Promise((resolve, reject) => {
      // 使用指定的模型（在函数开头已定义 selectedModel）
      console.log(`🎯 使用转录模型: ${selectedModel}`);
      const pythonProcess = spawn(pythonCmd, [pythonScript, fileUrlOrPath, apiKey, selectedModel], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../../../'),
        shell: process.platform === 'win32',
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.setEncoding('utf8');
      pythonProcess.stdout.on('data', (data: string) => {
        stdout += data;
      });

      pythonProcess.stderr.setEncoding('utf8');
      pythonProcess.stderr.on('data', (data: string) => {
        stderr += data;
        // 打印 Python 的日志到控制台
        console.log('Python:', data.trim());
      });

      pythonProcess.on('close', async (code: number) => {
        console.log(`📊 Python 进程退出，代码: ${code}`);

        // 异步清理临时 OSS 文件（不阻塞主流程）
        if (tempOssFileUrl) {
          try {
            const { deleteFileFromOSS } = await import('../ossStorageService');
            deleteFileFromOSS(tempOssFileUrl).catch(e => console.warn('清理临时 OSS 文件失败:', e.message));
          } catch (e: any) {
            console.warn('加载 ossStorageService 失败:', e.message);
          }
        }

        console.log(`📊 Python stdout 长度: ${stdout.length}`);
        console.log(`📊 Python stderr 长度: ${stderr.length}`);

        if (code !== 0) {
          console.error('❌ Python 进程退出，代码:', code);
          console.error('Python stdout:', stdout);
          console.error('Python stderr:', stderr);

          // 尝试从 stdout 解析错误信息
          if (stdout.trim()) {
            try {
              const result = JSON.parse(stdout.trim());
              if (result.type === 'error') {
                reject(new Error(`通义千问转录失败: ${result.message}`));
                return;
              }
            } catch (e) {
              // 解析失败，继续使用 stderr
            }
          }

          // 使用 stderr 或 stdout 作为错误信息
          const errorMsg = stderr.trim() || stdout.trim() || 'Python 进程异常退出';
          reject(new Error(`通义千问转录失败: ${errorMsg}`));
          return;
        }

        // 进程正常退出，解析结果
        if (!stdout.trim()) {
          console.error('❌ Python stdout 为空');
          console.error('Python stderr:', stderr);
          reject(new Error(`通义千问转录失败: Python 未返回结果${stderr ? ` - ${stderr}` : ''}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          console.log('📊 Python 返回结果类型:', result.type);

          if (result.type === 'error') {
            console.error('❌ Python 返回错误:', result.message);
            reject(new Error(`通义千问转录失败: ${result.message || '未知错误'}`));
          } else if (result.type === 'success') {
            const transcriptText = result.text;
            const segments = result.segments || [];
            if (!transcriptText || transcriptText.trim().length === 0) {
              reject(new Error('转录结果为空'));
            } else {
              console.log(`✅ 通义千问转录成功，文本长度: ${transcriptText.length} 字符，分段数: ${segments.length}`);
              // 转换文本和分段中的繁体中文为简体中文
              const convertedText = convertTraditionalToSimplified(transcriptText);
              const convertedSegments = segments.map((segment: any) => ({
                ...segment,
                text: convertTraditionalToSimplified(segment.text || '')
              }));
              resolve({
                text: convertedText,
                segments: convertedSegments
              });
            }
          } else {
            console.error('❌ 未知的响应格式:', result);
            reject(new Error(`未知的响应格式: ${JSON.stringify(result)}`));
          }
        } catch (parseError: any) {
          console.error('❌ 解析 Python 输出失败:', parseError);
          console.error('Python stdout (原始):', stdout);
          console.error('Python stdout (长度):', stdout.length);
          console.error('Python stderr:', stderr);
          reject(new Error(`解析转录结果失败: ${parseError.message}。输出: ${stdout.substring(0, 500)}`));
        }
      });

      pythonProcess.on('error', async (error: any) => {
        console.error('❌ Python 进程错误:', error);
        
        // 清理临时文件
        if (tempOssFileUrl) {
          try {
            const { deleteFileFromOSS } = await import('../ossStorageService');
            deleteFileFromOSS(tempOssFileUrl).catch(e => console.warn('发生异常时清理临时 OSS 文件失败:', e.message));
          } catch (e) {}
        }
        
        reject(new Error(`启动 Python 转录服务失败: ${error.message}`));
      });
    });
  } catch (error: any) {
    console.error('❌ 通义千问转录错误:', error);
    throw new Error(`通义千问转录失败: ${error.message || '未知错误'}`);
  }
}

/**
 * 使用 Qwen 生成文本总结
 */
export async function generateSummaryWithQwen(text: string, providedApiKey?: string, customPrompt?: string): Promise<string> {
  try {
    // API 密钥必须由客户端提供
    const apiKey = providedApiKey;
    if (!apiKey) {
      throw new Error('QWEN_API_KEY 或 DASHSCOPE_API_KEY 未设置，请在客户端配置或环境变量中设置');
    }

    console.log('📊 使用通义千问 API 生成总结...');

    // 构建 Prompt
    let prompt: string;
    if (customPrompt && customPrompt.trim().length > 0) {
      // 使用自定义 Prompt
      prompt = customPrompt.replace(/{text}/g, text);
      console.log('📝 使用自定义 Prompt (前 100 字符):', customPrompt.substring(0, 100));
    } else {
      // 使用默认 Prompt
      prompt = `请对以下文本进行总结，要求简洁明了，突出重点：

${text}

总结：`;
      console.log('📝 使用默认总结 Prompt');
    }

    console.log(`⏳ 正在生成总结，文本长度: ${text.length} 字符...`);

    // 调用千问API
    const axios = require('axios');
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        model: 'qwen-turbo',
        input: {
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        },
        parameters: {
          result_format: 'message'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 600000 // 10分钟超时
      }
    );

    if (response.data.output && response.data.output.choices && response.data.output.choices.length > 0) {
      const summary = response.data.output.choices[0].message.content;

      if (!summary || summary.trim().length === 0) {
        throw new Error('总结结果为空');
      }

      console.log(`✅ 通义千问总结生成成功，长度: ${summary.length} 字符`);
      return summary;
    } else {
      throw new Error('千问API返回格式不正确');
    }
  } catch (error: any) {
    console.error('❌ 通义千问总结错误:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw new Error(`通义千问总结失败: ${error.response?.data?.message || error.message || '未知错误'}`);
  }
}

/**
 * 使用 Qwen 生成标题和相关主题
 */
export async function generateTitleAndTopicsWithQwen(
  transcriptText: string,
  summary: string,
  providedApiKey?: string,
  date?: Date
): Promise<TitleAndTopics> {
  // 暂时使用默认值，因为Qwen总结功能未实现
  const dateStr = date
    ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return {
    title: `会议---未知---${dateStr}`,
    topics: ['会议', '转录', '对话', '讨论', '记录']
  };
}
