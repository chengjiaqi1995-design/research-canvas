import { useState, useEffect } from 'react';
import { message } from 'antd';
import { regenerateSummary } from '../api/transcription';
import type { Transcription } from '../types';
import { aiApi } from '../../db/apiClient';

export function usePromptConfig(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  id: string | undefined,
  activeIdRef: React.MutableRefObject<string | undefined>,
  apiConfig: { qwenApiKey?: string; geminiApiKey?: string; summaryModel?: string; metadataModel?: string },
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

  // Sync with backend on mount
  useEffect(() => {
    aiApi.getSettings().then(res => {
      if (res && res.summaryPrompt) {
        setCustomPrompt(res.summaryPrompt);
        localStorage.setItem('summaryPrompt', res.summaryPrompt);
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
        }
      } else {
        if (response.success) {
          message.success(`"${targetFileName}" 的${actionMessage.replace('成功', '')}已完成`);
          localStorage.removeItem(`translated_summary_${targetId}`);
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
