import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from 'react-window';
import {
  Button,
  Spin,
  Popconfirm,
  Input,
  Empty,
  Tooltip,
} from 'antd';
import {
  DeleteOutlined,
  CalendarOutlined,
  SearchOutlined,
  CloudUploadOutlined,
  MergeCellsOutlined,
  DownloadOutlined,
  AudioOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import CalendarPanel from '../../components/CalendarPanel';
import type { Transcription } from '../../types';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import styles from '../TranscriptionDetailPage.module.css';

interface TranscriptionSidebarProps {
  transcriptions: Transcription[];
  filteredTranscriptions: Transcription[];
  listLoading: boolean;
  hasMore: boolean;
  searchQuery: string;
  selectedCalendarDate: string | null;
  calendarDateType: 'created' | 'event';
  listHeight: number;
  sidebarContentRef: React.RefObject<HTMLDivElement | null>;
  listRef: React.MutableRefObject<any>;
  transcription: Transcription | null;
  id: string | undefined;
  externalData?: Transcription[];
  // Handlers
  onSearch: (query: string) => void;
  onSetSearchQuery: (query: string) => void;
  onSetCurrentPage: (page: number) => void;
  onLoadTranscriptions: (page?: number, append?: boolean) => Promise<void>;
  onLoadMore: () => void;
  onCalendarDateSelect: (date: string) => void;
  onCalendarDateTypeChange: (type: 'created' | 'event') => void;
  onSetSelectedCalendarDate: (date: string | null) => void;
  onDelete: (id?: string) => Promise<void>;
  onLoadTranscription: (id?: string, isPolling?: boolean) => Promise<void>;
  // For read-only sidebar click
  onSelectTranscription: (item: Transcription) => void;
  formatParticipants: (participants: string | undefined | null) => string;
  onOpenUpload: () => void;
  onOpenConfig: () => void;
  onBackup: () => void;
  backupLoading: boolean;
}

const TranscriptionSidebar: React.FC<TranscriptionSidebarProps> = ({
  transcriptions,
  filteredTranscriptions,
  listLoading,
  hasMore,
  searchQuery,
  selectedCalendarDate,
  calendarDateType,
  listHeight,
  sidebarContentRef,
  listRef,
  transcription,
  id,
  externalData,
  onSearch,
  onSetSearchQuery,
  onSetCurrentPage,
  onLoadTranscriptions,
  onLoadMore,
  onCalendarDateSelect,
  onCalendarDateTypeChange,
  onSetSelectedCalendarDate,
  onDelete,
  onLoadTranscription,
  onSelectTranscription,
  formatParticipants,
  onOpenUpload,
  onOpenConfig,
  onBackup,
  backupLoading,
}) => {
  const navigate = useNavigate();
  const { isReadOnly } = useReadOnly();
  const [showCalendar, setShowCalendar] = useState(false);

  // 点击外部关闭日历浮窗
  useEffect(() => {
    if (!showCalendar) return;

    const handleClickOutside = (e: MouseEvent) => {
      console.log('点击了外部');
      setShowCalendar(false);
    };

    const timer = setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [showCalendar]);

  return (
    <div className="flex flex-col h-full bg-slate-50 w-full">
      {/* Search + Global Action Icons Combined Header */}
      <div className="flex items-center gap-1 px-2 border-b border-slate-200 shrink-0 bg-white" style={{ minHeight: 38 }}>
        <input
          value={searchQuery}
          onChange={(e) => {
            const query = e.target.value;
            if (query.trim()) {
              onSearch(query);
            } else {
              onSetSearchQuery('');
              onSetCurrentPage(1);
              onLoadTranscriptions(1, false);
            }
          }}
          placeholder="搜索笔记..."
          className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-slate-50"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            className={`p-1 rounded hover:bg-slate-200 ${selectedCalendarDate || showCalendar ? 'text-blue-500 bg-blue-50' : 'text-slate-400'}`}
            onClick={(e) => { e.stopPropagation(); setShowCalendar(!showCalendar); }}
            title="日历筛选"
          >
            <CalendarOutlined style={{ fontSize: '13px' }} />
          </button>
          {!isReadOnly && (
            <>
              <Tooltip title="上传音频/视频进行多轨转录">
                <button onClick={onOpenUpload} className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-500">
                  <CloudUploadOutlined style={{ fontSize: '14px' }} />
                </button>
              </Tooltip>
              <Tooltip title="实时录音">
                <button onClick={() => navigate('/realtime')} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                  <AudioOutlined style={{ fontSize: '14px' }} />
                </button>
              </Tooltip>
              <Tooltip title="多文档合并 / 网页智能提取">
                <button onClick={() => navigate('/merge')} className="p-1 rounded hover:bg-purple-50 text-slate-400 hover:text-purple-500">
                  <MergeCellsOutlined style={{ fontSize: '14px' }} />
                </button>
              </Tooltip>
              <Tooltip title="完整数据导出">
                <button onClick={onBackup} disabled={backupLoading} className="p-1 rounded hover:bg-green-50 text-slate-400 hover:text-green-500">
                  {backupLoading ? <Spin size="small" /> : <DownloadOutlined style={{ fontSize: '14px' }} />}
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* 日历浮窗 */}
      {showCalendar && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: 100,
            left: 220,
            zIndex: 9999,
          }}
        >
          <CalendarPanel
            onDateSelect={onCalendarDateSelect}
            selectedDate={selectedCalendarDate}
            dateType={calendarDateType}
            onDateTypeChange={(type) => {
              onCalendarDateTypeChange(type);
              onSetSelectedCalendarDate(null);
            }}
            transcriptions={transcriptions}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden" ref={sidebarContentRef}>
        {listLoading && transcriptions.length === 0 ? (
          <div className="text-center py-10">
            <Spin />
          </div>
        ) : filteredTranscriptions.length === 0 ? (
          <div className="py-10">
            <Empty description={selectedCalendarDate ? "该日期无转录记录" : searchQuery ? "未找到匹配的笔记" : "暂无历史记录"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <List<Record<string, never>>
            listRef={listRef}
            defaultHeight={listHeight}
            rowCount={Math.max(0, filteredTranscriptions.length + (hasMore && !searchQuery && !selectedCalendarDate ? 1 : 0))}
            rowHeight={32}
            style={{ width: '100%', height: Math.min(listHeight, Math.max(0, filteredTranscriptions.length + (hasMore && !searchQuery && !selectedCalendarDate ? 1 : 0)) * 32), overflowX: 'hidden' }}
            rowProps={{}}
            onRowsRendered={(visibleRows, allRows) => {
              if (visibleRows?.stopIndex >= filteredTranscriptions.length - 5 && hasMore && !searchQuery && !selectedCalendarDate && !listLoading) {
                onLoadMore();
              }
            }}
            rowComponent={(props) => {
              if (!props) {
                return <div style={{ height: 32 }} />;
              }
              const { index, style, ariaAttributes } = props;
              // 加载更多提示
              if (index === filteredTranscriptions.length && hasMore && !searchQuery && !selectedCalendarDate) {
                return (
                  <div style={{ ...(style || {}), display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 8 }} {...(ariaAttributes || {})}>
                    {listLoading ? <Spin size="small" /> : <span style={{ color: '#999', fontSize: 11 }}>没有更多了</span>}
                  </div>
                );
              }

              if (index === undefined || index >= filteredTranscriptions.length) {
                return <div style={{ ...(style || {}), height: 32 }} {...(ariaAttributes || {})} />;
              }

              const item = filteredTranscriptions[index];
              if (!item) {
                return <div style={{ ...(style || {}), height: 32 }} {...(ariaAttributes || {})} />;
              }

              const isSelected = item.id === (transcription?.id || id);
              
              // Wrap the inner content in a div to properly handle the hover and padding
              // instead of applying margins to the absolutely positioned row.
              return (
                <div style={{ ...(style || {}), padding: '2px 4px' }} {...(ariaAttributes || {})}>
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer group text-xs transition-colors h-full ${
                      isSelected ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                    onClick={() => {
                      if (isReadOnly) {
                        onSelectTranscription(item);
                      } else {
                        navigate(`/transcription/${item.id}`, { replace: true });
                      }
                    }}
                  >
                    {(() => {
                      if (item.type === 'merge') {
                        return <MergeCellsOutlined className={`shrink-0 ${isSelected ? 'text-purple-500' : 'text-purple-400'}`} style={{ fontSize: '11px' }} />;
                      } else if (item.type === 'note') {
                        return <FileTextOutlined className={`shrink-0 ${isSelected ? 'text-amber-500' : 'text-amber-400'}`} style={{ fontSize: '11px' }} />;
                      } else if (item.fileSize === 0 && !item.filePath) {
                        return <AudioOutlined className={`shrink-0 ${isSelected ? 'text-red-500' : 'text-red-400'}`} style={{ fontSize: '11px' }} />;
                      } else {
                        return <CloudUploadOutlined className={`shrink-0 ${isSelected ? 'text-blue-500' : 'text-blue-400'}`} style={{ fontSize: '11px' }} />;
                      }
                    })()}
                    
                    <span className="flex-1 truncate flex items-center gap-1">
                      <span className="truncate">{item.topic || item.fileName}</span>
                      {(item.participants && item.participants !== '未知') && (
                        <span className="shrink-0 text-[10px] px-1 bg-slate-100/80 rounded text-slate-400 font-normal">
                          {formatParticipants(item.participants)}
                        </span>
                      )}
                    </span>
                    
                    <span className={`shrink-0 text-[10px] ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}>
                      {(() => {
                        if (item.eventDate && item.eventDate !== '未提及') return item.eventDate;
                        return new Date(item.createdAt).toLocaleDateString('zh-CN');
                      })()}
                    </span>

                    {!isReadOnly && (
                      <Popconfirm
                        title="确定要删除吗？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          onDelete(item.id);
                        }}
                        okText="确定"
                        cancelText="取消"
                      >
                        <button
                          className="hidden group-hover:block p-0.5 ml-1 rounded hover:bg-red-100 text-red-500 shrink-0 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                          title="删除"
                        >
                          <DeleteOutlined style={{ fontSize: '10px' }} />
                        </button>
                      </Popconfirm>
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

    </div>
  );
};

export default TranscriptionSidebar;
