import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import { updateTranscriptionTranslatedSummary } from '../api/transcription';
import { translateToChinese } from '../api/translation';
import type { Transcription, ApiResponse } from '../types';

/**
 * 带重试的翻译保存函数
 * - 409 版本冲突：从响应中取 currentVersion 重试
 * - 网络错误 / 502 / 504：指数退避重试
 */
async function saveTranslationWithRetry(
  id: string,
  text: string,
  version: number | undefined,
  maxRetries = 3,
): Promise<ApiResponse<Transcription>> {
  let lastError: any;
  let currentVersion = version;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await updateTranscriptionTranslatedSummary(id, text, currentVersion);
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const errorCode = error.response?.data?.error;

      // 409 版本冲突 — 使用服务器返回的最新版本重试
      if (status === 409 || errorCode === 'CONFLICT') {
        const freshVersion = error.response?.data?.data?.currentVersion;
        if (freshVersion !== undefined && attempt < maxRetries) {
          currentVersion = freshVersion;
          console.log(`🔄 版本冲突，使用新版本 v${freshVersion} 重试 (${attempt + 1}/${maxRetries})`);
          continue;
        }
        // 无法获取新版本，尝试不带版本号保存（跳过版本检查）
        if (attempt < maxRetries) {
          currentVersion = undefined;
          console.log(`🔄 版本冲突且无法获取新版本，跳过版本检查重试 (${attempt + 1}/${maxRetries})`);
          continue;
        }
      }

      // 网络错误 / 502 / 504 — 指数退避重试（client.ts 已经做了 2 次 502/504 重试，这里额外兜底）
      const isRetryable = !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK';
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.log(`🔄 保存失败 (${status || error.code || 'unknown'})，${delay / 1000}s 后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 不可重试的错误，直接抛出
      throw error;
    }
  }
  throw lastError;
}

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

    // 捕获发起翻译时的记录 ID 和文件名
    const targetId = id;
    const targetFileName = transcription?.fileName || '未知记录';

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
      // 立即保存到数据库 — 不传版本号，AI 生成的内容无需乐观锁检查
      try {
        await saveTranslationWithRetry(targetId, editedSummary, undefined);
      } catch (e) {
        console.warn('保存中文翻译到数据库失败:', e);
      }
      message.info('Notes已经是中文');
      return;
    }

    // 设置为该项目的翻译状态为 true
    setTranslating(prev => ({ ...prev, [targetId]: true }));

    try {
      const response = await translateToChinese(editedSummary, apiConfig.qwenApiKey, apiConfig.translationModel);
      if (response.data?.success && response.data.data?.translatedText) {
        const translatedText = response.data.data.translatedText;

        // 保存翻译结果到 localStorage（使用 targetId）
        localStorage.setItem(`translated_summary_${targetId}`, translatedText);

        // 立即保存到数据库（使用 targetId，确保保存到正确的记录）
        // 不传版本号：翻译耗时较长（10-60s），期间其他字段的 auto-save 会导致版本号
        // 递增，传版本号几乎必然 409 冲突。AI 翻译是单向写入，不存在两端
        // 同时编辑同一字段的冲突场景，跳过版本检查是安全的。
        try {
          const saveResponse = await saveTranslationWithRetry(targetId, translatedText, undefined);
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
            message.warning('翻译完成，但保存失败（已缓存到本地），请手动重试');
          } else {
            message.warning(`"${targetFileName}" 翻译完成，但保存失败（已缓存到本地）`);
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

  // 保存中文翻译（用户手动编辑后的保存 / auto-save）
  const handleSaveTranslatedSummary = async (showMessage = true) => {
    if (!id || !hasChangesZh) return;

    setSavingZh(true);
    setSaveStatusZh('saving');
    try {
      const currentVersion = transcription?.version;
      // 用户手动编辑的保存使用带重试的版本，409 时自动提取新版本重试
      const response = await saveTranslationWithRetry(id, translatedSummary, currentVersion);
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
        message.error('数据版本冲突，重试后仍然失败。请刷新页面后重试');
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
