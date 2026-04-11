import prisma, { createTaskClient } from '../../utils/db';
import { transcribeAudio, generateSummary, extractMetadata, ExtractedMetadata } from '../../services/aiService';
import type { AIProvider } from '../../types';

/**
 * 格式化参与者名称用于标题
 */
export function formatParticipantsForTitle(participants: string): string {
  if (!participants) return 'Management';
  return participants;
}

/** 安全写入数据库：每次操作前新建连接，操作后断开，避免空闲连接被断开 */
async function safeDbUpdate(taskDb: ReturnType<typeof createTaskClient>, id: string, data: any) {
  try {
    await taskDb.$connect();
    await taskDb.transcription.update({ where: { id }, data });
  } finally {
    await taskDb.$disconnect().catch(() => {});
  }
}

/**
 * 阶段一：音频转录
 * 在 DashScope 转录队列中执行（并发数 2）
 * 返回转录结果供阶段二使用，失败时返回 null 并将 DB 标记为 failed
 */
export async function performTranscription(
  id: string,
  fileUrl: string,
  aiProvider: AIProvider,
  apiKey?: string,
  qwenModel?: string,
  transcriptionModel?: string
): Promise<{ transcriptText: string; transcriptTextJson: string } | null> {
  const taskDb = createTaskClient();

  try {
    const t0 = Date.now();
    console.log(`📝 [Phase1] 开始转录: ${id}, 文件: ${fileUrl}, AI服务: ${aiProvider}`);

    await safeDbUpdate(taskDb, id, { status: 'processing', processingStep: 'transcribing' });

    console.log(`🎤 开始转录，使用 ${aiProvider} 服务${qwenModel ? `, 模型: ${qwenModel}` : ''}...`);
    const transcriptResult = await transcribeAudio(fileUrl, aiProvider, apiKey, qwenModel, transcriptionModel);

    if (!transcriptResult.text || transcriptResult.text.trim().length === 0) {
      throw new Error('转录结果为空');
    }

    const t1 = Date.now();
    console.log(`✅ [Phase1] 转录完成，文本长度: ${transcriptResult.text.length} 字符，分段数: ${transcriptResult.segments?.length || 0}，耗时: ${((t1 - t0) / 1000).toFixed(1)}s`);

    const transcriptData = {
      text: transcriptResult.text,
      segments: transcriptResult.segments || [],
    };
    const transcriptTextJson = JSON.stringify(transcriptData);

    await safeDbUpdate(taskDb, id, {
      transcriptText: transcriptTextJson,
      status: 'processing',
      processingStep: 'summarizing',
    });
    console.log(`💾 [Phase1] 转录结果已保存到数据库，等待后处理队列`);

    return { transcriptText: transcriptResult.text, transcriptTextJson };
  } catch (error: any) {
    console.error(`❌ [Phase1] 转录错误 ${id}:`, error.message);
    console.error('错误堆栈:', error.stack);
    try {
      await safeDbUpdate(taskDb, id, {
        status: 'failed',
        processingStep: null,
        errorMessage: error.message || '转录失败',
      });
    } catch (dbError: any) {
      console.error('⚠️ [Phase1] 保存错误状态失败:', dbError.message);
    }
    return null;
  } finally {
    await taskDb.$disconnect().catch(() => {});
  }
}

/**
 * 阶段二：后处理（总结 + 元数据提取 + 最终保存）
 * 在 Gemini 后处理队列中执行（并发数 2），与转录流水线并行
 */
export async function performPostProcessing(
  id: string,
  transcriptText: string,
  transcriptTextJson: string,
  geminiApiKey?: string,
  customPrompt?: string,
  summaryModel?: string,
  metadataModel?: string
): Promise<void> {
  const taskDb = createTaskClient();

  try {
    const t0 = Date.now();
    console.log(`📊 [Phase2] 开始后处理: ${id}`);

    // Step 3: 生成总结，强制使用 Gemini
    const geminiKey = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error('Gemini API 密钥未设置，无法生成总结');
    }
    const summary = await generateSummary(transcriptText, 'gemini', geminiKey, customPrompt, summaryModel);

    if (!summary || summary.trim().length === 0) {
      throw new Error('总结结果为空');
    }

    const t1 = Date.now();
    console.log(`✅ [Phase2] 总结完成，长度: ${summary.length} 字符，耗时: ${((t1 - t0) / 1000).toFixed(1)}s`);

    // Step 4: 提取元数据
    await safeDbUpdate(taskDb, id, { processingStep: 'extracting_metadata' });

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
      const extracted = await extractMetadata(transcriptText, summary, 'gemini', geminiKey, undefined, metadataModel);
      metadata = extracted;
      const t2 = Date.now();
      console.log(`✅ [Phase2] 元数据提取成功，耗时: ${((t2 - t1) / 1000).toFixed(1)}s，主题=${metadata.topic}, 公司=${metadata.organization}`);
    } catch (error: any) {
      console.error('⚠️ [Phase2] 提取元数据失败，使用默认值:', error.message);
    }

    // Step 5: 最终保存
    await safeDbUpdate(taskDb, id, { processingStep: 'finalizing' });

    let displayDate = metadata.eventDate;
    if (metadata.eventDate === '未提及') {
      try {
        await taskDb.$connect();
        const rec = await taskDb.transcription.findUnique({
          where: { id },
          select: { createdAt: true },
        });
        if (rec) {
          displayDate = new Date(rec.createdAt).toLocaleDateString('zh-CN');
        }
      } finally {
        await taskDb.$disconnect().catch(() => {});
      }
    }

    const formattedParticipants = formatParticipantsForTitle(metadata.participants);
    const newFileName = `${metadata.topic}-${metadata.organization}-${metadata.speaker}-${formattedParticipants}-${metadata.country}-${displayDate}`;
    console.log(`✅ [Phase2] 生成标题: ${newFileName}`);

    await safeDbUpdate(taskDb, id, {
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
    console.log(`🎉 [Phase2] 后处理完成: ${id}，耗时: ${((tEnd - t0) / 1000).toFixed(1)}s`);
  } catch (error: any) {
    console.error(`❌ [Phase2] 后处理错误 ${id}:`, error.message);
    console.error('错误堆栈:', error.stack);
    try {
      await safeDbUpdate(taskDb, id, {
        transcriptText: transcriptTextJson, // 保留转录结果
        status: 'failed',
        processingStep: null,
        errorMessage: error.message || '后处理失败',
      });
    } catch (dbError: any) {
      console.error('⚠️ [Phase2] 保存错误状态失败:', dbError.message);
    }
  } finally {
    await taskDb.$disconnect().catch(() => {});
  }
}

/**
 * 异步生成总结（用于笔记功能，与转录流水线无关）
 */
export async function generateSummaryAsync(transcriptionId: string, text: string) {
  try {
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
