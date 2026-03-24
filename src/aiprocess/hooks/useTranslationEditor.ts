import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import { updateTranscriptionTranslatedSummary } from '../api/transcription';
import { translateToChinese } from '../api/translation';
import type { Transcription } from '../types';

export function useTranslationEditor(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  id: string | undefined,
  editedSummary: string,
  activeIdRef: React.MutableRefObject<string | undefined>,
  apiConfig: { qwenApiKey?: string; geminiApiKey?: string }
) {
  const [translatedSummary, setTranslatedSummary] = useState('');
  const [hasChangesZh, setHasChangesZh] = useState(false);
  const [saveStatusZh, setSaveStatusZh] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [savingZh, setSavingZh] = useState(false);
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  const [hasTranslation, setHasTranslation] = useState(false);
  const autoSaveTimerZhRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 检测文本语言
  const detectLanguage = (text: string): 'zh' | 'en' | 'other' => {
    if (!text || text.trim().length === 0) {
      return 'other';
    }

    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    const englishChars = text.match(/[a-zA-Z]/g) || [];

    const chineseRatio = chineseChars.length / text.length;
    const englishRatio = englishChars.length / text.length;

    if (chineseRatio > 0.3) {
      return 'zh';
    } else if (englishRatio > 0.3) {
      return 'en';
    }

    return 'other';
  };

  // 翻译总结到中文
  const handleTranslateSummary = async () => {
    if (!id || !editedSummary || editedSummary.trim().length === 0) {
      message.warning('没有可翻译的内容');
      return;
    }

    // 捕获发起翻译时的记录 ID、文件名和版本号
    const targetId = id;
    const targetFileName = transcription?.fileName || '未知记录';
    const targetVersion = transcription?.version;

    // 检查是否正在翻译
    if (translating[targetId]) {
      message.info('该项目正在翻译中，请稍候...');
      return;
    }

    const language = detectLanguage(editedSummary);
    if (language === 'zh') {
      setTranslatedSummary(editedSummary);
      setHasTranslation(true);
      // 保存到正确的记录
      localStorage.setItem(`translated_summary_${targetId}`, editedSummary);
      setHasChangesZh(false);
      // 立即保存到数据库
      try {
        await updateTranscriptionTranslatedSummary(targetId, editedSummary, targetVersion);
      } catch (e) {
        console.warn('保存中文翻译到数据库失败:', e);
      }
      message.info('Notes已经是中文');
      return;
    }

    // 设置为该项目的翻译状态为 true
    setTranslating(prev => ({ ...prev, [targetId]: true }));

    try {
      const response = await translateToChinese(editedSummary, apiConfig.qwenApiKey);
      if (response.data?.success && response.data.data?.translatedText) {
        const translatedText = response.data.data.translatedText;

        // 保存翻译结果到 localStorage（使用 targetId）
        localStorage.setItem(`translated_summary_${targetId}`, translatedText);

        // 立即保存到数据库（使用 targetId，确保保存到正确的记录）
        try {
          const saveResponse = await updateTranscriptionTranslatedSummary(targetId, translatedText, targetVersion);
          console.log(`✅ 翻译结果已保存到数据库，记录ID: ${targetId}`);

          // 检查用户是否还在查看同一条记录
          if (targetId === activeIdRef.current) {
            // 用户还在查看同一条记录，更新 UI 和本地状态
            if (saveResponse.success && saveResponse.data) {
              setTranscription(saveResponse.data);
            }
            setTranslatedSummary(translatedText);
            setHasTranslation(true);
            setHasChangesZh(false);
            setSaveStatusZh('saved');
            message.success('翻译完成并已保存');
          } else {
            // 用户已切换到其他记录，显示通知
            message.success(`"${targetFileName}" 的翻译已完成并保存`);
          }
        } catch (saveError: any) {
          console.error('保存翻译到数据库失败:', saveError);
          // 即使数据库保存失败，localStorage 已经有备份
          if (targetId === activeIdRef.current) {
            setTranslatedSummary(translatedText);
            setHasTranslation(true);
            setHasChangesZh(true);
            setSaveStatusZh('unsaved');
            message.warning('翻译完成，但保存失败，请手动保存');
          } else {
            message.warning(`"${targetFileName}" 翻译完成，但保存失败`);
          }
        }
      } else {
        throw new Error(response.data?.error || '翻译失败');
      }
    } catch (error: any) {
      console.error('翻译失败:', error);
      // 只有在用户还在查看同一条记录时才显示错误
      if (targetId === activeIdRef.current) {
        message.error('翻译失败：' + (error.response?.data?.message || error.message || '未知错误'));
      } else {
        message.error(`"${targetFileName}" 的翻译失败`);
      }
    } finally {
      // 清除该项目的翻译状态
      setTranslating(prev => {
        const newState = { ...prev };
        delete newState[targetId];
        return newState;
      });
    }
  };

  // 保存中文翻译
  const handleSaveTranslatedSummary = async (showMessage = true) => {
    if (!id || !hasChangesZh) return;

    setSavingZh(true);
    setSaveStatusZh('saving');
    try {
      const currentVersion = transcription?.version;
      const response = await updateTranscriptionTranslatedSummary(id, translatedSummary, currentVersion);
      if (response.success && response.data) {
        setTranscription(response.data);
        setHasChangesZh(false);
        setSaveStatusZh('saved');
        localStorage.setItem(`translated_summary_${id}`, translatedSummary);
        if (showMessage) {
          message.success('保存成功');
        }
      } else {
        throw new Error(response.error || '保存失败');
      }
    } catch (error: any) {
      setSaveStatusZh('unsaved');
      if (error.response?.status === 409) {
        message.error('数据已被其他会话修改，请刷新页面后重试');
      } else {
        message.error('保存失败：' + (error.message || '未知错误'));
      }
    } finally {
      setSavingZh(false);
    }
  };

  const handleTranslatedSummaryChange = (content: string) => {
    setTranslatedSummary(content);
    const savedTranslation = id ? localStorage.getItem(`translated_summary_${id}`) : '';
    setHasChangesZh(content !== (savedTranslation || ''));
  };

  // 中文翻译自动保存：2 秒后自动保存
  useEffect(() => {
    if (hasChangesZh && id) {
      if (autoSaveTimerZhRef.current) {
        clearTimeout(autoSaveTimerZhRef.current);
      }

      autoSaveTimerZhRef.current = setTimeout(() => {
        console.log('🔄 中文翻译自动保存中...');
        handleSaveTranslatedSummary(false);
      }, 2000);
    }

    return () => {
      if (autoSaveTimerZhRef.current) {
        clearTimeout(autoSaveTimerZhRef.current);
      }
    };
  }, [translatedSummary, hasChangesZh, id]);

  return {
    translatedSummary,
    setTranslatedSummary,
    hasChangesZh,
    setHasChangesZh,
    saveStatusZh,
    setSaveStatusZh,
    savingZh,
    translating,
    hasTranslation,
    setHasTranslation,
    detectLanguage,
    handleTranslateSummary,
    handleSaveTranslatedSummary,
    handleTranslatedSummaryChange,
  };
}
