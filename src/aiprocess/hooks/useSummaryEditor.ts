import { useState, useEffect, useRef } from 'react';
import { message } from 'antd';
import { updateTranscriptionSummary } from '../api/transcription';
import type { Transcription } from '../types';

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
      // 传递当前记录的版本号
      const currentVersion = transcription?.version;
      const response = await updateTranscriptionSummary(id, editedSummary, currentVersion);
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
      // 处理版本冲突错误
      if (error.response?.status === 409 || error.response?.data?.error === 'CONFLICT') {
        const errorData = error.response?.data?.data;
        message.error({
          content: error.response?.data?.message || '数据已被其他会话修改，请刷新页面后重试',
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
