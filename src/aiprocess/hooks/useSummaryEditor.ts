import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import { updateTranscriptionSummary } from '../api/transcription';
import type { Transcription, ApiResponse } from '../types';

/**
 * 带重试的 summary 保存函数
 * - 409 版本冲突：从响应中取 currentVersion 重试
 * - 网络 / 500+ 错误：指数退避重试
 */
async function saveSummaryWithRetry(
  id: string,
  summary: string,
  version: number | undefined,
  maxRetries = 2,
): Promise<ApiResponse<Transcription>> {
  let lastError: any;
  let currentVersion = version;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await updateTranscriptionSummary(id, summary, currentVersion);
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const errorCode = error.response?.data?.error;

      // 409 版本冲突 — 使用服务器返回的最新版本重试
      if ((status === 409 || errorCode === 'CONFLICT') && attempt < maxRetries) {
        const freshVersion = error.response?.data?.data?.currentVersion;
        if (freshVersion !== undefined) {
          currentVersion = freshVersion;
          console.log(`🔄 Summary 版本冲突，使用新版本 v${freshVersion} 重试 (${attempt + 1}/${maxRetries})`);
          continue;
        }
      }

      // 网络错误 / 502 / 504 — 指数退避重试
      const isRetryable = !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK';
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.log(`🔄 Summary 保存失败 (${status || error.code || 'unknown'})，${delay / 1000}s 后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }
  throw lastError;
}

export function useSummaryEditor(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  id: string | undefined,
  loadTranscription: (transcriptionId?: string, isPolling?: boolean) => Promise<void>
) {
  const [editedSummary, setEditedSummary] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [saving, setSaving] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSaveSummary = async (showMessage = true) => {
    if (!id || !hasChanges) return;

    // 不保存空内容
    if (!editedSummary || editedSummary.trim() === '') {
      return;
    }

    setSaving(true);
    setSaveStatus('saving');
    try {
      // 传递当前记录的版本号，带重试逻辑
      const currentVersion = transcription?.version;
      const response = await saveSummaryWithRetry(id, editedSummary, currentVersion);
      if (response.success && response.data) {
        setTranscription(response.data);
        setHasChanges(false);
        setSaveStatus('saved');
        if (showMessage) {
          message.success('保存成功');
        }
      }
    } catch (error: any) {
      setSaveStatus('unsaved');
      // 重试后仍失败，处理版本冲突错误
      if (error.response?.status === 409 || error.response?.data?.error === 'CONFLICT') {
        message.error({
          content: '数据版本冲突，重试后仍然失败。请刷新页面后重试',
          duration: 5,
        });
        // 重新加载最新数据
        if (id) {
          loadTranscription(id);
        }
      } else {
        message.error('保存失败：' + (error.message || '未知错误'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSummaryChange = (content: string) => {
    setEditedSummary(content);
    setHasChanges(content !== (transcription?.summary || ''));
  };

  // 自动保存：用户停止输入 2 秒后自动保存
  useEffect(() => {
    if (hasChanges && id) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        console.log('🔄 自动保存中...');
        handleSaveSummary(false);
      }, 2000);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [editedSummary, hasChanges, id]);

  return {
    editedSummary,
    setEditedSummary,
    hasChanges,
    setHasChanges,
    saveStatus,
    setSaveStatus,
    saving,
    handleSaveSummary,
    handleSummaryChange,
  };
}
