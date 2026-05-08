import { useState, useEffect, useRef, useCallback } from 'react';
import { message } from 'antd';
import { getTranscriptions } from '../api/transcription';
import type { Transcription } from '../types';
import {
  getGenerationMethod,
  getTranscriptionNoteTypes,
  type GenerationMethodFilter,
  type NoteTypeFilter,
} from '../utils/transcriptionFilters';

const DEFAULT_PAGE_SIZE = 50;
const FILTER_PAGE_SIZE = 1000;

export function useTranscriptionList() {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [calendarDateType, setCalendarDateType] = useState<'created' | 'event'>('created');
  const [filterUnsynced, setFilterUnsynced] = useState(false);
  const [noteTypeFilters, setNoteTypeFilters] = useState<NoteTypeFilter[]>([]);
  const [generationMethodFilters, setGenerationMethodFilters] = useState<GenerationMethodFilter[]>([]);
  const [listHeight, setListHeight] = useState(600);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const hasAdvancedFilters = filterUnsynced || noteTypeFilters.length > 0 || generationMethodFilters.length > 0;

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

  const loadTranscriptions = async (page: number = 1, append: boolean = false, pageSize: number = DEFAULT_PAGE_SIZE) => {
    if (listLoading) return;

    setListLoading(true);
    try {
      const response = await getTranscriptions({
        page,
        pageSize,
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
        setHasMore(newItems.length === pageSize && response.data.total > page * pageSize);
        setCurrentPage(page);
      }
    } catch (error: any) {
      message.error('加载列表失败：' + (error.message || '未知错误'));
    } finally {
      setListLoading(false);
    }
  };

  // 语义筛选需要覆盖更多历史记录，否则只会筛当前第一页。
  useEffect(() => {
    if (!hasAdvancedFilters || searchQuery || selectedCalendarDate || !hasMore || listLoading || transcriptions.length >= FILTER_PAGE_SIZE) {
      return;
    }
    loadTranscriptions(1, false, FILTER_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAdvancedFilters, searchQuery, selectedCalendarDate]);

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
        pageSize: 100,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: query.trim(),
      });
      if (response.success && response.data) {
        setTranscriptions(response.data.items);
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
    if (!listLoading && hasMore && !searchQuery && !selectedCalendarDate && !hasAdvancedFilters) {
      const nextPage = currentPage + 1;
      loadTranscriptions(nextPage, true);
    }
  }, [listLoading, hasMore, currentPage, searchQuery, selectedCalendarDate, hasAdvancedFilters]);

  // 根据日期筛选转录列表
  let filteredTranscriptions = selectedCalendarDate
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

  // 根据同步状态进行筛选
  if (filterUnsynced) {
    filteredTranscriptions = filteredTranscriptions.filter((t) => !t.lastSyncedAt);
  }

  if (noteTypeFilters.length > 0) {
    filteredTranscriptions = filteredTranscriptions.filter((t) => {
      const noteTypes = getTranscriptionNoteTypes(t);
      return noteTypes.some((type) => noteTypeFilters.includes(type));
    });
  }

  if (generationMethodFilters.length > 0) {
    filteredTranscriptions = filteredTranscriptions.filter((t) => generationMethodFilters.includes(getGenerationMethod(t)));
  }

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
    filterUnsynced,
    setFilterUnsynced,
    noteTypeFilters,
    setNoteTypeFilters,
    generationMethodFilters,
    setGenerationMethodFilters,
    hasAdvancedFilters,
    loadTranscriptions,
    searchTranscriptions,
    loadMore,
    handleCalendarDateSelect,
  };
}
