import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Button,
  Space,
  Tag,
  message,
  Spin,
  Modal,
  Input,
  Tabs,
  Upload,
  Select,
  Progress,
  DatePicker,
  Dropdown,
  Empty,
} from 'antd';
import type { MenuProps } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import {
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  ShareAltOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CheckOutlined,
  SyncOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  DownOutlined,
  CopyOutlined,
  FileTextOutlined,
  TranslationOutlined,
  PaperClipOutlined,
  LinkOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { createTranscription } from '../api/transcription';
import {
  getTranscription,
  deleteTranscription,
  reprocessTranscription,
  updateTranscriptionActualDate,
} from '../api/transcription';
import BlockNoteTextEditor from '../components/BlockNoteTextEditor';
import AudioPlayer from '../components/AudioPlayer';
import type { AudioPlayerHandle } from '../components/AudioPlayer';
import type { Transcription, AIProvider } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { useReadOnly } from '../contexts/ReadOnlyContext';
import styles from './TranscriptionDetailPage.module.css';

// Hooks
import { useSummaryEditor } from '../hooks/useSummaryEditor';
import { useTranslationEditor } from '../hooks/useTranslationEditor';
import { useMetadataEditor } from '../hooks/useMetadataEditor';
import { useTagManager } from '../hooks/useTagManager';
import { useFileNameEditor } from '../hooks/useFileNameEditor';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { useTranscriptionList } from '../hooks/useTranscriptionList';
import { getApiConfig } from '../components/ApiConfigModal';
import { usePromptConfig } from '../hooks/usePromptConfig';
import { useCanvasStore } from '../../stores/canvasStore';
import { useAICardStore } from '../../stores/aiCardStore';
import { generateId } from '../../utils/id';

// Sub-components
import { TranscriptionSidebar, MetadataHeader, TagsRow, TranscriptTab, PromptConfigModal } from './TranscriptionDetail';

const { Dragger } = Upload;

/**
 * 从 transcription 对象中提取 summary，
 * 如果是周报类型，自动将 [REFn] 替换为可点击的序号链接。
 * 所有设置 editedSummary 的地方都必须经过此函数。
 */
function getSummaryWithCitations(t: Transcription | null): string {
  if (!t) return '';
  const html = t.summary || '';
  if (t.type !== 'weekly-summary') return html;

  // 提取 sources（从 mergeSources 或 transcriptText）
  let sources: Array<{ id: string; title: string }> = [];
  if (Array.isArray(t.mergeSources) && t.mergeSources.length) {
    sources = t.mergeSources.map((s: any) => ({ id: s.id, title: s.title }));
  } else if (typeof t.mergeSources === 'string' && t.mergeSources) {
    try {
      const parsed = JSON.parse(t.mergeSources);
      if (Array.isArray(parsed)) sources = parsed.map((s: any) => ({ id: s.id, title: s.title }));
    } catch {}
  }
  if (!sources.length) {
    try {
      const weeklyData = JSON.parse(t.transcriptText || '{}');
      if (Array.isArray(weeklyData.sources)) sources = weeklyData.sources;
    } catch {}
  }
  if (!sources.length) return html;

  // 替换引用标记为可点击链接
  // 支持多种 AI 输出格式：
  //   [REF1]  [REF1, REF2]  [REF1, REF2, REF3]  (带 REF 前缀)
  //   [1]     [1, 2]        [1, 2, 3]            (纯数字)
  const replaceRef = (num: string) => {
    const idx = parseInt(num) - 1;
    if (idx >= 0 && idx < sources.length) {
      const title = sources[idx].title.replace(/"/g, '&quot;');
      return `<a href="/transcription/${sources[idx].id}" class="editor-link" title="${title}">[${num}]</a>`;
    }
    return `[${num}]`;
  };

  // 匹配 [REF1, REF2, ...] 或 [1, 2, ...] 格式（方括号内逗号分隔的引用）
  return html.replace(/\[((?:REF)?\d+(?:\s*,\s*(?:REF)?\d+)*)\]/g, (match, inner: string) => {
    // 提取所有数字
    const nums = inner.match(/\d+/g);
    if (!nums) return match;
    return nums.map(n => replaceRef(n)).join(' ');
  });
}

interface TranscriptionDetailPageProps {
  externalData?: Transcription[];
  externalId?: string;
}

const TranscriptionDetailPage: React.FC<TranscriptionDetailPageProps> = ({ externalData, externalId }) => {
  const { id: routeId } = useParams<{ id: string }>();
  const id = externalId || routeId;
  const navigate = useNavigate();
  const { isReadOnly } = useReadOnly();
  const activeIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    activeIdRef.current = id;
  }, [id]);

  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const summaryContentRef = useRef<HTMLDivElement | null>(null);
  const summaryCardRef = useRef<HTMLDivElement | null>(null);
  const transcriptContentRef = useRef<HTMLDivElement | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const [activeTab, setActiveTab] = useState('summary');

  // Share state
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // 周报来源笔记预览弹窗
  const [citationPreviewVisible, setCitationPreviewVisible] = useState(false);
  const [citationPreviewNote, setCitationPreviewNote] = useState<Transcription | null>(null);

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [uploadAiProvider, setUploadAiProvider] = useState<AIProvider>('gemini');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Actual date editing
  const [editingActualDate, setEditingActualDate] = useState(false);
  const [editedActualDate, setEditedActualDate] = useState<Dayjs | null>(null);

  const { sidebarCollapsed, setSidebarCollapsed } = useSidebar();

  // API config from localStorage
  const [apiConfig] = useState(getApiConfig);

  // --- Custom Hooks ---
  const transcriptionList = useTranscriptionList();

  const loadTranscription = async (transcriptionId?: string, isPolling = false) => {
    const targetId = transcriptionId || id;
    if (!targetId) return;

    if (transcription?.id === targetId && !loading && !isPolling) {
      return;
    }

    if (!isPolling) setLoading(true);
    try {
      const response = await getTranscription(targetId);
      if (response.success && response.data) {
        let parsedData = response.data;
        if (parsedData.tags && typeof parsedData.tags === 'string') {
          try {
            parsedData.tags = JSON.parse(parsedData.tags);
          } catch (e) {
            parsedData.tags = [];
          }
        }
        // mergeSources 在数据库中存为 JSON 字符串，需要解析为数组
        if (parsedData.mergeSources && typeof parsedData.mergeSources === 'string') {
          try {
            parsedData.mergeSources = JSON.parse(parsedData.mergeSources);
          } catch (e) {
            parsedData.mergeSources = [];
          }
        }
        setTranscription(parsedData);
        summaryEditor.setEditedSummary(getSummaryWithCitations(parsedData));
        summaryEditor.setHasChanges(false);
        summaryEditor.setSaveStatus('saved');
        // 从数据库加载保存的中文翻译
        const savedTranslation = (parsedData as any).translatedSummary || '';
        if (savedTranslation) {
          translationEditor.setTranslatedSummary(savedTranslation);
          translationEditor.setHasTranslation(true);
          translationEditor.setHasChangesZh(false);
          localStorage.setItem(`translated_summary_${targetId}`, savedTranslation);
        } else {
          const localTranslation = localStorage.getItem(`translated_summary_${targetId}`);
          if (localTranslation) {
            translationEditor.setTranslatedSummary(localTranslation);
            translationEditor.setHasTranslation(true);
            translationEditor.setHasChangesZh(false);
          } else {
            translationEditor.setTranslatedSummary('');
            translationEditor.setHasTranslation(false);
          }
        }
        translationEditor.setHasChangesZh(false);
        translationEditor.setSaveStatusZh('saved');
        if (transcriptionId && transcriptionId !== id && !isReadOnly) {
          navigate(`/transcription/${targetId}`, { replace: true });
        }
      } else {
        message.error('加载失败');
      }
    } catch (error: any) {
      if (!isPolling) message.error('加载失败：' + (error.message || '未知错误'));
    } finally {
      if (!isPolling) setLoading(false);
    }
  };

  const summaryEditor = useSummaryEditor(transcription, setTranscription, id, loadTranscription);
  const translationEditor = useTranslationEditor(transcription, setTranscription, id, summaryEditor.editedSummary, activeIdRef, apiConfig);
  const metadataEditor = useMetadataEditor(transcription, setTranscription, transcriptionList.loadTranscriptions);
  const tagManager = useTagManager(transcription, setTranscription);
  const fileNameEditor = useFileNameEditor(transcription, setTranscription, transcriptionList.loadTranscriptions);
  const audioPlayback = useAudioPlayback(transcription, audioPlayerRef);
  const promptConfig = usePromptConfig(
    transcription, setTranscription, id, activeIdRef, apiConfig,
    summaryEditor.setEditedSummary, summaryEditor.setHasChanges, summaryEditor.setSaveStatus,
    translationEditor.setTranslatedSummary, translationEditor.setHasTranslation
  );

  // --- Effects ---

  // Initial load
  useEffect(() => {
    if (externalData && externalData.length > 0) {
      transcriptionList.setTranscriptions(externalData);
      transcriptionList.setHasMore(false);
      setLoading(false);
      transcriptionList.setListLoading(false);
      const targetNote = externalId
        ? externalData.find(n => n.id === externalId) || externalData[0]
        : externalData[0];
      setTranscription(targetNote);
      summaryEditor.setEditedSummary(getSummaryWithCitations(targetNote));
      summaryEditor.setHasChanges(false);
      summaryEditor.setSaveStatus('saved');
      const savedTranslation = targetNote.translatedSummary || '';
      if (savedTranslation) {
        translationEditor.setTranslatedSummary(savedTranslation);
        translationEditor.setHasTranslation(true);
      } else {
        translationEditor.setTranslatedSummary('');
        translationEditor.setHasTranslation(false);
      }
      translationEditor.setHasChangesZh(false);
      translationEditor.setSaveStatusZh('saved');
      return;
    }

    if (id) {
      loadTranscription(id);
    }
    transcriptionList.loadTranscriptions(1, false);
    metadataEditor.loadIndustries();
  }, [externalData]);

  // When id changes
  useEffect(() => {
    if (id && id !== transcription?.id) {
      if (externalData && externalData.length > 0) {
        const targetNote = externalData.find(n => n.id === id);
        if (targetNote) {
          setTranscription(targetNote);
          summaryEditor.setEditedSummary(getSummaryWithCitations(targetNote));
          summaryEditor.setHasChanges(false);
          summaryEditor.setSaveStatus('saved');
          const savedTranslation = targetNote.translatedSummary || '';
          if (savedTranslation) {
            translationEditor.setTranslatedSummary(savedTranslation);
            translationEditor.setHasTranslation(true);
          } else {
            translationEditor.setTranslatedSummary('');
            translationEditor.setHasTranslation(false);
          }
          translationEditor.setHasChangesZh(false);
          translationEditor.setSaveStatusZh('saved');
        }
      } else {
        loadTranscription(id);
      }
    }
  }, [id]);

  // Polling for processing status
  useEffect(() => {
    if (!transcription || !['processing', 'pending'].includes(transcription.status)) return;

    const pollInterval = setInterval(() => {
      loadTranscription(transcription.id, true);
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [transcription?.id, transcription?.status]);

  // Fullscreen class toggle
  useEffect(() => {
    if (summaryCardRef.current) {
      if (isFullscreen) {
        summaryCardRef.current.classList.add(styles.fullscreenMode);
      } else {
        summaryCardRef.current.classList.remove(styles.fullscreenMode);
      }
    }
  }, [isFullscreen]);

  // --- Handlers that stay in the main component ---

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleDelete = async (transcriptionId?: string) => {
    const targetId = transcriptionId || id;
    if (!targetId) return;

    try {
      const response = await deleteTranscription(targetId);
      if (response.success) {
        message.success('删除成功');
        await transcriptionList.loadTranscriptions(1, false);
        if (targetId === id) {
          const remaining = transcriptionList.transcriptions.filter(t => t.id !== targetId);
          if (remaining.length > 0) {
            loadTranscription(remaining[0].id);
          } else {
            setTranscription(null);
            summaryEditor.setEditedSummary('');
          }
        }
      }
    } catch (error: any) {
      message.error('删除失败：' + (error.message || '未知错误'));
    }
  };

  const getProviderText = (provider: string) => {
    const providerMap: Record<string, string> = {
      gemini: 'Gemini',
      qwen: '通义千问',
    };
    return providerMap[provider] || provider;
  };

  const formatParticipants = (participants: string | undefined | null) => {
    if (!participants) return 'management';
    return participants;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const getAudioUrl = () => {
    if (!id) return '';
    const token = localStorage.getItem('auth_token') || '';
    const baseUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:8080/api'
      : '/api';
    return `${baseUrl}/transcriptions/${id}/audio?token=${encodeURIComponent(token)}`;
  };

  const handleDownloadAudio = () => {
    if (!id || !transcription) return;

    const audioUrl = getAudioUrl();
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = transcription.fileName || 'audio.mp3';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('开始下载音频文件');
  };

  // --- Actual date editing ---
  const handleStartEditActualDate = () => {
    if (transcription) {
      const actualDate = transcription.actualDate
        ? dayjs(transcription.actualDate)
        : null;
      setEditedActualDate(actualDate);
      setEditingActualDate(true);
    }
  };

  const handleSaveActualDate = async () => {
    if (!transcription?.id) return;

    try {
      const dateValue = editedActualDate ? editedActualDate.format('YYYY-MM-DD') : null;
      const response = await updateTranscriptionActualDate(transcription.id, dateValue);
      if (response.success && response.data) {
        setTranscription(response.data);
        setEditingActualDate(false);
        message.success('实际发生日期更新成功');
      }
    } catch (error: any) {
      message.error('更新实际发生日期失败：' + (error.message || '未知错误'));
    }
  };

  const handleCancelEditActualDate = () => {
    setEditingActualDate(false);
    setEditedActualDate(null);
  };

  // --- Share ---
  const handleShare = async () => {
    message.warning('分享功能已移除');
  };

  // --- Dispatch to Canvas ---
  const handleDispatchToCanvas = () => {
    if (!transcription) return;

    const translatedText = translationEditor.translatedSummary || transcription.translatedSummary || '';
    const englishText = summaryEditor.editedSummary || transcription.summary || '';

    if (!translatedText && !englishText) {
      message.warning('没有可派发的笔记内容');
      return;
    }

    const { addNode, viewport } = useCanvasStore.getState();
    const { setViewMode } = useAICardStore.getState();
    
    const viewportX = viewport.x || 0;
    const viewportY = viewport.y || 0;
    const zoom = viewport.zoom || 1;
    const centerX = -viewportX / zoom + window.innerWidth / (2 * zoom);
    const centerY = -viewportY / zoom + window.innerHeight / (2 * zoom);

    if (translatedText) {
      addNode({
        id: generateId(),
        type: 'markdown',
        position: { x: centerX - 300, y: centerY - 100 },
        data: {
          type: 'markdown',
          title: `${transcription.fileName || '智能笔记'} (中文解析)`,
          content: translatedText,
          metadata: {
            "来源": "AI Process",
            "录音名称": transcription.fileName || '未知',
            "派发时间": new Date().toLocaleString()
          }
        },
        style: { 
          backgroundColor: '#e6f4ff', 
          borderColor: '#1677ff',
        }
      });
    }

    if (englishText) {
      addNode({
        id: generateId(),
        type: 'markdown',
        position: { x: centerX + 200, y: centerY - 100 },
        data: {
          type: 'markdown',
          title: `${transcription.fileName || '智能笔记'} (Original Audio)`,
          content: englishText,
          metadata: {
            "来源": "AI Process",
            "录音名称": transcription.fileName || '未知',
          }
        },
        style: { 
          backgroundColor: '#f5f5f5',
          borderColor: '#d9d9d9',
        }
      });
    }

    message.success('已一键派发至研究画板！');
    setViewMode('canvas');
  };

  // --- Upload ---
  const handleUpload = async () => {
    if (uploadFileList.length === 0) {
      message.warning('请选择要上传的音频文件');
      return;
    }

    const fileItem = uploadFileList[0];
    const file = (fileItem.originFileObj || fileItem) as File;

    if (!file || !(file instanceof File)) {
      message.error('文件格式无效，请重新选择文件');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      const request: any = {
        file,
        aiProvider: uploadAiProvider,
      };

      if (apiConfig.geminiApiKey) {
        request.geminiApiKey = apiConfig.geminiApiKey;
      }

      if (uploadAiProvider === 'qwen' && apiConfig.qwenApiKey) {
        request.qwenApiKey = apiConfig.qwenApiKey;
      }

      const response = await createTranscription(request);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (response.success && response.data) {
        message.success('转录成功！');
        setShowUploadModal(false);
        setUploadFileList([]);
        setUploadProgress(0);
        await transcriptionList.loadTranscriptions();
        if (response.data.id) {
          loadTranscription(response.data.id);
        }
      } else {
        throw new Error(response.error || '转录失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || '上传失败');
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  // --- Sidebar item select (for read-only mode) ---
  const handleSelectTranscription = (item: Transcription) => {
    if (externalData && externalData.length > 0) {
      const targetNote = externalData.find(n => n.id === item.id);
      if (targetNote) {
        setTranscription(targetNote);
        summaryEditor.setEditedSummary(getSummaryWithCitations(targetNote));
        summaryEditor.setHasChanges(false);
        summaryEditor.setSaveStatus('saved');
        const savedTranslation = targetNote.translatedSummary || '';
        if (savedTranslation) {
          translationEditor.setTranslatedSummary(savedTranslation);
          translationEditor.setHasTranslation(true);
        } else {
          translationEditor.setTranslatedSummary('');
          translationEditor.setHasTranslation(false);
        }
        translationEditor.setHasChangesZh(false);
        translationEditor.setSaveStatusZh('saved');
      }
    } else {
      loadTranscription(item.id);
    }
  };

  // --- Tab bar extra content ---
  const renderTabBarExtraContent = () => {
    if (isReadOnly) {
      return (
        <Space size={4}>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={handleFullscreen}
            size="small"
            title={isFullscreen ? "退出全屏" : "全屏"}
            className={styles.tabBarIconBtn}
          />
        </Space>
      );
    }

    if (activeTab === 'summary') {
      return (
        <Space size={4}>
          {summaryEditor.saveStatus === 'saving' && (
            <SyncOutlined spin style={{ color: '#1677ff', fontSize: 14 }} />
          )}

          <Button
            type="text"
            icon={<SaveOutlined />}
            onClick={() => summaryEditor.handleSaveSummary(true)}
            loading={summaryEditor.saving}
            disabled={!summaryEditor.hasChanges || transcription?.status === 'failed'}
            size="small"
            title="立即保存（或等待 3 秒自动保存）"
            className={styles.tabBarIconBtn}
            style={summaryEditor.hasChanges ? { color: '#1677ff' } : undefined}
          />
          <Dropdown
            menu={{
              items: [
                { key: 'summary', label: '重新生成总结' },
                { key: 'metadata', label: '重新提取元数据' },
                { key: 'all', label: '全部重新生成' },
              ],
              onClick: ({ key }) => {
                promptConfig.handleRegenerateSummary(key as 'summary' | 'metadata' | 'all');
                promptConfig.setRegenerateDropdownOpen(false);
              },
            }}
            open={promptConfig.regenerateDropdownOpen}
            onOpenChange={promptConfig.setRegenerateDropdownOpen}
            disabled={!transcription?.transcriptText || (id ? promptConfig.regenerating[id] || false : false)}
            trigger={['click']}
          >
            <Button
              type="text"
              icon={<ReloadOutlined />}
              loading={id ? promptConfig.regenerating[id] || false : false}
              disabled={!transcription?.transcriptText}
              size="small"
              title="重新生成"
              className={styles.tabBarIconBtn}
            >
              <DownOutlined style={{ fontSize: 8, marginLeft: 2 }} />
            </Button>
          </Dropdown>
          <Button
            type="text"
            icon={<SettingOutlined />}
            onClick={() => promptConfig.setShowPromptConfig(true)}
            size="small"
            title="Prompt 设置"
            className={styles.tabBarIconBtn}
          />
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={handleFullscreen}
            size="small"
            title={isFullscreen ? "退出全屏" : "全屏"}
            className={styles.tabBarIconBtn}
          />
          <Button
            type="text"
            icon={<ShareAltOutlined />}
            onClick={handleShare}
            loading={sharing}
            size="small"
            title="分享此笔记"
            className={styles.tabBarIconBtn}
          />
        </Space>
      );
    } else if (activeTab === 'summary-zh') {
      return (
        <Space size={4}>
          {translationEditor.saveStatusZh === 'saving' && (
            <SyncOutlined spin style={{ color: '#1677ff', fontSize: 14 }} />
          )}

          <Button
            type="text"
            icon={<SaveOutlined />}
            onClick={() => translationEditor.handleSaveTranslatedSummary(true)}
            loading={translationEditor.savingZh}
            disabled={!translationEditor.hasChangesZh || transcription?.status === 'failed'}
            size="small"
            title="立即保存（或等待 3 秒自动保存）"
            className={styles.tabBarIconBtn}
            style={translationEditor.hasChangesZh ? { color: '#1677ff' } : undefined}
          />

          <Button
            type="text"
            icon={<TranslationOutlined />}
            onClick={translationEditor.handleTranslateSummary}
            loading={translationEditor.translating[id || ''] || false}
            disabled={transcription?.status === 'failed' || !summaryEditor.editedSummary || (translationEditor.translating[id || ''] || false)}
            size="small"
            title="翻译到中文"
            className={styles.tabBarIconBtn}
          />

          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={handleFullscreen}
            size="small"
            title={isFullscreen ? "退出全屏" : "全屏"}
            className={styles.tabBarIconBtn}
          />
          <Button
            type="text"
            icon={<ShareAltOutlined />}
            onClick={handleShare}
            loading={sharing}
            size="small"
            title="分享此笔记"
            className={styles.tabBarIconBtn}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleDispatchToCanvas}
            size="small"
            title="一键派发至画板"
            className={styles.tabBarIconBtn}
            style={{ marginLeft: 8 }}
          >
            派发至画板
          </Button>
        </Space>
      );
    } else if (activeTab === 'transcript') {
      if (transcription?.filePath) {
        return (
          <Button
            type="text"
            icon={<DownloadOutlined />}
            onClick={handleDownloadAudio}
            size="small"
            title="下载音频"
            className={styles.tabBarIconBtn}
          />
        );
      }
    }
    return null;
  };

  return (
    <div className={styles.transcriptionDetailPage}>
      <div className={styles.detailLayout}>
        {/* 移动端侧边栏遮罩 */}
        <div
          className={`${styles.sidebarBackdrop} ${sidebarCollapsed ? styles.hidden : ''}`}
          onClick={() => setSidebarCollapsed(true)}
        />
        {/* 左侧：历史记录列表 */}
        <div className={`w-[280px] min-w-[280px] bg-slate-50 border-r border-slate-200 flex flex-col h-full overflow-hidden transition-all duration-300 ${sidebarCollapsed ? '!w-0 !min-w-0 border-r-0 opacity-0 pointer-events-none' : ''}`}>
          <TranscriptionSidebar
            transcriptions={transcriptionList.transcriptions}
            filteredTranscriptions={transcriptionList.filteredTranscriptions}
            listLoading={transcriptionList.listLoading}
            hasMore={transcriptionList.hasMore}
            searchQuery={transcriptionList.searchQuery}
            selectedCalendarDate={transcriptionList.selectedCalendarDate}
            calendarDateType={transcriptionList.calendarDateType}
            listHeight={transcriptionList.listHeight}
            sidebarContentRef={transcriptionList.sidebarContentRef}
            listRef={transcriptionList.listRef}
            transcription={transcription}
            id={id}
            externalData={externalData}
            onSearch={transcriptionList.searchTranscriptions}
            onSetSearchQuery={transcriptionList.setSearchQuery}
            onSetCurrentPage={transcriptionList.setCurrentPage}
            onLoadTranscriptions={transcriptionList.loadTranscriptions}
            onLoadMore={transcriptionList.loadMore}
            onCalendarDateSelect={transcriptionList.handleCalendarDateSelect}
            onCalendarDateTypeChange={transcriptionList.setCalendarDateType}
            onSetSelectedCalendarDate={transcriptionList.setSelectedCalendarDate}
            onDelete={handleDelete}
            onLoadTranscription={loadTranscription}
            onSelectTranscription={handleSelectTranscription}
            formatParticipants={formatParticipants}
          />
        </div>

        {/* 右侧：AI总结 */}
        <div className={styles.detailMain}>
          {loading ? (
            <div className={styles.loadingContainer}>
              <Spin size="large" />
            </div>
          ) : !transcription ? (
            <div className={styles.emptyState}>
              <Empty description="请从左侧选择一个转录记录" />
            </div>
          ) : (
            <Card className={styles.summaryCard} ref={summaryCardRef}>
              {/* 头部信息 - 固定在顶部 */}
              {!isFullscreen && (
                <MetadataHeader
                  transcription={transcription}
                  editingFileName={fileNameEditor.editingFileName}
                  editedFileName={fileNameEditor.editedFileName}
                  setEditedFileName={fileNameEditor.setEditedFileName}
                  handleSaveFileName={fileNameEditor.handleSaveFileName}
                  handleStartEditFileName={fileNameEditor.handleStartEditFileName}
                  handleCancelEditFileName={fileNameEditor.handleCancelEditFileName}
                  editingMetadata={metadataEditor.editingMetadata}
                  editedMetadata={metadataEditor.editedMetadata}
                  setEditedMetadata={metadataEditor.setEditedMetadata}
                  industries={metadataEditor.industries}
                  handleStartEditMetadata={metadataEditor.handleStartEditMetadata}
                  handleSaveMetadata={metadataEditor.handleSaveMetadata}
                  handleCancelEditMetadata={metadataEditor.handleCancelEditMetadata}
                  formatParticipants={formatParticipants}
                  tagsNode={
                    <TagsRow
                      transcription={transcription}
                      editingTags={tagManager.editingTags}
                      setEditingTags={tagManager.setEditingTags}
                      tagInput={tagManager.tagInput}
                      setTagInput={tagManager.setTagInput}
                      handleAddTag={tagManager.handleAddTag}
                      handleRemoveTag={tagManager.handleRemoveTag}
                      handleKeyPressTag={tagManager.handleKeyPressTag}
                    />
                  }
                  onReprocess={async () => {
                    try {
                      const apiCfg = getApiConfig();
                      const savedPrompt = localStorage.getItem('summaryPrompt') || undefined;
                      message.loading({ content: '正在重新提交处理...', key: 'reprocess' });
                      await reprocessTranscription(transcription.id, apiCfg.qwenApiKey, apiCfg.geminiApiKey, savedPrompt);
                      message.success({ content: '已重新提交处理', key: 'reprocess' });
                      loadTranscription(transcription.id);
                    } catch (e: any) {
                      message.error({ content: e.message || '重新处理失败', key: 'reprocess' });
                    }
                  }}
                />
              )}

              {/* Tabs - 占据剩余空间 */}
              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                tabBarExtraContent={renderTabBarExtraContent()}
                items={[
                  {
                    key: 'summary',
                    label: <FileTextOutlined />,
                    children: (
                      <div className={`${styles.summaryContent}${transcription.type === 'weekly-summary' ? ` ${styles.weeklySummaryLayout}` : ''}`} ref={summaryContentRef} onClick={async (e) => {
                        const target = e.target as HTMLElement;
                        const link = target.closest('a');
                        if (!link) return;

                        const href = link.getAttribute('href');
                        if (!href || !href.startsWith('/transcription/')) return;
                        e.preventDefault();

                        // 周报类型：点击引用链接 → 弹窗预览笔记
                        if (transcription.type === 'weekly-summary') {
                          const noteId = href.replace('/transcription/', '');
                          const hide = message.loading('加载笔记...', 0);
                          try {
                            const response = await getTranscription(noteId);
                            if (response.success && response.data) {
                              setCitationPreviewNote(response.data);
                            } else {
                              setCitationPreviewNote({ id: noteId, fileName: link.getAttribute('title') || '笔记' } as any);
                            }
                          } catch (error) {
                            console.error('获取笔记详情失败:', error);
                            message.error('加载笔记内容失败');
                            setCitationPreviewNote({ id: noteId, fileName: link.getAttribute('title') || '笔记' } as any);
                          } finally {
                            hide();
                            setCitationPreviewVisible(true);
                          }
                          return;
                        }

                        // 普通笔记：路由跳转
                        navigate(href);
                      }}>
                        {/* 周报：直接 HTML 渲染（绕过 TipTap schema 限制）；普通笔记：TipTap 编辑器 */}
                        {transcription.type === 'weekly-summary' ? (
                          <div
                            className={styles.weeklyHtmlContent}
                            dangerouslySetInnerHTML={{ __html: summaryEditor.editedSummary }}
                          />
                        ) : (
                          <BlockNoteTextEditor
                            content={summaryEditor.editedSummary}
                            onChange={summaryEditor.handleSummaryChange}
                            editable={!isReadOnly}
                            placeholder={transcription.status === 'failed' ? '转录失败，无法生成总结。' : 'Notes 内容将在这里显示，您可以自由编辑。选中文本后将显示格式工具栏，支持粘贴图片...'}
                          />
                        )}
                        {/* 周报类型：Token 使用率统计 */}
                        {transcription.type === 'weekly-summary' && (() => {
                          let weeklyData: any = {};
                          try {
                            weeklyData = JSON.parse(transcription.transcriptText || '{}');
                          } catch {}
                          if (!weeklyData.tokenStats) return null;
                          const ts = weeklyData.tokenStats;
                          const callDesc: string[] = [];
                          if (ts.batchCount > 1) callDesc.push(`${ts.batchCount} 批输入`);
                          if (ts.continueCalls > 0) callDesc.push(`${ts.continueCalls} 次续写`);
                          const callSummary = callDesc.length > 0
                            ? `${ts.totalCalls} 次调用（${callDesc.join('，')}）`
                            : '1 次调用';
                          return (
                            <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 16px' }}>
                              <div style={{ padding: '6px 10px', background: '#f6f8fa', borderRadius: 4, fontSize: 12 }}>
                                <span style={{ fontWeight: 500, color: '#666' }}>Token 使用率</span>
                                <span style={{ color: '#999', marginLeft: 6 }}>({ts.model})</span>
                                <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                                  <span>
                                    输入：<strong>{ts.inputTokens?.toLocaleString()}</strong> / {ts.inputLimit?.toLocaleString()}
                                    <span style={{ color: ts.inputUtilization > 80 ? '#faad14' : '#52c41a', marginLeft: 4 }}>
                                      ({ts.inputUtilization}%)
                                    </span>
                                  </span>
                                  <span>
                                    输出：<strong>{ts.outputTokens?.toLocaleString()}</strong> / {ts.outputLimit?.toLocaleString()}
                                    <span style={{ color: ts.outputUtilization > 90 ? '#ff4d4f' : ts.outputUtilization > 70 ? '#faad14' : '#52c41a', marginLeft: 4 }}>
                                      ({ts.outputUtilization}%)
                                    </span>
                                  </span>
                                  <span style={{ color: '#888' }}>
                                    {callSummary}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ),
                  },
                  {
                    key: 'summary-zh',
                    label: <TranslationOutlined />,
                    children: (
                      <div className={styles.summaryContent}>
                        <BlockNoteTextEditor
                          content={translationEditor.translatedSummary}
                          onChange={translationEditor.handleTranslatedSummaryChange}
                          editable={!isReadOnly}
                          placeholder={transcription.status === 'failed' ? '转录失败，无法翻译。' : translationEditor.hasTranslation ? '中文翻译内容将在这里显示，您可以自由编辑。选中文本后将显示格式工具栏，支持粘贴图片...' : '点击"中"按钮开始翻译...'}
                        />
                      </div>
                    ),
                  },
                  {
                    key: 'transcript',
                    label: transcription.type === 'merge' ? <span><LinkOutlined /></span> : <span><PaperClipOutlined /></span>,
                    children: (
                      <TranscriptTab
                        transcription={transcription}
                        id={id}
                        audioPlayerRef={audioPlayerRef}
                        segmentRefs={audioPlayback.segmentRefs}
                        transcriptContentRef={transcriptContentRef}
                        currentTime={audioPlayback.currentTime}
                        handleAudioTimeUpdate={audioPlayback.handleAudioTimeUpdate}
                        jumpToTime={audioPlayback.jumpToTime}
                        getAudioUrl={getAudioUrl}
                        getProviderText={getProviderText}
                        formatFileSize={formatFileSize}
                      />
                    ),
                  },
                ]}
                defaultActiveKey="summary"
              />
            </Card>
          )}
        </div>
      </div>

      {/* Prompt 设置模态框 */}
      <PromptConfigModal
        open={promptConfig.showPromptConfig}
        onOk={promptConfig.handleSavePrompt}
        onCancel={() => promptConfig.setShowPromptConfig(false)}
        customPrompt={promptConfig.customPrompt}
        setCustomPrompt={promptConfig.setCustomPrompt}
        metadataPrompt={promptConfig.metadataPrompt}
        setMetadataPrompt={promptConfig.setMetadataPrompt}
      />

      {/* 上传转录模态框 */}
      <Modal
        title="上传音频文件"
        open={showUploadModal}
        onCancel={() => {
          setShowUploadModal(false);
          setUploadFileList([]);
          setUploadProgress(0);
        }}
        footer={null}
        width={600}
      >
        <div style={{ padding: '20px 0' }}>
          <Dragger
            fileList={uploadFileList}
            onChange={({ fileList }) => {
              const MAX_FILES = 50;
              const limitedFileList = fileList.length > MAX_FILES
                ? fileList.slice(0, MAX_FILES)
                : fileList;
              if (fileList.length > MAX_FILES) {
                message.warning(`最多只能上传 ${MAX_FILES} 个文件，已自动移除多余的文件`);
              }
              setUploadFileList(limitedFileList);
            }}
            beforeUpload={() => false}
            accept="audio/*"
            disabled={uploading}
            style={{ marginBottom: 20 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽音频文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 MP3、WAV、M4A、OGG 等常见音频格式，单个文件不超过100MB
            </p>
          </Dragger>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 14 }}>选择AI服务：</label>
            <Select
              value={uploadAiProvider}
              onChange={setUploadAiProvider}
              style={{ width: 200 }}
              disabled={uploading}
            >
              <Select.Option value="gemini">Google Gemini - 2.5 Flash</Select.Option>
              <Select.Option value="qwen">阿里通义千问</Select.Option>
            </Select>
          </div>

          {uploadAiProvider === 'gemini' && !apiConfig.geminiApiKey && (
            <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, fontSize: 13, color: '#d46b08', border: '1px solid #ffd591' }}>
              ⚠️ 未配置 Gemini API 密钥，请点击右上角"配置"按钮进行配置
            </div>
          )}
          {uploadAiProvider === 'qwen' && !apiConfig.qwenApiKey && (
            <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, fontSize: 13, color: '#d46b08', border: '1px solid #ffd591' }}>
              ⚠️ 未配置通义千问 API 密钥，请点击右上角"配置"按钮进行配置
            </div>
          )}

          {uploading && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <Spin size="large" />
              <Progress percent={uploadProgress} status="active" style={{ marginTop: 16 }} />
              <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>正在处理音频，请稍候...</p>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
            <Button
              onClick={() => {
                setShowUploadModal(false);
                setUploadFileList([]);
                setUploadProgress(0);
              }}
              disabled={uploading}
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleUpload}
              disabled={uploadFileList.length === 0 || uploading}
              loading={uploading}
              icon={<CloudUploadOutlined />}
            >
              开始转录
            </Button>
          </div>
        </div>
      </Modal>

      {/* 分享链接显示模态框 */}
      <Modal
        title="分享链接"
        open={!!shareUrl}
        onCancel={() => {
          setShareUrl(null);
        }}
        footer={[
          <Button key="close" onClick={() => setShareUrl(null)}>
            关闭
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={async () => {
              if (shareUrl) {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  message.success('链接已复制到剪贴板！');
                } catch (err) {
                  const input = document.createElement('input');
                  input.value = shareUrl;
                  document.body.appendChild(input);
                  input.select();
                  try {
                    document.execCommand('copy');
                    message.success('链接已复制到剪贴板！');
                  } catch (e) {
                    message.error('复制失败，请手动复制');
                  }
                  document.body.removeChild(input);
                }
              }
            }}
          >
            复制链接
          </Button>,
        ]}
        width={600}
      >
        <div style={{ padding: '20px 0' }}>
          <p style={{ marginBottom: 12, color: '#666' }}>
            分享链接已生成，任何人都可以通过此链接查看此笔记：
          </p>
          <Input
            value={shareUrl || ''}
            readOnly
            onClick={(e) => {
              (e.target as HTMLInputElement).select();
            }}
          />
          <p style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
            提示：此链接为公开链接，无需登录即可访问。点击链接可全选，或使用复制按钮。
          </p>
        </div>
      </Modal>

      {/* 周报来源笔记预览弹窗 */}
      <Modal
        title={citationPreviewNote?.topic || citationPreviewNote?.fileName || '笔记详情'}
        open={citationPreviewVisible}
        onCancel={() => setCitationPreviewVisible(false)}
        footer={[
          ...(!isReadOnly ? [
            <Button key="detail" type="primary" onClick={() => {
              setCitationPreviewVisible(false);
              if (citationPreviewNote) navigate(`/transcription/${citationPreviewNote.id}`);
            }}>
              查看详情
            </Button>,
          ] : []),
          <Button key="close" onClick={() => setCitationPreviewVisible(false)}>
            关闭
          </Button>,
        ]}
        width={1200}
      >
        {citationPreviewNote && (
          <div>
            <div style={{ marginBottom: 16, padding: '12px', background: '#f5f5f5', borderRadius: 4 }}>
              <Space size={16} wrap>
                <span><strong>公司:</strong> {(citationPreviewNote as any).organization || '未知'}</span>
                <span><strong>行业:</strong> {(citationPreviewNote as any).industry || '未知'}</span>
                <span><strong>参与人:</strong> {citationPreviewNote.participants || '未知'}</span>
                <span><strong>日期:</strong> {(citationPreviewNote as any).eventDate || '未提及'}</span>
              </Space>
            </div>
            <div style={{ background: '#fafafa', borderRadius: 4, maxHeight: 600, overflow: 'auto', padding: '16px' }}>
              <BlockNoteTextEditor
                content={
                  (citationPreviewNote.summary || '暂无总结') +
                  ((citationPreviewNote as any).translatedSummary
                    ? '<hr/><h3>中文翻译</h3>' + (citationPreviewNote as any).translatedSummary
                    : '')
                }
                onChange={() => {}}
                editable={false}
                hideToolbar
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TranscriptionDetailPage;
