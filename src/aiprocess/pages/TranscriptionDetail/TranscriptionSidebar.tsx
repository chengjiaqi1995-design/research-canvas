import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { List } from 'react-window';
import {
  Button,
  Spin,
  Popconfirm,
  Input,
  Empty,
} from 'antd';
import {
  DeleteOutlined,
  CalendarOutlined,
  SearchOutlined,
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
      {/* 日历图标按钮 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}>
        <Input
          placeholder="搜索笔记..."
          prefix={<SearchOutlined />}
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
          allowClear
          size="small"
          style={{ flex: 1 }}
        />
        <Button
          type="text"
          size="small"
          icon={<CalendarOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            console.log('日历按钮被点击，当前状态:', showCalendar);
            setShowCalendar(!showCalendar);
          }}
          style={{
            color: selectedCalendarDate ? '#1890ff' : '#666',
            background: showCalendar ? '#f0f5ff' : 'transparent',
          }}
          title="日历筛选"
        />
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

      <div className={styles.sidebarContent} ref={sidebarContentRef}>
        {listLoading && transcriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : filteredTranscriptions.length === 0 ? (
          <Empty description={selectedCalendarDate ? "该日期无转录记录" : searchQuery ? "未找到匹配的笔记" : "暂无转录记录"} />
        ) : (
          <List<Record<string, never>>
            listRef={listRef}
            defaultHeight={listHeight}
            rowCount={Math.max(0, filteredTranscriptions.length + (hasMore && !searchQuery && !selectedCalendarDate ? 1 : 0))}
            rowHeight={50}
            style={{ width: '100%', height: Math.min(listHeight, Math.max(0, filteredTranscriptions.length + (hasMore && !searchQuery && !selectedCalendarDate ? 1 : 0)) * 50) }}
            rowProps={{}}
            onRowsRendered={(visibleRows, allRows) => {
              if (visibleRows?.stopIndex >= filteredTranscriptions.length - 5 && hasMore && !searchQuery && !selectedCalendarDate && !listLoading) {
                onLoadMore();
              }
            }}
            rowComponent={(props) => {
              if (!props) {
                return <div style={{ height: 50 }} />;
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
                return <div style={{ ...(style || {}), height: 50 }} {...(ariaAttributes || {})} />;
              }

              const item = filteredTranscriptions[index];
              if (!item) {
                return <div style={{ ...(style || {}), height: 50 }} {...(ariaAttributes || {})} />;
              }

              const isSelected = item.id === (transcription?.id || id);
              return (
                <div
                  className={`${styles.historyItem} ${isSelected ? styles.selected : ''}`}
                  onClick={() => {
                    if (isReadOnly) {
                      onSelectTranscription(item);
                    } else {
                      navigate(`/transcription/${item.id}`, { replace: true });
                    }
                  }}
                  style={{ ...(style || {}), cursor: 'pointer' }}
                  {...(ariaAttributes || {})}
                >
                  <div className={styles.historyItemContent}>
                    <div className={styles.historyItemHeader}>
                      <span className={styles.historyItemTitle} title={item.topic || item.fileName}>
                        {item.topic || item.fileName}
                      </span>
                      {/* 只读模式下隐藏删除按钮 */}
                      {!isReadOnly && (
                        <Popconfirm
                          title="确定要删除这条记录吗？"
                          onConfirm={(e) => {
                            e?.stopPropagation();
                            onDelete(item.id);
                          }}
                          okText="确定"
                          cancelText="取消"
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            style={{ marginLeft: 'auto', color: '#999' }}
                          />
                        </Popconfirm>
                      )}
                    </div>
                    {(item.participants && item.participants !== '未知') || true ? (
                      <div className={styles.historyItemMeta}>
                        {item.participants && item.participants !== '未知' && (
                          <span className={styles.historyItemInfo}>
                            {formatParticipants(item.participants)}
                          </span>
                        )}
                        <span className={styles.historyItemDate}>
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
                </div>
              );
            }}
          />
        )}
      </div>
    </>
  );
};

export default TranscriptionSidebar;
