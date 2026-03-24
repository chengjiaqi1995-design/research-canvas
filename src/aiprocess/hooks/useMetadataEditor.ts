import { useState } from 'react';
import { message } from 'antd';
import { updateTranscriptionMetadata } from '../api/transcription';
import { getIndustries } from '../api/user';
import type { Transcription } from '../types';

export type MetadataField = 'topic' | 'organization' | 'intermediary' | 'industry' | 'country' | 'participants' | 'eventDate';

export function useMetadataEditor(
  transcription: Transcription | null,
  setTranscription: React.Dispatch<React.SetStateAction<Transcription | null>>,
  loadTranscriptions: (page?: number, append?: boolean) => Promise<void>
) {
  const [editingMetadata, setEditingMetadata] = useState<MetadataField | null>(null);
  const [editedMetadata, setEditedMetadata] = useState({
    topic: '',
    organization: '',
    intermediary: '',
    industry: '',
    country: '',
    participants: '',
    eventDate: '',
  });
  const [industries, setIndustries] = useState<string[]>([]);

  const handleStartEditMetadata = (field: MetadataField) => {
    if (transcription) {
      setEditedMetadata({
        topic: transcription.topic || '',
        organization: transcription.organization || '',
        intermediary: transcription.intermediary || '',
        industry: transcription.industry || '',
        country: transcription.country || '',
        participants: transcription.participants || '',
        eventDate: transcription.eventDate || '',
      });
      setEditingMetadata(field);
    }
  };

  const handleSaveMetadata = async () => {
    if (!transcription?.id || !editingMetadata) return;

    try {
      const response = await updateTranscriptionMetadata(transcription.id, editedMetadata);
      if (response.success && response.data) {
        setTranscription(response.data);
        setEditingMetadata(null);
        message.success('更新成功');
        await loadTranscriptions();
      }
    } catch (error: any) {
      message.error('更新失败：' + (error.message || '未知错误'));
    }
  };

  const handleCancelEditMetadata = () => {
    setEditingMetadata(null);
  };

  const loadIndustries = async () => {
    try {
      const response = await getIndustries();
      if (response.success && response.data) {
        setIndustries(response.data.industries);
      }
    } catch (error: any) {
      console.error('加载行业列表失败:', error);
    }
  };

  return {
    editingMetadata,
    setEditingMetadata,
    editedMetadata,
    setEditedMetadata,
    industries,
    handleStartEditMetadata,
    handleSaveMetadata,
    handleCancelEditMetadata,
    loadIndustries,
  };
}
