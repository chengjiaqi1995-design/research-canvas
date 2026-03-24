import { useState } from 'react';
import { message } from 'antd';
import { updateTranscriptionFileName } from '../api/transcription';
import type { Transcription } from '../types';

export function useFileNameEditor(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  loadTranscriptions: (page?: number, append?: boolean) => Promise<void>
) {
  const [editingFileName, setEditingFileName] = useState(false);
  const [editedFileName, setEditedFileName] = useState('');

  const handleSaveFileName = async () => {
    if (!transcription?.id || !editedFileName.trim()) {
      message.warning('文件名不能为空');
      return;
    }

    try {
      const response = await updateTranscriptionFileName(transcription.id, editedFileName.trim());
      if (response.success && response.data) {
        setTranscription(response.data);
        setEditingFileName(false);
        message.success('文件名更新成功');
        // 重新加载列表以更新侧边栏
        await loadTranscriptions();
      }
    } catch (error: any) {
      message.error('更新文件名失败：' + (error.message || '未知错误'));
    }
  };

  const handleStartEditFileName = () => {
    if (transcription) {
      setEditedFileName(transcription.fileName);
      setEditingFileName(true);
    }
  };

  const handleCancelEditFileName = () => {
    setEditingFileName(false);
    setEditedFileName('');
  };

  return {
    editingFileName,
    editedFileName,
    setEditedFileName,
    handleSaveFileName,
    handleStartEditFileName,
    handleCancelEditFileName,
  };
}
