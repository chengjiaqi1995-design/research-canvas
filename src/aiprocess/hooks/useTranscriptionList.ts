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
const SEARCH_PAGE_SIZE = 100;

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
  const filtersReadyRef = useRef(false);
  const requestSeqRef = useRef(0);
  const hasAdvancedFilters = filterUnsynced || noteTypeFilters.length > 0 || generationMethodFilters.length > 0;
  const noteTypeFilterKey = noteTypeFilters.join(',');
  const generationMethodFilterKey = generationMethodFilters.join(',');

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

  const loadTranscriptions = async (
    page: number = 1,
    append: boolean = false,
    pageSize: number = searchQuery ? SEARCH_PAGE_SIZE : DEFAULT_PAGE_SIZE,
    searchOverride?: string
  ) => {
    if (listLoading && append) return;

    const requestSeq = ++requestSeqRef.current;
    const effectiveSearch = searchOverride !== undefined ? searchOverride : searchQuery;
    setListLoading(true);
    try {
      const response = await getTranscriptions({
        page,
        pageSize,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        ...(effectiveSearch.trim() ? { search: effectiveSearch.trim() } : {}),
        ...(filterUnsynced ? { unsynced: 'true' as const } : {}),
        ...(noteTypeFilters.length > 0 ? { noteTypes: noteTypeFilters.join(',') } : {}),
        ...(generationMethodFilters.length > 0 ? { generationMethods: generationMethodFilters.join(',') } : {}),
      });
      if (response.success && response.data) {
        if (requestSeq !== requestSeqRef.current) return;
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
      if (requestSeq !== requestSeqRef.current) return;
      message.error('加载列表失败：' + (error.message || '未知错误'));
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setListLoading(false);
      }
    }
  };

  // 笔记类型/生成方式/未同步筛选走服务端，避免只筛当前第一页。
  useEffect(() => {
    if (!filtersReadyRef.current) {
      filtersReadyRef.current = true;
      return;
    }
    if (selectedCalendarDate) return;
    setCurrentPage(1);
    loadTranscriptions(1, false, searchQuery ? SEARCH_PAGE_SIZE : DEFAULT_PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUnsynced, noteTypeFilterKey, generationMethodFilterKey]);

  // 搜索笔记
  const searchTranscriptions = async (query: string) => {
    const nextQuery = query.trim();
    if (!nextQuery) {
      setSearchQuery('');
      setCurrentPage(1);
      loadTranscriptions(1, false, DEFAULT_PAGE_SIZE, '');
      return;
    }

    setSearchQuery(nextQuery);
    setCurrentPage(1);
    loadTranscriptions(1, false, SEARCH_PAGE_SIZE, nextQuery);
  };

  // 加载更多（滚动到底部时）
  const loadMore = useCallback(() => {
    if (!listLoading && hasMore && !selectedCalendarDate) {
      const nextPage = currentPage + 1;
      loadTranscriptions(nextPage, true, searchQuery ? SEARCH_PAGE_SIZE : DEFAULT_PAGE_SIZE);
    }
  }, [listLoading, hasMore, currentPage, searchQuery, selectedCalendarDate, filterUnsynced, noteTypeFilterKey, generationMethodFilterKey]);

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
