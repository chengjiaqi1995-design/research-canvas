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
  SettingOutlined,
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
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 shrink-0 gap-2">
        <Input
          placeholder="搜索笔记..."
          prefix={<SearchOutlined className="text-slate-400" />}
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
          className="flex-1 bg-white"
          allowClear
          size="small"
        />
        <button
          className={`p-1 rounded transition-colors ${selectedCalendarDate ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'} ${showCalendar ? 'bg-slate-200' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowCalendar(!showCalendar);
          }}
          title="日历筛选"
        >
          <CalendarOutlined />
        </button>
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
            rowHeight={64}
            style={{ width: '100%', height: Math.min(listHeight, Math.max(0, filteredTranscriptions.length + (hasMore && !searchQuery && !selectedCalendarDate ? 1 : 0)) * 64) }}
            rowProps={{}}
            onRowsRendered={(visibleRows, allRows) => {
              if (visibleRows?.stopIndex >= filteredTranscriptions.length - 5 && hasMore && !searchQuery && !selectedCalendarDate && !listLoading) {
                onLoadMore();
              }
            }}
            rowComponent={(props) => {
              if (!props) {
                return <div style={{ height: 64 }} />;
              }
              const { index, style, ariaAttributes } = props;
              // 加载更多提示
              if (index === filteredTranscriptions.length && hasMore && !searchQuery && !selectedCalendarDate) {
                return (
                  <div style={{ ...(style || {}), display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }} {...(ariaAttributes || {})}>
                    {listLoading ? <Spin size="small" /> : <span style={{ color: '#999', fontSize: 12 }}>没有更多了</span>}
                  </div>
                );
              }

              if (index === undefined || index >= filteredTranscriptions.length) {
                return <div style={{ ...(style || {}), height: 64 }} {...(ariaAttributes || {})} />;
              }

              const item = filteredTranscriptions[index];
              if (!item) {
                return <div style={{ ...(style || {}), height: 64 }} {...(ariaAttributes || {})} />;
              }

              const isSelected = item.id === (transcription?.id || id);
              return (
                <div
                  className={`group relative flex flex-col justify-center px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50/50 border-r-2 border-r-blue-500' : 'hover:bg-slate-200/50'
                  }`}
                  onClick={() => {
                    if (isReadOnly) {
                      onSelectTranscription(item);
                    } else {
                      navigate(`/transcription/${item.id}`, { replace: true });
                    }
                  }}
                  style={{ ...(style || {}) }}
                  {...(ariaAttributes || {})}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm truncate mr-2 ${isSelected ? 'font-medium text-slate-900' : 'text-slate-700'}`} title={item.topic || item.fileName}>
                      {item.topic || item.fileName}
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
                          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity p-1 rounded hover:bg-white"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DeleteOutlined />
                        </button>
                      </Popconfirm>
                    )}
                  </div>
                  {(item.participants && item.participants !== '未知') || true ? (
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      {item.participants && item.participants !== '未知' ? (
                        <span className="truncate max-w-[60%]">
                          {formatParticipants(item.participants)}
                        </span>
                      ) : <span className="invisible">无</span>}
                      <span className="shrink-0">
                        {(() => {
                          if (item.eventDate && item.eventDate !== '未提及') {
                            return item.eventDate;
                          }
                          return new Date(item.createdAt).toLocaleDateString('zh-CN');
                        })()}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Global Action Buttons Footer */}
      {!isReadOnly && (
        <div className="flex items-center justify-around px-2 py-3 border-t border-slate-200 shrink-0 bg-slate-50">
          <Tooltip title="上传音频进行多轨大模型转录 (核心功能)">
            <Button type="text" icon={<CloudUploadOutlined />} onClick={onOpenUpload} className="text-slate-500 hover:text-blue-600 hover:bg-blue-50" />
          </Tooltip>
          <Tooltip title="多文档 / 网页文章智能提炼合并 (核心功能)">
            <Button type="text" icon={<MergeCellsOutlined />} onClick={() => navigate('/merge')} className="text-slate-500 hover:text-purple-600 hover:bg-purple-50" />
          </Tooltip>
          <Tooltip title="完整数据备份导出">
            <Button type="text" icon={<DownloadOutlined />} onClick={onBackup} loading={backupLoading} className="text-slate-500 hover:text-green-600 hover:bg-green-50" />
          </Tooltip>
          <Tooltip title="API设置管理">
            <Button type="text" icon={<SettingOutlined />} onClick={onOpenConfig} className="text-slate-500 hover:text-slate-800 hover:bg-slate-200" />
          </Tooltip>
        </div>
      )}
    </>
  );
};

export default TranscriptionSidebar;
