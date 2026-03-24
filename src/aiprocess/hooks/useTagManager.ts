import { useState } from 'react';
import { message } from 'antd';
import { updateTranscriptionTags } from '../api/transcription';
import type { Transcription } from '../types';

export function useTagManager(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>
) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const handleUpdateTags = async (newTags: string[]) => {
    if (!transcription?.id) return;

    try {
      const response = await updateTranscriptionTags(transcription.id, newTags);
      if (response.success && response.data) {
        // 解析 tags
        let parsedData = response.data;
        if (parsedData.tags && typeof parsedData.tags === 'string') {
          try {
            parsedData.tags = JSON.parse(parsedData.tags);
          } catch (e) {
            parsedData.tags = [];
          }
        }
        setTranscription(parsedData);
        message.success('标签更新成功');
      }
    } catch (error: any) {
      message.error('更新标签失败：' + (error.message || '未知错误'));
    }
  };

  const handleAddTag = () => {
    if (!transcription) return;
    const trimmedTag = tagInput.trim();
    if (!trimmedTag) return;

    const currentTags = transcription.tags || [];
    if (currentTags.length >= 5) {
      message.warning('最多只能添加5个标签');
      return;
    }
    if (currentTags.includes(trimmedTag)) {
      message.warning('标签已存在');
      return;
    }

    const newTags = [...currentTags, trimmedTag];
    handleUpdateTags(newTags);
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!transcription) return;
    const currentTags = transcription.tags || [];
    const newTags = currentTags.filter(tag => tag !== tagToRemove);
    handleUpdateTags(newTags);
  };

  const handleKeyPressTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return {
    editingTags,
    setEditingTags,
    tagInput,
    setTagInput,
    handleAddTag,
    handleRemoveTag,
    handleUpdateTags,
    handleKeyPressTag,
  };
}
