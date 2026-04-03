import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { message, Modal, Upload, Select, Spin, Progress, Button } from 'antd';
import { CloudUploadOutlined, InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { useSidebar } from '../contexts/SidebarContext';
import { useTranscriptionList } from '../hooks/useTranscriptionList';
import { deleteTranscription, uploadWithSignedUrl } from '../api/transcription';
import apiClient from '../api/client';
import { TranscriptionSidebar } from '../pages/TranscriptionDetail';
import type { Transcription } from '../types';
import styles from '../pages/TranscriptionDetailPage.module.css';

const { Dragger } = Upload;

// Read API config from localStorage (same as TranscriptionDetailPage)
function getApiConfig() {
  try {
    const raw = localStorage.getItem('ai_process_api_config');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

interface SidebarLayoutProps {
  children: React.ReactNode;
}

/**
 * Shared layout that provides the transcription list sidebar on the left
 * and renders page content on the right. Used by MergePage, RealtimeRecordPage, etc.
 */
const SidebarLayout: React.FC<SidebarLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebar();
  const transcriptionList = useTranscriptionList();
  const [backupLoading, setBackupLoading] = useState(false);

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [uploadAiProvider, setUploadAiProvider] = useState<string>(() => {
    return localStorage.getItem('lastUploadAiProvider') || 'gemini';
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleProviderChange = (val: string) => {
    setUploadAiProvider(val);
    localStorage.setItem('lastUploadAiProvider', val);
  };

  const handleDelete = useCallback(async (transcriptionId?: string) => {
    if (!transcriptionId) return;
    try {
      const response = await deleteTranscription(transcriptionId);
      if (response.success) {
        message.success('删除成功');
        await transcriptionList.loadTranscriptions(1, false);
      }
    } catch (error: any) {
      message.error('删除失败：' + (error.message || '未知错误'));
    }
  }, [transcriptionList]);

  const formatParticipants = useCallback((participants: string | undefined | null) => {
    if (!participants) return 'management';
    return participants;
  }, []);

  const handleSelectTranscription = useCallback((item: Transcription) => {
    navigate(`/transcription/${item.id}`, { replace: true });
  }, [navigate]);

  const handleBackup = useCallback(async () => {
    try {
      setBackupLoading(true);
      message.loading({ content: '正在生成备份...', key: 'backup', duration: 0 });
      const response = await apiClient.get('/backup/export', {
        responseType: 'blob',
        timeout: 600000,
      });
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `AI-Process-Backup-${dateStr}.zip`;
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success({ content: '备份下载完成！', key: 'backup' });
    } catch (error: any) {
      console.error('备份失败:', error);
      message.error({ content: '备份失败，请稍后重试', key: 'backup' });
    } finally {
      setBackupLoading(false);
    }
  }, []);

  // --- Upload handler ---
  const handleUpload = async () => {
    if (uploadFileList.length === 0) {
      message.warning('请选择要上传的音频文件');
      return;
    }

    const files = uploadFileList
      .map((item) => (item.originFileObj || item) as File)
      .filter((f) => f instanceof File);

    if (files.length === 0) {
      message.error('文件格式无效，请重新选择文件');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const apiConfig = getApiConfig();
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      const signedUrlModel = uploadAiProvider === 'qwen-flash'
        ? 'qwen3-asr-flash-filetrans'
        : (uploadAiProvider.startsWith('qwen') ? 'paraformer-v2' : 'gemini');

      const aiProviderStr = (uploadAiProvider === 'gemini' ? 'gemini' : 'qwen');

      const promises = files.map((file) => {
        return uploadWithSignedUrl(
          file,
          signedUrlModel,
          aiProviderStr,
          {
            qwenApiKey: apiConfig.qwenApiKey || undefined,
            geminiApiKey: apiConfig.geminiApiKey || undefined,
            qwenModel: uploadAiProvider === 'gemini' ? undefined
              : uploadAiProvider === 'qwen-flash' ? 'qwen3-asr-flash-filetrans'
              : 'paraformer-v2',
            transcriptionModel: apiConfig.transcriptionModel || undefined,
            summaryModel: apiConfig.summaryModel || undefined,
            metadataModel: apiConfig.metadataModel || undefined,
            onProgress: () => {
              // Using fake progress globally
            }
          }
        );
      });

      const results = await Promise.all(promises);

      clearInterval(progressInterval);
      setUploadProgress(100);

      const successResults = results.filter((r) => r.success);
      const failedCount = results.length - successResults.length;

      if (successResults.length > 0 && failedCount === 0) {
        message.success(`成功转录！共 ${successResults.length} 个文件`);
        setShowUploadModal(false);
        setUploadFileList([]);
        setUploadProgress(0);
        await transcriptionList.loadTranscriptions();
        
        const lastSuccessId = successResults[successResults.length - 1].data?.id;
        if (lastSuccessId) {
          navigate(`/transcription/${lastSuccessId}`, { replace: true });
        }
      } else if (successResults.length > 0) {
        message.warning(`部分转录成功：${successResults.length}成功，${failedCount}失败`);
        setShowUploadModal(false);
        setUploadFileList([]);
        setUploadProgress(0);
        await transcriptionList.loadTranscriptions();
      } else {
        throw new Error(results[0]?.error || '转录失败');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || '上传失败');
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.transcriptionDetailPage}>
      <div className={styles.detailLayout}>
        {/* Mobile sidebar backdrop */}
        <div
          className={`${styles.sidebarBackdrop} ${sidebarCollapsed ? styles.hidden : ''}`}
          onClick={() => setSidebarCollapsed(true)}
        />
        {/* Left sidebar */}
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
            transcription={null}
            id={undefined}
            filterUnsynced={transcriptionList.filterUnsynced}
            setFilterUnsynced={transcriptionList.setFilterUnsynced}
            onSearch={transcriptionList.searchTranscriptions}
            onSetSearchQuery={transcriptionList.setSearchQuery}
            onSetCurrentPage={transcriptionList.setCurrentPage}
            onLoadTranscriptions={transcriptionList.loadTranscriptions}
            onLoadMore={transcriptionList.loadMore}
            onCalendarDateSelect={transcriptionList.handleCalendarDateSelect}
            onCalendarDateTypeChange={transcriptionList.setCalendarDateType}
            onSetSelectedCalendarDate={transcriptionList.setSelectedCalendarDate}
            onDelete={handleDelete}
            onLoadTranscription={async () => {}}
            onSelectTranscription={handleSelectTranscription}
            formatParticipants={formatParticipants}
            onOpenUpload={() => setShowUploadModal(true)}
            onOpenConfig={() => {}}
            onBackup={handleBackup}
            backupLoading={backupLoading}
          />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>

      {/* 上传转录模态框 */}
      <Modal
        title={`上传音频文件${uploadFileList.length > 0 ? ` (${uploadFileList.length} 个)` : ''}`}
        open={showUploadModal}
        onCancel={() => {
          setShowUploadModal(false);
          setUploadFileList([]);
          setUploadProgress(0);
        }}
        footer={null}
        width={600}
        maskClosable={!uploading}
      >
        <div style={{ padding: '20px 0' }}>
          <Dragger
            multiple
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
              支持多文件并发上传，MP3、WAV、M4A、OGG 等格式，单个文件不超过100MB
            </p>
          </Dragger>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: 14 }}>选择AI服务：</label>
            <Select
              value={uploadAiProvider}
              onChange={handleProviderChange}
              style={{ width: 220 }}
              disabled={uploading}
            >
              <Select.Option value="gemini">Google Gemini - 2.5 Flash</Select.Option>
              <Select.Option value="qwen-paraformer-v2">阿里通义千问 - Paraformer V2</Select.Option>
              <Select.Option value="qwen-flash">通义千问 - Qwen3 Flash (不区分说话人)</Select.Option>
            </Select>
          </div>

          {uploading && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <Spin size="large" />
              <Progress percent={uploadProgress} status="active" style={{ marginTop: 16 }} />
              <p style={{ marginTop: 12, color: '#666', fontSize: 13 }}>正在并发处理音频，请稍候...</p>
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
              开始转录 {uploadFileList.length > 0 ? `(${uploadFileList.length})` : ''}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SidebarLayout;
