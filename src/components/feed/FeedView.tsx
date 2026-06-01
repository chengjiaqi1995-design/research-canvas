import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFeedStore } from '../../stores/feedStore.ts';
import { useAICardStore } from '../../stores/aiCardStore.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useMobileSidebarStore } from '../../stores/mobileSidebarStore.ts';
import { feedApi, notesApi } from '../../db/apiClient.ts';
import type { FeedItem } from '../../db/apiClient.ts';
import { useMobile } from '../../hooks/useMobile.ts';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';
import { FeedFilters } from './FeedFilters.tsx';
import { FeedListPanel } from './FeedListPanel.tsx';
import { FeedDetailPane } from './FeedDetailPane.tsx';
import { ReferencePreviewModal } from './ReferencePreviewModal.tsx';
import type { FeedNote, ReferencePreviewState } from '../../feed/feedReference.ts';
import { extractReferenceTextFromContent, findBestNoteMatches } from '../../feed/feedReference.ts';

async function loadAllReferenceNotes() {
  const response = await notesApi.query([], [], '2000-01-01', '2100-12-31', 'created');
  return response.notes || [];
}

export const FeedView = memo(function FeedView() {
  const isMobile = useMobile();
  const items = useFeedStore((s) => s.items);
  const total = useFeedStore((s) => s.total);
  const isLoading = useFeedStore((s) => s.isLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const loadMore = useFeedStore((s) => s.loadMore);
  const toggleStar = useFeedStore((s) => s.toggleStar);
  const toggleRead = useFeedStore((s) => s.toggleRead);
  const removeFeedItem = useFeedStore((s) => s.removeFeedItem);
  const setViewMode = useAICardStore((s) => s.setViewMode);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [referencePreview, setReferencePreview] = useState<ReferencePreviewState | null>(null);
  const notesCacheRef = useRef<FeedNote[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId),
    [items, selectedId],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore();
    }
  }, [loadMore]);

  const handleSelect = useCallback((item: FeedItem) => {
    setSelectedId(item.id);
    if (!item.isRead) void toggleRead(item.id);
    useMobileSidebarStore.getState().closer?.();
  }, [toggleRead]);

  const handleDelete = useCallback((id: string) => {
    if (window.confirm('确定删除这条信息？')) {
      void removeFeedItem(id);
    }
  }, [removeFeedItem]);

  const handleToggleStar = useCallback((id: string) => {
    void toggleStar(id);
  }, [toggleStar]);

  const handleOpenReference = useCallback((item: FeedItem, refNumber: number, refText?: string) => {
    const initialText = refText || extractReferenceTextFromContent(item.content, refNumber);
    setReferencePreview({
      itemTitle: item.title,
      refNumber,
      refText: initialText,
      loading: true,
      matches: [],
      canOpenInCanvas: false,
    });

    (async () => {
      try {
        const feedReference = await feedApi.getReference(item.id, refNumber, initialText).catch(() => null);
        if (feedReference?.note) {
          const directNote = feedReference.note;
          const canOpenInCanvas = Boolean(
            directNote.canvasId
            && directNote.workspaceId
            && directNote.sourceType !== 'aiprocess-transcription',
          );

          setReferencePreview((current) => {
            if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
            return {
              ...current,
              loading: false,
              refText: feedReference.refText || initialText,
              matches: [directNote],
              canOpenInCanvas,
              canOpenInAIProcess: Boolean(feedReference.canOpenInAIProcess),
            };
          });
          return;
        }

        const referenceResponse = await notesApi.searchReference(initialText, 1);
        let matches = referenceResponse.notes || [];
        let canOpenInCanvas = Boolean(referenceResponse.canOpenInCanvas);

        if (!matches.length) {
          if (!notesCacheRef.current || notesCacheRef.current.length === 0) {
            notesCacheRef.current = await loadAllReferenceNotes();
          }
          matches = findBestNoteMatches(notesCacheRef.current, initialText, 1);
          if (matches.length) canOpenInCanvas = true;
        }

        if (!matches.length && notesCacheRef.current && notesCacheRef.current.length > 0) {
          notesCacheRef.current = await loadAllReferenceNotes();
          matches = findBestNoteMatches(notesCacheRef.current, initialText, 1);
          if (matches.length) canOpenInCanvas = true;
        }

        setReferencePreview((current) => {
          if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
          return { ...current, loading: false, matches, canOpenInCanvas };
        });
      } catch (error: unknown) {
        setReferencePreview((current) => {
          if (!current || current.itemTitle !== item.title || current.refNumber !== refNumber) return current;
          return {
            ...current,
            loading: false,
            matches: [],
            error: error instanceof Error ? error.message : '引用笔记加载失败',
          };
        });
      }
    })();
  }, []);

  const handleOpenNote = useCallback(async (note: FeedNote) => {
    setReferencePreview(null);
    setViewMode('canvas');

    const workspaceStore = useWorkspaceStore.getState();
    if (workspaceStore.currentWorkspaceId !== note.workspaceId) {
      workspaceStore.setCurrentWorkspace(note.workspaceId);
      await workspaceStore.loadCanvases(note.workspaceId);
    }
    useWorkspaceStore.getState().setCurrentCanvas(note.canvasId);
    await useCanvasStore.getState().loadCanvas(note.canvasId);
    useCanvasStore.getState().selectNode(note.id);
  }, [setViewMode]);

  const listPanel = (
    <FeedListPanel
      items={items}
      total={total}
      isLoading={isLoading}
      selectedId={selectedId}
      scrollRef={scrollRef}
      onScroll={handleScroll}
      onSelect={handleSelect}
      onToggleStar={handleToggleStar}
      onDelete={handleDelete}
      onLoadMore={loadMore}
      className="h-full flex-1"
    />
  );

  const sidebar = isMobile ? (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <FeedFilters fill={false} compact className="shrink-0" />
      <FeedListPanel
        items={items}
        total={total}
        isLoading={isLoading}
        selectedId={selectedId}
        scrollRef={scrollRef}
        onScroll={handleScroll}
        onSelect={handleSelect}
        onToggleStar={handleToggleStar}
        onDelete={handleDelete}
        onLoadMore={loadMore}
        className="min-h-0 flex-1 border-t border-slate-200"
      />
    </div>
  ) : (
    <FeedFilters />
  );

  return (
    <ResponsiveLayout sidebar={sidebar} sidebarWidth={200} drawerTitle="信息流" mobileOpenerView="feed">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="h-0 min-h-0 flex-1 overflow-hidden bg-slate-100/70 p-2 max-md:h-full max-md:min-h-0 max-md:overflow-hidden max-md:p-0">
          <div className="flex h-full min-w-0 overflow-hidden rounded border border-slate-200 bg-white max-md:h-full max-md:min-h-0 max-md:rounded-none max-md:border-x-0">
            {!isMobile && (
              <aside className="flex w-[390px] shrink-0 flex-col border-r border-slate-200 bg-white max-[1050px]:w-[330px]">
                {listPanel}
              </aside>
            )}

            <FeedDetailPane
              item={selectedItem}
              onToggleStar={handleToggleStar}
              onDelete={handleDelete}
              onOpenReference={handleOpenReference}
            />
          </div>
        </div>
      </div>
      <ReferencePreviewModal
        preview={referencePreview}
        onClose={() => setReferencePreview(null)}
        onOpenNote={handleOpenNote}
      />
    </ResponsiveLayout>
  );
});
