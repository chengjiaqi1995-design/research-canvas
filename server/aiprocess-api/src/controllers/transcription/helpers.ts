import prisma, { createTaskClient } from '../../utils/db';
import { transcribeAudio, generateSummary, extractMetadata, ExtractedMetadata } from '../../services/aiService';
import type { AIProvider } from '../../types';

/**
 * 格式化参与者名称用于标题
 */
export function formatParticipantsForTitle(participants: string): string {
  if (!participants) return 'Management';
  // AI 应该返回 "Management"、"Expert" 或 "Sellside" 之一，直接使用
  return participants;
}

/**
 * 异步处理转录
 */
export async function processTranscription(
  id: string,
  fileUrl: string,
  aiProvider: AIProvider,
  apiKey?: string,
  customPrompt?: string,
  qwenModel?: string,
  geminiApiKey?: string,
  modelConfig?: { transcriptionModel?: string; summaryModel?: string; metadataModel?: string }
) {
  // 保存转录结果，即使后续步骤失败也能保留
  let transcriptTextJson: string | null = null;

  // 为长任务创建独立的 PrismaClient，避免：
  // 1. Cloud SQL Proxy 在长 AI 调用期间断开空闲连接
  // 2. reconnectDB() 影响其他并发请求的全局 prisma 实例
  const taskDb = createTaskClient();

  /** 安全写入数据库：每次操作前新建连接，操作后断开，避免空闲连接被断开 */
  async function safeDbUpdate(data: any) {
    try {
      await taskDb.$connect();
      await taskDb.transcription.update({ where: { id }, data });
    } finally {
      await taskDb.$disconnect().catch(() => {});
    }
  }

  try {
    const t0 = Date.now();
    console.log(`📝 开始处理转录: ${id}, 文件: ${fileUrl}, AI服务: ${aiProvider}`);
    console.log(`📁 文件 GCS URL: ${fileUrl}`);

    // Step 1: 更新状态为处理中 - 转录阶段
    await safeDbUpdate({ status: 'processing', processingStep: 'transcribing' });

    // 执行转录
    console.log(`🎤 开始转录，使用 ${aiProvider} 服务${qwenModel ? `, 模型: ${qwenModel}` : ''}...`);
    const transcriptResult = await transcribeAudio(fileUrl, aiProvider, apiKey, qwenModel, modelConfig?.transcriptionModel);

    if (!transcriptResult.text || transcriptResult.text.trim().length === 0) {
      throw new Error('转录结果为空');
    }

    const t1 = Date.now();
    console.log(`✅ 转录完成，文本长度: ${transcriptResult.text.length} 字符，分段数: ${transcriptResult.segments?.length || 0}，耗时: ${((t1 - t0) / 1000).toFixed(1)}s`);

    // 将转录结果（包括分段信息）存储为 JSON
    const transcriptData = {
      text: transcriptResult.text,
      segments: transcriptResult.segments || []
    };
    transcriptTextJson = JSON.stringify(transcriptData);

    // Step 2: 保存转录结果
    await safeDbUpdate({
      transcriptText: transcriptTextJson,
      status: 'processing',
      processingStep: 'summarizing',
    });
    console.log(`💾 转录结果已保存到数据库`);

    // Step 3: 生成总结，始终使用 Gemini
    console.log(`📊 开始生成总结，强制使用 Gemini 服务...`);
    const geminiApiKeyForSummary = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!geminiApiKeyForSummary) {
      throw new Error('Gemini API 密钥未设置，无法生成总结');
    }
    const summary = await generateSummary(transcriptResult.text, 'gemini', geminiApiKeyForSummary, customPrompt, modelConfig?.summaryModel);

    if (!summary || summary.trim().length === 0) {
      throw new Error('总结结果为空');
    }

    const t2 = Date.now();
    console.log(`✅ 总结生成完成，长度: ${summary.length} 字符，耗时: ${((t2 - t1) / 1000).toFixed(1)}s`);

    // Step 4: 提取元数据
    await safeDbUpdate({ processingStep: 'extracting_metadata' });

    console.log(`📝 开始提取元数据和相关主题，强制使用 Gemini 服务...`);
    let metadata: ExtractedMetadata = {
      topic: '未知',
      organization: '未知',
      speaker: '',
      intermediary: '未知',
      industry: '未知',
      country: '未知',
      participants: '未知',
      eventDate: '未提及',
      relatedTopics: [] as string[],
    };

    try {
      const geminiApiKeyForMetadata = geminiApiKey || process.env.GEMINI_API_KEY;
      if (!geminiApiKeyForMetadata) {
        console.warn('⚠️  Gemini API 密钥未设置，元数据提取将使用默认值');
        throw new Error('Gemini API 密钥未设置');
      }

      const extracted = await extractMetadata(
        transcriptResult.text,
        summary,
        'gemini',
        geminiApiKeyForMetadata,
        undefined,
        modelConfig?.metadataModel
      );
      metadata = extracted;
      const t3 = Date.now();
      console.log(`✅ 元数据提取成功，耗时: ${((t3 - t2) / 1000).toFixed(1)}s，主题=${metadata.topic}, 公司=${metadata.organization}, 演讲人=${metadata.speaker}, 中介=${metadata.intermediary}`);
    } catch (error: any) {
      console.error('⚠️ 提取元数据失败，使用默认值:', error.message);
    }

    // Step 5: 最终保存
    await safeDbUpdate({ processingStep: 'finalizing' });

    // 如果 eventDate 是"未提及"，使用创建时间
    let displayDate = metadata.eventDate;
    if (metadata.eventDate === '未提及') {
      try {
        await taskDb.$connect();
        const transcriptionRecord = await taskDb.transcription.findUnique({
          where: { id },
          select: { createdAt: true },
        });
        if (transcriptionRecord) {
          displayDate = new Date(transcriptionRecord.createdAt).toLocaleDateString('zh-CN');
        }
      } finally {
        await taskDb.$disconnect().catch(() => {});
      }
    }

    const formattedParticipants = formatParticipantsForTitle(metadata.participants);
    const newFileName = `${metadata.topic}-${metadata.organization}-${metadata.speaker}-${formattedParticipants}-${metadata.country}-${displayDate}`;
    console.log(`✅ 生成标题: ${newFileName}`);

    // 最终更新
    await safeDbUpdate({
      transcriptText: transcriptTextJson,
      summary,
      fileName: newFileName,
      tags: JSON.stringify(metadata.relatedTopics || []),
      topic: metadata.topic,
      organization: metadata.organization,
      speaker: metadata.speaker,
      intermediary: metadata.intermediary,
      industry: metadata.industry,
      country: metadata.country,
      participants: metadata.participants,
      eventDate: displayDate,
      status: 'completed',
      processingStep: null,
    });

    const tEnd = Date.now();
    console.log(`🎉 转录处理完成: ${id}，总耗时: ${((tEnd - t0) / 1000).toFixed(1)}s`);
  } catch (error: any) {
    console.error('❌ 处理转录错误:', error);
    console.error('错误堆栈:', error.stack);

    const errorMessage = error.message || '转录失败';
    const errorDetails = error.response?.data || error.cause || '';
    console.error('错误详情:', errorDetails);

    const updateData: any = {
      status: 'failed',
      processingStep: null,
      errorMessage: `${errorMessage}${errorDetails ? ` - ${JSON.stringify(errorDetails)}` : ''}`,
    };

    if (transcriptTextJson) {
      updateData.transcriptText = transcriptTextJson;
      console.log(`💾 虽然后续处理失败，但转录结果已保存`);
    }

    try {
      await safeDbUpdate(updateData);
    } catch (dbError: any) {
      console.error('⚠️ 保存错误状态到数据库也失败:', dbError.message);
    }
  } finally {
    // 确保独立客户端被清理
    await taskDb.$disconnect().catch(() => {});
  }
}

/**
 * 异步生成总结
 */
export async function generateSummaryAsync(transcriptionId: string, text: string) {
  try {
    // 延迟 1 秒开始，避免数据库锁
    await new Promise(resolve => setTimeout(resolve, 1000));

    const { generateSummary } = await import('../../services/aiService');
    const summary = await generateSummary(text, 'gemini');

    if (summary) {
      await prisma.transcription.update({
        where: { id: transcriptionId },
        data: { summary },
      });
      console.log(`✅ 笔记总结生成完成: ${transcriptionId}`);
    }
  } catch (error) {
    console.error(`❌ 笔记总结生成失败: ${transcriptionId}`, error);
  }
}
