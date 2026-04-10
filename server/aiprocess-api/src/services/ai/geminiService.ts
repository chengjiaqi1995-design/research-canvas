import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { downloadFile } from '../storageService';
import { uploadLocalFileToOSS, isOSSConfigured, uploadFileToOSS } from '../ossStorageService';
import { compressAudio, splitAudio, getAudioDuration } from './audioProcessing';
import { parseGeminiTranscript, convertTraditionalToSimplified } from './textProcessing';
import type { TranscriptionResult, TitleAndTopics, ExtractedMetadata } from './aiTypes';

/**
 * 获取元数据提取的 Prompt 模板（用于前端显示）
 */
export function getMetadataExtractionPromptTemplate(): string {
  return `你是一个金融研究助手。根据会议/通话的转录文本，提取以下元数据字段。

要求：
- topic: 会议主题，简洁描述（20字以内）
- organization: 涉及的主要公司，使用规范命名格式：
  - 美股: [TICKER US] Company Full Name，如 [DE US] Deere & Company
  - 港股: [代码 HK] 公司全称，如 [0669 HK] 创科实业有限公司
  - A股: [6位代码 CH] 公司全称，如 [600031 CH] 三一重工
  - 非上市: [Private] 公司名称
  现有命名参考： [DE US] Deere & Company, [0669 HK] 创科实业有限公司, [600031 CH] 三一重工, [TSLA US] Tesla
- speaker: 演讲人/嘉宾的姓名，如果有多位用逗号分隔
- participants: 演讲人类型，只能是 management / expert / sellside 之一
- intermediary: 中介机构（券商、咨询公司等），没有则留空
- industry: 行业细分分类，必须从以下选项中选择最匹配的一个（只输出选项名称，不要输出其他内容）：
  核电、铜金、铁、铝、航空航天、五金工具、泛工业、工业软件、稀土、LNG、煤、EPC、互联网/大模型、军工、卡车、基建地产链条、天然气发电、战略金属、数据中心设备、煤电、石油、车险、钠电、电网设备、汽车、零部件、锂电、电力运营商、工程机械/矿山机械、两轮车/全地形车、风光储、轨道交通、机器人/工业自动化、检测服务、自动驾驶、轮胎、工业MRO、天然气管道、农用机械、航运、海运、铁路、车运/货代、非电消纳、造船、创新消费品、宏观
- country: 国家/地区（中国/美国/日本/韩国/欧洲/印度/其他）
- eventDate: 会议发生的大致日期，格式如 2024/3/15，如果无法判断则留空

转录文本：
{text}

严格按 JSON 格式输出，不要任何解释：
{"topic":"","organization":"","speaker":"","participants":"","intermediary":"","industry":"","country":"","eventDate":""}`;
}

/**
 * 分段转录长音频（使用 File API）
 * 每段 25 分钟，确保完整转录
 */
async function transcribeWithGeminiChunkedFileAPI(
  audioData: Buffer,
  mimeType: string,
  apiKey: string,
  fileUrl: string,
  geminiModel?: string
): Promise<TranscriptionResult> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const tempFiles: string[] = [];
  const uploadedFiles: any[] = [];

  // 创建 File Manager 和 GenerativeAI 实例
  // 配置 10 分钟超时（600000ms），解决大文件转录时默认 30s 超时问题
  const requestOptions = {
    timeout: 600000, // 600秒 = 10分钟
  };
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: geminiModel || 'gemini-2.5-flash',
    generationConfig: {
      maxOutputTokens: 65536,
    }
  }, requestOptions);

  // 根据 mimeType 确定文件扩展名
  const extMap: { [key: string]: string } = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/flac': '.flac',
    'audio/aac': '.aac',
  };
  const ext = extMap[mimeType] || '.mp3';

  // 保存原始音频到临时文件
  const inputPath = path.join(tmpDir, `gemini_chunked_${timestamp}${ext}`);
  fs.writeFileSync(inputPath, audioData);
  tempFiles.push(inputPath);
  console.log(`📁 [分段转录] 临时文件已保存: ${inputPath}`);

  try {
    // 每段 25 分钟
    const segmentDurationSeconds = 25 * 60;
    const segmentPaths = await splitAudio(inputPath, tmpDir, segmentDurationSeconds);

    if (segmentPaths.length === 0) {
      throw new Error('音频分割失败');
    }

    // 将分段文件添加到清理列表
    segmentPaths.forEach(p => {
      if (p !== inputPath && !tempFiles.includes(p)) {
        tempFiles.push(p);
      }
    });

    console.log(`📊 [分段转录] 将处理 ${segmentPaths.length} 个分段`);

    // 转录每个分段，保存结果和时间偏移
    interface SegmentResult {
      transcript: string;
      timeOffsetSeconds: number; // 该分段在原始音频中的起始时间（秒）
    }
    const segmentResults: SegmentResult[] = [];
    const timeoutMs = 600000; // 10 分钟超时

    for (let i = 0; i < segmentPaths.length; i++) {
      const segmentPath = segmentPaths[i];
      const timeOffsetSeconds = i * segmentDurationSeconds; // 时间偏移（秒）
      const timeOffsetMinutes = timeOffsetSeconds / 60;

      console.log(`\n📤 [分段 ${i + 1}/${segmentPaths.length}] 开始上传到 Google 服务器... (时间偏移: ${timeOffsetMinutes}分钟)`);

      // 上传分段到 Google 服务器
      const uploadResult = await fileManager.uploadFile(segmentPath, {
        mimeType: mimeType,
        displayName: `segment_${i + 1}_${timestamp}`,
      });
      const uploadedFile = uploadResult.file;
      uploadedFiles.push(uploadedFile);
      console.log(`   ✅ 上传成功: ${uploadedFile.name}`);

      // 等待文件处理完成（最多等待 5 分钟，防止无限循环）
      let file = uploadedFile;
      const chunkProcessingStart = Date.now();
      const chunkProcessingTimeout = 5 * 60 * 1000; // 5分钟
      let chunkTimedOut = false;
      while (file.state === 'PROCESSING') {
        if (Date.now() - chunkProcessingStart > chunkProcessingTimeout) {
          console.error(`   ❌ 分段 ${i + 1} 文件处理超时（5分钟）`);
          chunkTimedOut = true;
          break;
        }
        console.log(`   ⏳ 等待文件处理...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        file = await fileManager.getFile(file.name);
      }

      if (chunkTimedOut || file.state === 'FAILED') {
        console.error(`   ❌ 文件处理失败或超时，跳过分段 ${i + 1}`);
        continue;
      }

      // 构建提示词 - 让模型从 0:00 开始输出时间戳，我们后续会调整
      const prompt = `【强制要求】你必须完整转录这段音频。禁止返回空结果。

请转录这段音频，并识别不同的说话人。使用音频中的原始语言。

【严格格式要求 - 必须遵守】
每一行必须严格按照以下格式输出，不允许任何变体：
[MM:SS] [说话人X] 内容

格式说明：
- [MM:SS] 是时间戳，MM是分钟（两位数），SS是秒（两位数），例如 [00:00] [01:35] [12:08]
- [说话人X] 是说话人标签，X是数字，例如 [说话人1] [说话人2] [说话人3]
- 时间戳必须从 [00:00] 开始，表示当前音频片段的相对时间
- 时间戳必须与音频中的实际时间点对应

【说话人识别要求】
- 仔细聆听不同的声音特征（音调、语速、音色）来区分说话人
- 使用 [说话人1] [说话人2] [说话人3] 等标签
- 如果是对话或会议，通常会有多个说话人
- 说话人切换时必须换行

【语言要求】
- 中文音频必须使用简体中文输出
- 英文音频使用英文输出
- 不要翻译，保持原始语言

【正确输出示例】
[00:00] [说话人1] 大家好，今天我们来讨论一下项目进展情况。
[00:35] [说话人2] 好的，我先来介绍一下目前的进度。
[01:20] [说话人1] 明白了，请继续。
[02:45] [说话人2] 根据最新数据显示...

【禁止的格式（不要使用）】
× 0:00 说话人1: 内容
× [0:00] 内容
× 说话人1: 内容
× - 内容

【强制要求】
- 必须输出转录内容，禁止返回空结果
- 即使音频质量不佳，也要尽力转录
- 听不清的部分用 [听不清] 标注，但继续转录其他部分
- 必须转录完整内容，从头到尾不要遗漏`;

      console.log(`   ⏳ 正在转录...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const result = await model.generateContent(
          [
            {
              fileData: {
                fileUri: file.uri,
                mimeType: file.mimeType,
              },
            },
            prompt,
          ],
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        const response = result.response;
        const transcription = response.text();
        const finishReason = response.candidates?.[0]?.finishReason;

        if (transcription) {
          // 打印原始输出的前200个字符用于调试
          console.log(`   📄 分段 ${i + 1} 原始输出格式预览:\n${transcription.substring(0, 300)}...`);

          segmentResults.push({
            transcript: transcription,
            timeOffsetSeconds: timeOffsetSeconds
          });
          console.log(`   ✅ 转录完成，长度: ${transcription.length} 字符, 完成原因: ${finishReason || 'STOP'}`);

          if (finishReason === 'MAX_TOKENS') {
            console.warn(`   ⚠️ 警告: 分段 ${i + 1} 可能被截断（达到 token 限制）`);
          }
        } else {
          console.error(`   ❌ 分段 ${i + 1} 转录结果为空`);
        }
      } catch (error: any) {
        console.error(`   ❌ 分段 ${i + 1} 转录失败:`, error.message);
      }

      // 分段之间等待，避免 API 限制
      if (i < segmentPaths.length - 1) {
        console.log(`   ⏳ 等待 3 秒后处理下一分段...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // 合并所有转录结果
    if (segmentResults.length === 0) {
      throw new Error('所有分段转录均失败');
    }

    console.log(`\n📝 [分段转录] 开始合并 ${segmentResults.length} 个分段...`);

    // 解析每个分段并调整时间戳
    const allSegments: Array<{ text: string; speakerId: number; startTime: number; endTime?: number }> = [];
    const allTexts: string[] = [];

    for (let i = 0; i < segmentResults.length; i++) {
      const { transcript, timeOffsetSeconds } = segmentResults[i];

      // 解析当前分段
      const parsed = parseGeminiTranscript(transcript);

      console.log(`   📊 分段 ${i + 1}: ${parsed.segments.length} 个片段, 时间偏移: ${timeOffsetSeconds / 60} 分钟`);
      if (parsed.segments.length > 0) {
        const firstSeg = parsed.segments[0];
        console.log(`   📝 第一个片段: 时间=${firstSeg.startTime}s, 说话人=${firstSeg.speakerId}, 文本="${firstSeg.text.substring(0, 50)}..."`);
      }

      // 调整时间戳并添加到总结果
      for (const segment of parsed.segments) {
        allSegments.push({
          ...segment,
          startTime: segment.startTime + timeOffsetSeconds,
          endTime: segment.endTime ? segment.endTime + timeOffsetSeconds : undefined
        });
      }

      allTexts.push(parsed.text);
    }

    // 按时间排序（确保顺序正确）
    allSegments.sort((a, b) => a.startTime - b.startTime);

    // 重新计算 endTime（基于下一个片段的开始时间）
    for (let i = 0; i < allSegments.length - 1; i++) {
      if (!allSegments[i].endTime || allSegments[i].endTime! > allSegments[i + 1].startTime) {
        allSegments[i].endTime = allSegments[i + 1].startTime;
      }
    }

    // 生成统一格式的合并文本（带时间戳和说话人标签）
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const mergedText = allSegments.map(segment => {
      const timeStr = formatTime(segment.startTime);
      const speakerStr = `说话人${segment.speakerId + 1}`;
      return `[${timeStr}] [${speakerStr}] ${segment.text}`;
    }).join('\n');

    console.log(`   ✅ 合并完成，总共 ${allSegments.length} 个片段，总长度: ${mergedText.length} 字符`);

    // 转换繁体为简体
    const convertedText = convertTraditionalToSimplified(mergedText);
    const convertedSegments = allSegments.map(segment => ({
      ...segment,
      text: convertTraditionalToSimplified(segment.text)
    }));

    return {
      text: convertedText,
      segments: convertedSegments
    };
  } finally {
    // 清理本地临时文件
    for (const filePath of tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // 忽略清理错误
      }
    }
    console.log('🧹 已清理本地临时文件');

    // 清理 Google 服务器上的文件
    for (const uploadedFile of uploadedFiles) {
      try {
        await fileManager.deleteFile(uploadedFile.name);
      } catch (e) {
        // 忽略清理错误
      }
    }
    if (uploadedFiles.length > 0) {
      console.log('🧹 已清理 Google 服务器上的文件');
    }
  }
}

/**
 * 分段转录长音频（使用 Gemini inlineData - 旧版本，保留备用）
 */
async function transcribeWithGeminiChunked(
  audioData: Buffer,
  mimeType: string,
  genAI: GoogleGenerativeAI,
  fileUrl: string,
  geminiModel?: string
): Promise<TranscriptionResult> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const tempFiles: string[] = [];

  // 根据 mimeType 确定文件扩展名
  const extMap: { [key: string]: string } = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/flac': '.flac',
    'audio/aac': '.aac',
  };
  const ext = extMap[mimeType] || '.mp3';

  // 保存原始音频到临时文件
  const inputPath = path.join(tmpDir, `gemini_input_${timestamp}${ext}`);
  fs.writeFileSync(inputPath, audioData);
  tempFiles.push(inputPath);
  console.log(`📁 临时文件已保存: ${inputPath}`);

  try {
    // 每段 60 分钟（1小时）
    const segmentDurationSeconds = 60 * 60;
    const segmentPaths = await splitAudio(inputPath, tmpDir, segmentDurationSeconds);

    if (segmentPaths.length === 0) {
      throw new Error('音频分割失败');
    }

    // 如果只有一段，说明分割失败或音频本身很短
    if (segmentPaths.length === 1 && segmentPaths[0] === inputPath) {
      throw new Error('音频分割失败，将尝试整体转录');
    }

    tempFiles.push(...segmentPaths.filter(p => p !== inputPath));
    console.log(`📦 成功分割成 ${segmentPaths.length} 个片段`);

    // 创建模型实例（增大输出 token 限制到最大值）
    const model = genAI.getGenerativeModel({
      model: geminiModel || 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: 65536,
      }
    });

    // 设置请求超时时间（10 分钟），因为生成大量 token 需要更长时间
    const timeoutMs = 600000; // 600秒 = 10分钟

    // 转录每个片段
    const allTranscripts: string[] = [];

    for (let i = 0; i < segmentPaths.length; i++) {
      const segmentPath = segmentPaths[i];
      const segmentData = fs.readFileSync(segmentPath);
      const base64Segment = segmentData.toString('base64');
      const startTimeMinutes = i * 60; // 每段 60 分钟

      console.log(`⏳ 正在转录第 ${i + 1}/${segmentPaths.length} 段（从 ${startTimeMinutes} 分钟开始）...`);

      const prompt = `请转录这段音频，并识别不同的说话人。重要：使用音频中的原始语言。

这是第 ${i + 1} 段（共 ${segmentPaths.length} 段），从原始音频的第 ${startTimeMinutes} 分钟开始。

【说话人识别要求 - 非常重要】
- 仔细聆听音频中不同的声音特征（音调、语速、音色）
- 根据声音特征区分不同的说话人
- 使用 [说话人1] [说话人2] [说话人3] 等标签标注每段话的说话人
- 即使只有细微差异，也要尝试区分不同的说话人
- 如果是对话或会议，通常会有多个说话人

【语言要求】
- 如果音频是中文，必须使用简体中文输出
- 如果音频是英文，使用英文输出

【格式要求】
1. 每行格式：[MM:SS] [说话人X] 内容
2. 时间戳从 [${startTimeMinutes}:00] 开始（相对于原始音频）
3. 每个段落长度在 200-400 字符之间
4. 说话人切换时必须换行并标注新的说话人

【输出示例】
[${startTimeMinutes}:00] [说话人1] 这是第一段完整的内容...
[${startTimeMinutes}:45] [说话人2] 这是第二段完整的内容...

【重要】
- 保持语言一致，中文音频必须输出简体中文
- 一定要区分说话人，不要把所有内容都归为同一个说话人`;

      try {
        // 使用 AbortController 控制超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const result = await model.generateContent(
          [
            {
              inlineData: {
                data: base64Segment,
                mimeType,
              },
            },
            prompt,
          ],
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        const response = result.response;
        const transcription = response.text();

        if (transcription) {
          allTranscripts.push(transcription);
          console.log(`   ✅ 第 ${i + 1} 段转录完成，长度: ${transcription.length} 字符`);

          const finishReason = response.candidates?.[0]?.finishReason;
          if (finishReason === 'MAX_TOKENS') {
            console.warn(`   ⚠️ 第 ${i + 1} 段可能被截断（达到 token 限制）`);
          }
        } else {
          console.warn(`   ⚠️ 第 ${i + 1} 段转录结果为空`);
          allTranscripts.push(`[第 ${i + 1} 段转录结果为空]`);
        }
      } catch (error: any) {
        console.error(`   ❌ 第 ${i + 1} 段转录失败:`, error.message);
        allTranscripts.push(`[第 ${i + 1} 段转录失败: ${error.message}]`);
      }

      // API 限流保护：每次调用间隔 2 秒
      if (i < segmentPaths.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 合并所有转录结果
    const fullText = allTranscripts.join('\n\n');
    console.log(`✅ 分段转录完成，总长度: ${fullText.length} 字符`);

    // 解析合并后的文本
    const parsedSegments = parseGeminiTranscript(fullText);

    // 转换繁体为简体
    const convertedText = convertTraditionalToSimplified(parsedSegments.text || fullText);
    const convertedSegments = parsedSegments.segments.map(segment => ({
      ...segment,
      text: convertTraditionalToSimplified(segment.text)
    }));

    return {
      text: convertedText,
      segments: convertedSegments.length > 0 ? convertedSegments : []
    };
  } finally {
    // 清理所有临时文件
    console.log('🧹 清理临时文件...');
    for (const tempFile of tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (e) {
        // 忽略清理错误
      }
    }
  }
}

/**
 * 使用 Gemini 进行音频转录（使用 File API）
 */
export async function transcribeWithGemini(fileUrl: string, providedApiKey?: string, geminiModel?: string): Promise<TranscriptionResult> {
  let audioData: Buffer | undefined;
  let tempFilePath: string | undefined;
  let uploadedFile: any | undefined;

  try {
    // 检查 API 密钥（优先使用传入的，否则使用环境变量）
    const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未设置，请在客户端配置或环境变量中设置');
    }

    console.log('🔑 使用 Gemini API 进行转录（File API 模式）...');

    // 设置请求超时时间（10 分钟）- 必须传递给 SDK，否则默认只有 30s
    const timeoutMs = 600000; // 600秒 = 10分钟
    const requestOptions = {
      timeout: timeoutMs, // 传递给底层 HTTP 客户端
    };

    // 创建 File Manager 和 GenerativeAI 实例
    const fileManager = new GoogleAIFileManager(apiKey);
    const genAI = new GoogleGenerativeAI(apiKey);

    // 使用配置的模型（默认 gemini-2.5-flash），设置最大输出 token
    const selectedModel = geminiModel || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({
      model: selectedModel,
      generationConfig: {
        maxOutputTokens: 65536,
      }
    }, requestOptions);

    console.log('✅ 使用模型: gemini-2.5-flash, maxOutputTokens: 65536, timeout: 600s (已配置到 SDK)');

    // 判断是本地文件还是 GCS URL
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // GCS URL，从 GCS 下载
      console.log('📥 从 GCS 下载文件...');
      audioData = await downloadFile(fileUrl);
    } else {
      // 本地文件（开发环境）
      audioData = fs.readFileSync(fileUrl);
    }

    if (!audioData) {
      throw new Error('无法读取音频文件数据');
    }

    // 获取文件扩展名
    const ext = path.extname(fileUrl).toLowerCase();
    let fileSizeMB = audioData.length / 1024 / 1024;
    console.log(`📦 原始音频文件大小: ${fileSizeMB.toFixed(2)}MB`);

    // 如果文件超过 30MB，先进行压缩
    const compressThresholdMB = 30;
    if (fileSizeMB > compressThresholdMB) {
      console.log(`⚠️ 文件超过 ${compressThresholdMB}MB，开始压缩...`);
      try {
        audioData = await compressAudio(audioData, ext, 15);
        fileSizeMB = audioData.length / 1024 / 1024;
      } catch (compressError: any) {
        console.warn('压缩失败，继续使用原始文件:', compressError.message);
      }
    }

    console.log(`📦 处理后音频大小: ${fileSizeMB.toFixed(2)}MB`);

    // 确定 MIME 类型
    const mimeTypeMap: { [key: string]: string } = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
    };
    const mimeType = fileSizeMB > compressThresholdMB ? 'audio/mpeg' : (mimeTypeMap[ext] || 'audio/mpeg');
    console.log(`🎵 文件类型: ${ext}, MIME类型: ${mimeType}`);

    // 保存到临时文件（用于获取时长和 File API 上传）
    const timestamp = Date.now();
    const tempExt = fileSizeMB > compressThresholdMB ? '.mp3' : ext;
    tempFilePath = path.join(os.tmpdir(), `gemini_upload_${timestamp}${tempExt}`);
    fs.writeFileSync(tempFilePath, audioData);
    console.log(`📁 临时文件已保存: ${tempFilePath}`);

    // 获取实际音频时长
    let audioDurationMinutes = 0;
    try {
      const duration = await getAudioDuration(tempFilePath);
      audioDurationMinutes = duration / 60;
      console.log(`📊 实际音频时长: ${audioDurationMinutes.toFixed(1)} 分钟`);
    } catch (e: any) {
      // 如果无法获取时长，根据文件大小估算（假设 128kbps）
      audioDurationMinutes = fileSizeMB / 0.96;
      console.log(`📊 估算音频时长: ${audioDurationMinutes.toFixed(1)} 分钟（无法获取实际时长）`);
    }

    // 如果音频超过 25 分钟，使用分段转录避免模型提前结束
    if (audioDurationMinutes > 25) {
      console.log(`⚠️ 音频较长（>25分钟），将使用分段转录（每段25分钟）确保完整转录...`);
      // 清理临时文件，因为分段转录函数会自己处理
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        tempFilePath = undefined;
      }
      return await transcribeWithGeminiChunkedFileAPI(audioData, mimeType, apiKey, fileUrl, geminiModel);
    }

    // 使用 File API 上传文件到 Google 服务器
    console.log('📤 正在上传文件到 Google 服务器...');
    const uploadResult = await fileManager.uploadFile(tempFilePath, {
      mimeType: mimeType,
      displayName: `audio_${timestamp}`,
    });
    uploadedFile = uploadResult.file;
    console.log(`✅ 文件上传成功: ${uploadedFile.name}, URI: ${uploadedFile.uri}`);

    // 等待文件处理完成（最多等待 5 分钟，防止无限循环）
    let file = uploadedFile;
    const fileProcessingTimeout = 5 * 60 * 1000; // 5分钟
    const fileProcessingStart = Date.now();
    while (file.state === 'PROCESSING') {
      if (Date.now() - fileProcessingStart > fileProcessingTimeout) {
        throw new Error('Google 文件处理超时（5分钟），请稍后重试');
      }
      console.log('⏳ 等待文件处理...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      file = await fileManager.getFile(file.name);
    }

    if (file.state === 'FAILED') {
      throw new Error('文件处理失败');
    }

    console.log(`✅ 文件处理完成，状态: ${file.state}`);

    // 生成转录 - 使用 File API
    console.log('⏳ 正在调用 Gemini API 进行转录...');
    const prompt = `请转录这段音频，并识别不同的说话人。重要：使用音频中的原始语言。

【说话人识别要求 - 非常重要】
- 仔细聆听音频中不同的声音特征（音调、语速、音色）
- 根据声音特征区分不同的说话人
- 使用 [说话人1] [说话人2] [说话人3] 等标签标注每段话的说话人
- 即使只有细微差异，也要尝试区分不同的说话人
- 如果是对话或会议，通常会有多个说话人

【语言要求】
- 如果音频是中文，必须使用简体中文输出
- 如果音频是英文，使用英文输出
- 保持音频原始语言，不要翻译

【格式要求】
1. 每行格式：[MM:SS] [说话人X] 内容
2. 时间戳从 [00:00] 开始
3. 每个段落应该包含完整的句子，长度在 200-400 字符之间
4. 说话人切换时必须换行并标注新的说话人
5. 同一说话人连续说话可以合并，但换人时一定要换行

【输出示例】
[00:00] [说话人1] 大家好，今天我们来讨论一下...
[00:35] [说话人2] 好的，我先来介绍一下背景情况...
[01:20] [说话人1] 明白了，那我们接下来看看...

【重要】
- 保持语言一致，中文音频必须输出简体中文
- 按照音频的实际时间顺序输出
- 一定要区分说话人，不要把所有内容都归为同一个说话人`;

    // 使用 AbortController 控制超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let result;
    try {
      result = await model.generateContent(
        [
          {
            fileData: {
              fileUri: file.uri,
              mimeType: file.mimeType,
            },
          },
          prompt,
        ],
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const response = result.response;
    const transcription = response.text();

    if (!transcription) {
      throw new Error('转录结果为空');
    }

    // 检查是否因为 token 限制被截断
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.warn('⚠️ 警告: 转录结果可能被截断（达到 token 限制）');
    }

    console.log(`✅ Gemini 转录成功，文本长度: ${transcription.length} 字符, 完成原因: ${finishReason || 'STOP'}`);

    // 尝试解析带时间戳的转录文本
    const parsedSegments = parseGeminiTranscript(transcription);

    if (parsedSegments.segments.length > 0) {
      console.log(`✅ 解析到 ${parsedSegments.segments.length} 个分段`);
      // 转换文本和分段中的繁体中文为简体中文
      const convertedText = convertTraditionalToSimplified(parsedSegments.text);
      const convertedSegments = parsedSegments.segments.map(segment => ({
        ...segment,
        text: convertTraditionalToSimplified(segment.text)
      }));
      return {
        text: convertedText,
        segments: convertedSegments
      };
    }

    // 如果没有解析到分段，返回纯文本（转换繁体为简体）
    return {
      text: convertTraditionalToSimplified(transcription),
      segments: []
    };
  } catch (error: any) {
    console.error('❌ Gemini 转录错误:', error);
    console.error('错误详情:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      stack: error.stack,
    });

    // 提供更详细的错误信息
    if (error.message?.includes('API_KEY')) {
      throw new Error('Gemini API 密钥无效或未配置，请检查 GEMINI_API_KEY 环境变量');
    } else if (error.message?.includes('fetch failed') || error.message?.includes('fetch')) {
      // 网络错误或文件过大
      const fileSizeMB = audioData ? (audioData.length / 1024 / 1024).toFixed(2) : '未知';
      const base64SizeMB = audioData ? ((audioData.length * 1.33) / 1024 / 1024).toFixed(2) : '未知';
      throw new Error(
        `Gemini API 请求失败（fetch failed）。可能的原因：\n\n` +
        `1. 文件太大：当前文件 ${fileSizeMB}MB，Base64 编码后约 ${base64SizeMB}MB，可能超过 20MB 限制\n` +
        `2. 网络连接问题：请检查网络连接或稍后重试\n` +
        `3. 请求超时：大文件上传可能需要更长时间\n\n` +
        `建议解决方案：\n` +
        `- 使用通义千问（Qwen）进行转录（支持更大的文件）\n` +
        `- 压缩音频文件后再试（建议压缩到 15MB 以下）\n` +
        `- 检查网络连接并重试`
      );
    } else if (error.response?.status === 429) {
      throw new Error('Gemini API 请求频率过高，请稍后重试');
    } else if (error.response?.status === 400) {
      throw new Error(`Gemini API 请求错误: ${error.response?.data?.error?.message || error.message}`);
    } else if (error.response?.status === 413) {
      throw new Error('文件太大，超过 Gemini API 限制。建议使用通义千问（Qwen）进行转录。');
    } else if (error.name === 'AbortError') {
      throw new Error('Gemini 转录超时（10分钟），请尝试压缩音频文件或使用通义千问。');
    } else {
      throw new Error(`Gemini 转录失败: ${error.message || '未知错误'}`);
    }
  } finally {
    // 清理临时文件
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('🧹 已清理本地临时文件');
      } catch (e) {
        // 忽略清理错误
      }
    }

    // 删除 Google 服务器上的文件
    if (uploadedFile) {
      try {
        const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
        if (apiKey) {
          const fileManager = new GoogleAIFileManager(apiKey);
          await fileManager.deleteFile(uploadedFile.name);
          console.log('🧹 已清理 Google 服务器上的文件');
        }
      } catch (e) {
        // 忽略清理错误
      }
    }
  }
}

/**
 * 使用 Gemini 生成文本总结 (使用 REST API 绕过 SDK 编码问题)
 */
export async function generateSummaryWithGemini(text: string, providedApiKey?: string, customPrompt?: string, geminiModel?: string): Promise<string> {
  try {
    // 检查 API 密钥（优先使用传入的，否则使用环境变量）
    const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未设置，请在客户端配置或环境变量中设置');
    }

    console.log('📊 使用 Gemini REST API 生成总结...');

    // 检查 customPrompt
    if (!customPrompt || customPrompt.trim().length === 0) {
      throw new Error('未提供自定义 Prompt，请在前端 Prompt 设置中配置');
    }

    // 使用前端传递的自定义 Prompt
    const prompt = customPrompt.replace(/{text}/g, text);
    console.log('📝 使用自定义 Prompt (前 100 字符):', customPrompt.substring(0, 100));

    console.log(`⏳ 正在生成总结，文本长度: ${text.length} 字符...`);

    // 使用 REST API 直接调用 Gemini (绕过 SDK 的 ByteString 编码问题)
    const axios = require('axios');
    const model = geminiModel || 'gemini-2.5-pro';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(url, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 65536,
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5分钟超时（gemini-2.5-pro 是 thinking model，长文本需要更多时间）
    });

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('❌ Gemini 响应格式错误:', JSON.stringify(response.data, null, 2));
      throw new Error('Gemini 响应格式错误');
    }

    // 🔍 诊断：打印 finishReason 来判断截断原因
    const candidate = response.data.candidates[0];
    const finishReason = candidate.finishReason || 'UNKNOWN';
    console.log(`📋 Gemini finishReason: ${finishReason}`);

    // finishReason 说明:
    // - STOP: 模型自然结束（认为内容已完整）
    // - MAX_TOKENS: 达到 maxOutputTokens 限制被截断
    // - SAFETY: 安全过滤
    // - OTHER: 其他原因
    if (finishReason === 'MAX_TOKENS') {
      console.warn('⚠️ 警告：总结被 MAX_TOKENS 截断！考虑增加 maxOutputTokens 或分段生成');
    }

    const summary = response.data.candidates[0].content.parts[0].text;

    if (!summary) {
      throw new Error('总结结果为空');
    }

    // 打印更详细的输出信息
    const tokenCount = candidate.tokenCount || '未知';
    console.log(`✅ Gemini 总结生成成功`);
    console.log(`   - 输出长度: ${summary.length} 字符`);
    console.log(`   - finishReason: ${finishReason}`);
    console.log(`   - tokenCount: ${tokenCount}`);
    return summary;
  } catch (error: any) {
    console.error('❌ Gemini 总结错误:', error);
    console.error('错误详情:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    // 提取更有用的错误信息
    let errorMsg = error.message || '未知错误';
    if (error.response?.data?.error?.message) {
      errorMsg = error.response.data.error.message;
    }
    throw new Error(`Gemini 总结失败: ${errorMsg}`);
  }
}

/**
 * 使用 Gemini 生成标题和相关主题 (使用 REST API 绕过 SDK 编码问题)
 */
export async function generateTitleAndTopicsWithGemini(
  transcriptText: string,
  summary: string,
  providedApiKey?: string,
  date?: Date,
  geminiModel?: string
): Promise<TitleAndTopics> {
  try {
    const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未设置');
    }

    console.log('📝 使用 Gemini REST API 生成标题和相关主题...');

    // 格式化日期
    const dateStr = date
      ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const prompt = `请根据以下转录文本和总结，生成一个标题和5个相关主题。

要求：
1. 标题格式：主题---参会人员---日期
   - 主题：用简洁的词语概括会议/对话的核心主题（不超过10个字）
   - 参会人员：从转录文本中提取参与对话的人员（如果有多个，用逗号分隔；如果无法确定，写"未知"）
   - 日期：${dateStr}

2. 相关主题：生成5个与本次对话相关的主题标签，每个标签不超过6个字，用中文逗号分隔

转录文本（前500字）：
${transcriptText.substring(0, 500)}

总结：
${summary}

请严格按照以下JSON格式返回，不要包含任何其他文字：
{
  "title": "主题---参会人员---日期",
  "topics": ["主题1", "主题2", "主题3", "主题4", "主题5"]
}`;

    console.log('⏳ 正在生成标题和主题...');

    // 使用 REST API 直接调用 Gemini (绕过 SDK 的 ByteString 编码问题)
    const axios = require('axios');
    const model = geminiModel || 'gemini-2.5-pro';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await axios.post(url, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048,
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 600000, // 10分钟超时，支持长文本生成
    });

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Gemini 响应格式错误');
    }

    const text = response.data.candidates[0].content.parts[0].text;

    // 尝试解析JSON（可能包含markdown代码块）
    let jsonText = text.trim();
    // 移除可能的markdown代码块标记
    if (jsonText.startsWith('```')) {
      const lines = jsonText.split('\n');
      jsonText = lines.slice(1, -1).join('\n').trim();
    }
    if (jsonText.startsWith('```json')) {
      const lines = jsonText.split('\n');
      jsonText = lines.slice(1, -1).join('\n').trim();
    }

    // 尝试修复不完整的 JSON
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      console.log('⚠️ 首次解析失败，尝试修复 JSON...');

      // 尝试修复常见的 JSON 截断问题
      let fixedJson = jsonText;

      // 如果 JSON 以 [ 开始但没有闭合，尝试闭合
      const openBrackets = (fixedJson.match(/\[/g) || []).length;
      const closeBrackets = (fixedJson.match(/\]/g) || []).length;
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        fixedJson += ']';
      }

      // 如果 JSON 以 { 开始但没有闭合，尝试闭合
      const openBraces = (fixedJson.match(/\{/g) || []).length;
      const closeBraces = (fixedJson.match(/\}/g) || []).length;
      for (let i = 0; i < openBraces - closeBraces; i++) {
        fixedJson += '}';
      }

      console.log('📝 修复后的 JSON:', fixedJson.substring(0, 300) + '...');

      try {
        parsed = JSON.parse(fixedJson);
        console.log('✅ 修复后解析成功');
      } catch (secondError) {
        console.log('⚠️ 修复后仍然解析失败，使用正则提取关键信息');
        // 使用正则表达式提取关键字段
        const topicMatch = jsonText.match(/"topic"\s*:\s*"([^"]+)"/);
        const companiesMatch = jsonText.match(/"companies"\s*:\s*"([^"]+)"/);
        const intermediaryMatch = jsonText.match(/"intermediary"\s*:\s*"([^"]+)"/);
        const industryMatch = jsonText.match(/"industry"\s*:\s*"([^"]+)"/);
        const countryMatch = jsonText.match(/"country"\s*:\s*"([^"]+)"/);
        const participantsMatch = jsonText.match(/"participants"\s*:\s*"([^"]+)"/);
        const eventDateMatch = jsonText.match(/"eventDate"\s*:\s*"([^"]+)"/);

        parsed = {
          topic: topicMatch ? topicMatch[1] : '未知主题',
          companies: companiesMatch ? companiesMatch[1] : '相关公司',
          intermediary: intermediaryMatch ? intermediaryMatch[1] : '未知',
          industry: industryMatch ? industryMatch[1] : '未知',
          country: countryMatch ? countryMatch[1] : '中国',
          participants: participantsMatch ? participantsMatch[1] : '未知',
          eventDate: eventDateMatch ? eventDateMatch[1] : '未提及',
          relatedTopics: []
        };
        console.log('✅ 使用正则提取成功:', JSON.stringify(parsed).substring(0, 200));
      }
    }

    if (!parsed.title || !Array.isArray(parsed.topics) || parsed.topics.length !== 5) {
      throw new Error('AI返回的格式不正确');
    }

    console.log(`✅ 标题和主题生成成功: ${parsed.title}`);
    return {
      title: parsed.title,
      topics: parsed.topics.slice(0, 5) // 确保只有5个
    };
  } catch (error: any) {
    console.error('❌ 生成标题和主题错误:', error);
    // 如果生成失败，返回默认值
    const dateStr = date
      ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    return {
      title: `会议---未知---${dateStr}`,
      topics: ['会议', '转录', '对话', '讨论', '记录']
    };
  }
}

/**
 * 使用 Gemini 提取元数据 (使用 REST API 绕过 SDK 编码问题)
 */
export async function extractMetadataWithGemini(
  transcriptText: string,
  summary: string,
  providedApiKey?: string,
  customMetadataPrompt?: string,
  geminiModel?: string
): Promise<ExtractedMetadata> {
  try {
    const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 未设置');
    }

    const model = geminiModel || 'gemini-2.5-flash';
    console.log(`📝 使用 Gemini REST API 提取元数据 (model=${model})...`);

    // 使用自定义 Prompt 或默认 Prompt 模板
    const isCustomPrompt = !!customMetadataPrompt;
    const promptTemplate = customMetadataPrompt || getMetadataExtractionPromptTemplate();
    // 使用 split+join 替代 replace，避免 transcriptText 中的 $& $' $` 等特殊替换模式被解释
    const prompt = promptTemplate.split('{text}').join(transcriptText);
    console.log('📝 使用' + (isCustomPrompt ? '自定义' : '默认') + ` Prompt 模板，prompt长度=${prompt.length}`);

    console.log('⏳ 正在提取元数据...');

    // 使用 REST API 直接调用 Gemini (绕过 SDK 的 ByteString 编码问题)
    const axios = require('axios');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // 构建 generationConfig — 非自定义 prompt 时使用 JSON 模式强制输出有效 JSON
    const generationConfig: any = {
      temperature: 0.3,
      maxOutputTokens: 2048,
    };
    if (!isCustomPrompt) {
      generationConfig.responseMimeType = 'application/json';
    }

    const response = await axios.post(url, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 300000, // 5分钟超时
    });

    // 检查是否被安全过滤器拦截
    if (response.data?.candidates?.[0]?.finishReason === 'SAFETY') {
      console.error('❌ Gemini 响应被安全过滤器拦截:', JSON.stringify(response.data.candidates[0].safetyRatings, null, 2));
      throw new Error('Gemini 安全过滤器拦截了元数据提取请求');
    }

    if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('❌ Gemini 响应格式错误:', JSON.stringify(response.data, null, 2).substring(0, 1000));
      throw new Error('Gemini 响应格式错误');
    }

    const text = response.data.candidates[0].content.parts[0].text;
    console.log('📝 Gemini 原始响应 (前500字):', text.substring(0, 500));

    // 解析 JSON 响应
    const parsed = parseMetadataJson(text);

    // 确保公司和国家不是"未知"
    let organization = parsed.organization || '相关公司';
    if (organization === '未知' || organization.trim() === '') {
      organization = '相关公司';
    }

    let country = parsed.country || '中国';
    if (country === '未知' || country.trim() === '' || !['中国', '美国', '日本', '韩国', '欧洲', '印度', '其他'].includes(country)) {
      country = '中国'; // 默认为中国
    }

    // 参与人类型：AI 应该返回 "management"、"expert" 或 "sellside" 之一
    const participants = parsed.participants || 'management';

    console.log(`✅ 元数据提取成功: 主题=${parsed.topic}, 公司=${organization}, 演讲人=${parsed.speaker}, 中介=${parsed.intermediary}, 行业=${parsed.industry}, 国家=${country}, 参与人=${participants}`);
    return {
      topic: parsed.topic || '未知主题',
      organization,
      speaker: parsed.speaker || '',
      intermediary: parsed.intermediary || '未知',
      industry: parsed.industry || '未知',
      country,
      participants,
      eventDate: parsed.eventDate || '未提及',
      relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics.slice(0, 5) : [],
    };
  } catch (error: any) {
    // 详细记录错误信息，方便诊断
    const errMsg = error?.response?.data ? JSON.stringify(error.response.data).substring(0, 500) : error.message;
    console.error('❌ 提取元数据错误:', errMsg);
    if (error?.response?.status) {
      console.error('   HTTP Status:', error.response.status);
    }
    if (error?.stack) {
      console.error('   Stack:', error.stack.substring(0, 300));
    }
    // 返回默认值
    return {
      topic: '会议记录',
      organization: '相关公司',
      speaker: '',
      intermediary: '未知',
      industry: '未知',
      country: '中国',
      participants: 'management',
      eventDate: '未提及',
      relatedTopics: [],
    };
  }
}

/**
 * 解析元数据 JSON 文本（多层 fallback）
 */
function parseMetadataJson(rawText: string): any {
  let jsonText = rawText.trim();

  // 移除 markdown 代码块标记
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  jsonText = jsonText.trim();

  // 第一次尝试：直接解析（JSON 模式下通常能直接解析）
  try {
    return JSON.parse(jsonText);
  } catch (e1) {
    console.log('⚠️ 直接 JSON 解析失败，尝试修复...');
  }

  // 第二次尝试：修复换行符后解析
  let fixedText = jsonText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  // 移除尾随逗号
  fixedText = fixedText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try {
    return JSON.parse(fixedText);
  } catch (e2) {
    console.log('⚠️ 修复换行后仍然解析失败，尝试正则提取...');
  }

  // 第三次尝试：正则提取关键字段（最终 fallback）
  const topicMatch = rawText.match(/"topic"\s*:\s*"([^"]+)"/);
  const organizationMatch = rawText.match(/"organization"\s*:\s*"([^"]+)"/);
  const speakerMatch = rawText.match(/"speaker"\s*:\s*"([^"]+)"/);
  const intermediaryMatch = rawText.match(/"intermediary"\s*:\s*"([^"]+)"/);
  const industryMatch = rawText.match(/"industry"\s*:\s*"([^"]+)"/);
  const countryMatch = rawText.match(/"country"\s*:\s*"([^"]+)"/);
  const participantsMatch = rawText.match(/"participants"\s*:\s*"([^"]+)"/);
  const eventDateMatch = rawText.match(/"eventDate"\s*:\s*"([^"]+)"/);

  const parsed = {
    topic: topicMatch ? topicMatch[1] : '未知主题',
    organization: organizationMatch ? organizationMatch[1] : '相关公司',
    speaker: speakerMatch ? speakerMatch[1] : '',
    intermediary: intermediaryMatch ? intermediaryMatch[1] : '未知',
    industry: industryMatch ? industryMatch[1] : '未知',
    country: countryMatch ? countryMatch[1] : '中国',
    participants: participantsMatch ? participantsMatch[1] : '未知',
    eventDate: eventDateMatch ? eventDateMatch[1] : '未提及',
    relatedTopics: []
  };
  console.log('✅ 正则提取结果:', JSON.stringify(parsed).substring(0, 300));
  return parsed;
}
