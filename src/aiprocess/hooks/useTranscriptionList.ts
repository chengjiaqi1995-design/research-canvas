import { useState, useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { getTranscriptions } from '../api/transcription';
import type { Transcription } from '../types';

export function useTranscriptionList() {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [calendarDateType, setCalendarDateType] = useState<'created' | 'event'>('created');
  const [listHeight, setListHeight] = useState(600);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);

  // 动态计算列表高度
  useEffect(() => {
    const updateListHeight = () => {
      if (sidebarContentRef.current) {
        const height = sidebarContentRef.current.clientHeight;
        if (height > 0) {
          setListHeight(height);
        }
      }
    };

    updateListHeight();
    window.addEventListener('resize', updateListHeight);

    // 使用 ResizeObserver 监听容器大小变化
    const resizeObserver = new ResizeObserver(() => {
      updateListHeight();
    });

    if (sidebarContentRef.current) {
      resizeObserver.observe(sidebarContentRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateListHeight);
      resizeObserver.disconnect();
    };
  }, []);

  // 自动加载初始数据
  useEffect(() => {
    loadTranscriptions(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTranscriptions = async (page: number = 1, append: boolean = false) => {
    if (listLoading) return;

    setListLoading(true);
    try {
      const response = await getTranscriptions({
        page,
        pageSize: 50,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      if (response.success && response.data) {
        const newItems = response.data.items;
        if (append) {
          setTranscriptions(prev => [...prev, ...newItems]);
        } else {
          setTranscriptions(newItems);
        }
        setHasMore(newItems.length === 50 && response.data.total > page * 50);
        setCurrentPage(page);
      }
    } catch (error: any) {
      message.error('加载列表失败：' + (error.message || '未知错误'));
    } finally {
      setListLoading(false);
    }
  };

  // 搜索笔记
  const searchTranscriptions = async (query: string) => {
    if (!query.trim()) {
      setSearchQuery('');
      setCurrentPage(1);
      loadTranscriptions(1, false);
      return;
    }

    setListLoading(true);
    setSearchQuery(query);
    try {
      const response = await getTranscriptions({
        page: 1,
        pageSize: 1000,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      if (response.success && response.data) {
        const allItems = response.data.items;
        const filtered = allItems.filter(item => {
          const searchLower = query.toLowerCase();
          const fileName = (item.fileName || '').toLowerCase();
          const topic = (item.topic || '').toLowerCase();
          const summary = (item.summary || '').toLowerCase();
          const organization = (item.organization || '').toLowerCase();
          return fileName.includes(searchLower) ||
            topic.includes(searchLower) ||
            summary.includes(searchLower) ||
            organization.includes(searchLower);
        });
        setTranscriptions(filtered);
        setHasMore(false);
      }
    } catch (error: any) {
      message.error('搜索失败：' + (error.message || '未知错误'));
    } finally {
      setListLoading(false);
    }
  };

  // 加载更多（滚动到底部时）
  const loadMore = useCallback(() => {
    if (!listLoading && hasMore && !searchQuery && !selectedCalendarDate) {
      const nextPage = currentPage + 1;
      loadTranscriptions(nextPage, true);
    }
  }, [listLoading, hasMore, currentPage, searchQuery, selectedCalendarDate]);

  // 根据日期筛选转录列表
  const filteredTranscriptions = selectedCalendarDate
    ? transcriptions.filter((t) => {
      let dateToCompare: string;

      if (calendarDateType === 'created') {
        dateToCompare = new Date(t.createdAt).toLocaleDateString('zh-CN');
      } else {
        if (t.eventDate && t.eventDate !== '未提及') {
          try {
            const eventDate = new Date(t.eventDate.replace(/\//g, '-'));
            if (!isNaN(eventDate.getTime())) {
              dateToCompare = eventDate.toLocaleDateString('zh-CN');
            } else {
              dateToCompare = new Date(t.createdAt).toLocaleDateString('zh-CN');
            }
          } catch {
            dateToCompare = new Date(t.createdAt).toLocaleDateString('zh-CN');
          }
        } else {
          dateToCompare = new Date(t.createdAt).toLocaleDateString('zh-CN');
        }
      }

      return dateToCompare === selectedCalendarDate;
    })
    : transcriptions;

  // 处理日历日期选择
  const handleCalendarDateSelect = (date: string) => {
    if (selectedCalendarDate === date) {
      setSelectedCalendarDate(null);
    } else {
      setSelectedCalendarDate(date);
    }
  };

  return {
    transcriptions,
    setTranscriptions,
    listLoading,
    setListLoading,
    hasMore,
    setHasMore,
    currentPage,
    setCurrentPage,
    searchQuery,
    setSearchQuery,
    selectedCalendarDate,
    setSelectedCalendarDate,
    calendarDateType,
    setCalendarDateType,
    listHeight,
    sidebarContentRef,
    listRef,
    filteredTranscriptions,
    loadTranscriptions,
    searchTranscriptions,
    loadMore,
    handleCalendarDateSelect,
  };
}
