import { useState, useEffect } from 'react';
import { message } from 'antd';
import { regenerateSummary } from '../api/transcription';
import type { Transcription } from '../types';
import { aiApi } from '../../db/apiClient';
import { useTrackerStore } from '../../stores/trackerStore';
import { generateId } from '../../utils/id';

async function performAutoTrackerSniffing(textContent: string, apiConfig: any) {
  const trackers = useTrackerStore.getState().trackers;
  const addInboxItem = useTrackerStore.getState().addInboxItem;
  
  if (!trackers || trackers.length === 0) return;

  const schemaDesc = trackers.map(t => {
    const eNames = t.entities?.map(e => e.name).join(', ') || '';
    const cNames = t.columns?.map(c => c.name).join(', ') || '';
    return `【看板：${t.name}】包括实体：[${eNames}]，包括指标：[${cNames}]`;
  }).join('\n');

  const model = apiConfig.summaryModel || 'gemini-3-flash-preview';
  const systemPrompt = `你是一个强大的情报分析专家。请仔细阅读用户提供的文本材料，并将文本段落中涉及到的行业、公司或者特定指标的重要数据提取出来。

当前系统中已经配置了以下监控看板：
${schemaDesc}

请识别出：
1. targetCompany（必须是你能在上面的配置里找到的相关实体名字，或者是文本里明确提到的一家公司/机构名）
2. targetMetric（必须是你能在上面的配置里找到的相关指标名字，或者是文本里明确提到的某个数据指标）
3. extractedValue（提取出的具体数字，可以带单位，比如 1.8亿。如果是字符串请保留）
4. timePeriod（文本里提及的数据时间，如 "2026-Q2"、"2026-05"、"本季度" 等。如果没有提及留空）
5. content（包含这个数据的那句原文，用来作为后续人工校验的依据）

只返回一个符合下面 JSON Array 格式的纯 JSON，不要包含任何 markdown 或外层包裹标记：
[
  {
    "targetCompany": "string",
    "targetMetric": "string",
    "extractedValue": "number or string",
    "timePeriod": "string",
    "content": "string"
  }
]
如果没有发现任何相关指标对应的数据，返回 []`;

  let rawJsonStr = '';
  try {
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: `需提取的情报：\n${textContent}` }],
      systemPrompt,
    })) {
      if (event.type === 'text' && event.content) {
        rawJsonStr += event.content;
      }
    }

    let cleanJson = rawJsonStr.trim();
    if (cleanJson.startsWith('```json')) cleanJson = cleanJson.substring(7);
    if (cleanJson.startsWith('```')) cleanJson = cleanJson.substring(3);
    if (cleanJson.endsWith('```')) cleanJson = cleanJson.substring(0, cleanJson.length - 3);
    cleanJson = cleanJson.trim();

    const extractedItems = JSON.parse(cleanJson);
    
    if (Array.isArray(extractedItems) && extractedItems.length > 0) {
      for (const item of extractedItems) {
        if (!item.targetCompany || !item.targetMetric) continue;
        await addInboxItem({
          id: `inbox_auto_${generateId()}`,
          source: 'ai_snippet',
          content: item.content || '无原文引用',
          targetCompany: item.targetCompany,
          targetMetric: item.targetMetric,
          extractedValue: item.extractedValue || 0,
          timePeriod: item.timePeriod || '',
          timestamp: Date.now()
        });
      }
      message.success(`后台嗅探成功！自动发现了 ${extractedItems.length} 条数据，已推入看板「情报草稿箱」`);
    }
  } catch (e) {
    // 隐式吞掉错误，后台功能不干扰主链路
  }
}

export function usePromptConfig(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  id: string | undefined,
  activeIdRef: React.MutableRefObject<string | undefined>,
  apiConfig: any,
  setEditedSummary: (s: string) => void,
  setHasChanges: (b: boolean) => void,
  setSaveStatus: (s: 'saved' | 'saving' | 'unsaved') => void,
  setTranslatedSummary: (s: string) => void,
  setHasTranslation: (b: boolean) => void
) {
  const [customPrompt, setCustomPrompt] = useState(() => {
    const saved = localStorage.getItem('summaryPrompt');
    return saved || 'Please intelligently summarize the following transcribed text, extracting key information and main points. Present the summary in a clear, structured format (such as headings, lists, etc.), but do not use any dividers or horizontal lines.\n\nIMPORTANT: Use the same language as the transcribed text for your summary. If the text is in English, summarize in English. If the text is in Chinese, summarize in Chinese.\n\nTranscribed text:\n{text}\n\nPlease provide the summary:';
  });
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [regenerating, setRegenerating] = useState<{ [key: string]: boolean }>({});
  const [regenerateDropdownOpen, setRegenerateDropdownOpen] = useState(false);

  // Bidirectional sync with backend on mount:
  // - Cloud has value → use cloud (overwrite local)
  // - Cloud empty but local has custom value → upload local to cloud
  const DEFAULT_SUMMARY_PROMPT = 'Please intelligently summarize the following transcribed text, extracting key information and main points. Present the summary in a clear, structured format (such as headings, lists, etc.), but do not use any dividers or horizontal lines.\n\nIMPORTANT: Use the same language as the transcribed text for your summary. If the text is in English, summarize in English. If the text is in Chinese, summarize in Chinese.\n\nTranscribed text:\n{text}\n\nPlease provide the summary:';
  useEffect(() => {
    aiApi.getSettings().then(res => {
      if (res && res.summaryPrompt) {
        setCustomPrompt(res.summaryPrompt);
        localStorage.setItem('summaryPrompt', res.summaryPrompt);
      } else {
        const local = localStorage.getItem('summaryPrompt');
        if (local && local !== DEFAULT_SUMMARY_PROMPT) {
          aiApi.saveSettings({ summaryPrompt: local }).catch(() => {});
        }
      }
    }).catch(err => {
      console.warn('Failed to load synced summary prompt:', err);
    });
  }, []);

  const handleRegenerateSummary = async (action: 'summary' | 'metadata' | 'all' = 'all') => {
    if (!id) return;

    const targetId = transcription?.id || id;
    const targetFileName = transcription?.fileName || '未知记录';

    setRegenerating(prev => ({ ...prev, [targetId]: true }));

    try {
      const response = await regenerateSummary(
        targetId,
        'gemini',
        customPrompt,
        apiConfig.geminiApiKey,
        apiConfig.qwenApiKey,
        action,
        undefined,
        apiConfig.summaryModel,
        apiConfig.metadataModel
      );

      const actionMessage = action === 'summary' ? '总结重新生成成功' :
        action === 'metadata' ? '元数据提取成功' : '总结和元数据重新生成成功';

      if (targetId === activeIdRef.current) {
        if (response.success && response.data) {
          let parsedData = response.data;
          if (parsedData.tags && typeof parsedData.tags === 'string') {
            try {
              parsedData.tags = JSON.parse(parsedData.tags);
            } catch (e) {
              parsedData.tags = [];
            }
          }

          setTranscription(parsedData);
          setEditedSummary(parsedData.summary || '');
          setHasChanges(false);
          setSaveStatus('saved');
          setTranslatedSummary('');
          setHasTranslation(false);
          localStorage.removeItem(`translated_summary_${targetId}`);
          message.success(actionMessage);

          if (apiConfig.autoTrackerSniffing && parsedData.summary) {
            performAutoTrackerSniffing(parsedData.summary, apiConfig);
          }
        }
      } else {
        if (response.success) {
          message.success(`"${targetFileName}" 的${actionMessage.replace('成功', '')}已完成`);
          localStorage.removeItem(`translated_summary_${targetId}`);

          if (apiConfig.autoTrackerSniffing && response.data?.summary) {
            performAutoTrackerSniffing(response.data.summary, apiConfig);
          }
        }
      }
    } catch (error: any) {
      const actionName = action === 'summary' ? '重新生成总结' :
        action === 'metadata' ? '提取元数据' : '重新生成';
      if (targetId === activeIdRef.current) {
        message.error(`${actionName}失败：` + (error.message || '未知错误'));
      } else {
        message.error(`"${targetFileName}" 的${actionName}失败`);
      }
    } finally {
      setRegenerating(prev => {
        const newState = { ...prev };
        delete newState[targetId];
        return newState;
      });
    }
  };

  const handleSavePrompt = async () => {
    localStorage.setItem('summaryPrompt', customPrompt);
    try {
      await aiApi.saveSettings({ summaryPrompt: customPrompt });
      message.success('Prompt 已保存并同步至云端');
    } catch (e) {
      console.error(e);
      message.success('Prompt 已保存到本地 (云端同步失败)');
    }
    setShowPromptConfig(false);
  };

  return {
    customPrompt,
    setCustomPrompt,
    showPromptConfig,
    setShowPromptConfig,
    regenerating,
    regenerateDropdownOpen,
    setRegenerateDropdownOpen,
    handleRegenerateSummary,
    handleSavePrompt,
  };
}
