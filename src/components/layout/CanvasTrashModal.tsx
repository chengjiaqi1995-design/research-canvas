import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { canvasTrashApi, type CanvasTrashItem } from '../../db/apiClient.ts';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface CanvasTrashModalProps {
  open: boolean;
  onClose: () => void;
}

function formatDeletedAt(value: number) {
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function CanvasTrashModal({ open, onClose }: CanvasTrashModalProps) {
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const [items, setItems] = useState<CanvasTrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await canvasTrashApi.list(100);
      setItems(res.items || []);
    } catch (err) {
      setError((err as Error).message || '加载回收站失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadItems();
  }, [open, loadItems]);

  const restoreItem = useCallback(async (item: CanvasTrashItem) => {
    setRestoringId(item.id);
    setError('');
    try {
      const restored = await canvasTrashApi.restore(item.id);
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (restored.canvasId === currentCanvasId) {
        await loadCanvas(restored.canvasId);
      }
      if (item.workspaceId === currentWorkspaceId) {
        await loadCanvases(item.workspaceId);
      }
    } catch (err) {
      setError((err as Error).message || '恢复失败');
    } finally {
      setRestoringId(null);
    }
  }, [currentCanvasId, currentWorkspaceId, loadCanvas, loadCanvases]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 px-4">
      <div className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Trash2 size={15} className="text-slate-400" />
          <div>
            <div className="text-sm font-semibold text-slate-800">附件回收站</div>
            <div className="text-[11px] text-slate-400">删除的附件会先保存在这里，可恢复到原画布。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              加载中...
            </div>
          )}
          {!loading && error && (
            <div className="mb-2 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
          )}
          {!loading && items.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-400">回收站为空</div>
          )}
          {!loading && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => {
                const restoring = restoringId === item.id;
                return (
                  <div key={item.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-800">{item.nodeTitle || '未命名附件'}</div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-400">
                          <span>{formatDeletedAt(item.deletedAt)}</span>
                          <span>{item.workspaceName || item.workspaceId || '未知文件夹'}</span>
                          <span>{item.canvasTitle || item.canvasId || '未知画布'}</span>
                          <span>{item.nodeType}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => void restoreItem(item)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        {restoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        恢复
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
