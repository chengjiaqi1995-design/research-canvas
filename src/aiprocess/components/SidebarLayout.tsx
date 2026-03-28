import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { useSidebar } from '../contexts/SidebarContext';
import { useTranscriptionList } from '../hooks/useTranscriptionList';
import { deleteTranscription } from '../api/transcription';
import apiClient from '../api/client';
import { TranscriptionSidebar } from '../pages/TranscriptionDetail';
import type { Transcription } from '../types';
import styles from '../pages/TranscriptionDetailPage.module.css';
import { useState } from 'react';

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
            onOpenUpload={() => navigate('/merge')}
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
    </div>
  );
};

export default SidebarLayout;
