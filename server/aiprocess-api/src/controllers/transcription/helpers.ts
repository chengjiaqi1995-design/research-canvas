import prisma, { createTaskClient } from '../../utils/db';
import { transcribeAudio, generateSummary } from '../../services/aiService';
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
 * 保留第一个公司名（AI 可能返回多个）
 */
function guardSingleOrg(org: string): string {
  if (!org) return '';
  return org.split(/[,，、;；]/)[0].trim();
}

/**
 * 阶段二：后处理（生成总结 + 元数据提取，合并为一次 AI 调用）
 * 在 Gemini 后处理队列中执行（并发数 2），与转录流水线并行
 * 如果前端传了 metadataFillPrompt，则在 summary prompt 后追加元数据提取指令，
 * AI 一次返回总结 + ===METADATA=== + JSON，后端解析后一起保存。
 */
export async function performPostProcessing(
  id: string,
  transcriptText: string,
  transcriptTextJson: string,
  geminiApiKey?: string,
  customPrompt?: string,
  summaryModel?: string,
  metadataModel?: string,
  metadataFillPrompt?: string
): Promise<void> {
  const taskDb = createTaskClient();

  try {
    const t0 = Date.now();
    console.log(`📊 [Phase2] 开始后处理: ${id}${metadataFillPrompt ? '（总结+元数据合并调用）' : '（仅总结）'}`);

    const geminiKey = geminiApiKey;
    if (!geminiKey) {
      throw new Error('Gemini API 密钥未设置，无法生成总结');
    }

    // 如果有 metadataFillPrompt，合并为一次调用
    let effectivePrompt = customPrompt;
    if (metadataFillPrompt && effectivePrompt) {
      // 获取创建时间（从 DB 读取）
      let createdDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
      try {
        const record = await taskDb.transcription.findUnique({ where: { id }, select: { createdAt: true } });
        if (record?.createdAt) {
          createdDate = new Date(record.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
        }
      } catch {}

      effectivePrompt = effectivePrompt +
        `\n\n===\n\n` +
        `完成以上总结后，请在总结内容最末尾另起一行，输出分隔符 ===METADATA=== ，然后输出以下元数据的 JSON。\n` +
        `创建时间：${createdDate}\n\n` +
        metadataFillPrompt;
    }

    const rawResult = await generateSummary(transcriptText, 'gemini', geminiKey, effectivePrompt, summaryModel);

    if (!rawResult || rawResult.trim().length === 0) {
      throw new Error('总结结果为空');
    }

    // 解析：如果包含 ===METADATA===，拆分总结和元数据
    let summary = rawResult;
    let metadataUpdate: Record<string, any> = {};

    if (metadataFillPrompt && rawResult.includes('===METADATA===')) {
      const parts = rawResult.split('===METADATA===');
      summary = parts[0].trim();
      const metadataPart = parts[1] || '';
      try {
        const jsonMatch = metadataPart.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log(`📋 [Phase2] 元数据提取成功:`, JSON.stringify(parsed));
          // 只保存非空字段
          if (parsed.topic) metadataUpdate.topic = parsed.topic;
          if (parsed.organization) metadataUpdate.organization = guardSingleOrg(parsed.organization);
          if (parsed.speaker) metadataUpdate.speaker = parsed.speaker;
          if (parsed.participants) metadataUpdate.participants = parsed.participants;
          if (parsed.intermediary) metadataUpdate.intermediary = parsed.intermediary;
          if (parsed.industry) metadataUpdate.industry = parsed.industry;
          if (parsed.country) metadataUpdate.country = parsed.country;
          if (parsed.eventDate) metadataUpdate.eventDate = parsed.eventDate;
        }
      } catch (parseErr: any) {
        console.warn(`⚠️ [Phase2] 元数据 JSON 解析失败，跳过:`, parseErr.message);
      }
    }

    const t1 = Date.now();
    const metaFields = Object.keys(metadataUpdate).length;
    console.log(`✅ [Phase2] 总结完成，长度: ${summary.length} 字符${metaFields > 0 ? `，元数据: ${metaFields} 个字段` : ''}，耗时: ${((t1 - t0) / 1000).toFixed(1)}s`);

    // 最终保存
    await safeDbUpdate(taskDb, id, { processingStep: 'finalizing' });

    await safeDbUpdate(taskDb, id, {
      transcriptText: transcriptTextJson,
      summary,
      ...metadataUpdate,
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
        transcriptText: transcriptTextJson,
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
