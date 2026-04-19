import { memo, useEffect, useState, useCallback } from 'react';
import { X, Download, Trash2, RefreshCw, AlertTriangle, Bug } from 'lucide-react';
import { getCardLogs, clearCardLogs, exportCardLogs, type CardLogEntry, type CardEventType } from '../../stores/aiCardLogger.ts';

interface AICardLogViewerProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<CardEventType, string> = {
  card_create: '创建',
  card_update: '修改',
  card_remove: '删除',
  card_remove_all: '清空',
  generate_start: '生成开始',
  generate_chunk: '流式追加',
  generate_end: '生成结束',
  generate_abort: '中止生成',
  generate_error: '生成错误',
  push_start: '推送开始',
  push_success: '推送成功',
  push_failure: '推送失败',
  push_skipped_unchanged: '跳过推送',
  sync_start: '同步开始',
  sync_cloud_empty_pushed_local: '云端空→推本地',
  sync_merge_result: '同步完成',
  sync_error: '同步失败',
  hydrate_from_idb: '恢复 IDB',
  card_vanish_detected: '⚠️ 卡片消失',
  card_ressurected: '卡片恢复',
  manual_note: '手动标记',
};

const TYPE_COLORS: Partial<Record<CardEventType, string>> = {
  card_vanish_detected: 'bg-red-100 text-red-700 border-red-300',
  generate_error: 'bg-red-50 text-red-600 border-red-200',
  push_failure: 'bg-red-50 text-red-600 border-red-200',
  sync_error: 'bg-red-50 text-red-600 border-red-200',
  card_create: 'bg-green-50 text-green-700 border-green-200',
  card_remove: 'bg-amber-50 text-amber-700 border-amber-200',
  generate_end: 'bg-blue-50 text-blue-700 border-blue-200',
  push_success: 'bg-slate-50 text-slate-500 border-slate-200',
  generate_chunk: 'bg-slate-50 text-slate-400 border-slate-200',
  push_skipped_unchanged: 'bg-slate-50 text-slate-400 border-slate-200',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const AICardLogViewer = memo(function AICardLogViewer({ open, onClose }: AICardLogViewerProps) {
  const [logs, setLogs] = useState<CardLogEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [hideChunks, setHideChunks] = useState(true);

  const refresh = useCallback(async () => {
    const all = await getCardLogs();
    setLogs(all.slice().reverse()); // 最新在前
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleExport = useCallback(async () => {
    const json = await exportCardLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-card-logs-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleCopy = useCallback(async () => {
    const json = await exportCardLogs();
    try {
      await navigator.clipboard.writeText(json);
      alert('日志已复制到剪贴板');
    } catch {
      alert('复制失败');
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (!confirm('确认清空所有日志？')) return;
    await clearCardLogs();
    refresh();
  }, [refresh]);

  if (!open) return null;

  const filtered = logs.filter(l => {
    if (hideChunks && l.type === 'generate_chunk') return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      l.type.toLowerCase().includes(q) ||
      (l.cardTitle || '').toLowerCase().includes(q) ||
      (l.cardId || '').toLowerCase().includes(q) ||
      (l.summary || '').toLowerCase().includes(q)
    );
  });

  const vanishCount = logs.filter(l => l.type === 'card_vanish_detected').length;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
          <Bug size={18} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">AI 卡片调试日志</h2>
          <span className="text-xs text-slate-400">{filtered.length} / {logs.length} 条</span>
          {vanishCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
              <AlertTriangle size={12} />
              检测到 {vanishCount} 次卡片消失
            </span>
          )}
          <div className="flex-1" />
          <button onClick={refresh} title="刷新" className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
            <RefreshCw size={14} />
          </button>
          <button onClick={handleCopy} className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
            复制 JSON
          </button>
          <button onClick={handleExport} className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1">
            <Download size={12} /> 导出
          </button>
          <button onClick={handleClear} className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 flex items-center gap-1">
            <Trash2 size={12} /> 清空
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-5 py-2 border-b border-slate-100 shrink-0">
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="按类型 / 标题 / id / 摘要筛选"
            className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={hideChunks}
              onChange={e => setHideChunks(e.target.checked)}
              className="rounded border-slate-300"
            />
            隐藏流式追加日志
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filtered.length === 0 && (
            <div className="text-center text-slate-400 py-10 text-sm">暂无日志</div>
          )}
          {filtered.map((log, i) => {
            const color = TYPE_COLORS[log.type] || 'bg-slate-50 text-slate-600 border-slate-200';
            return (
              <div
                key={`${log.t}-${i}`}
                className={`text-xs border rounded px-3 py-2 ${color}`}
              >
                <div className="flex items-start gap-3">
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    {formatTime(log.t)}
                  </span>
                  <span className="font-semibold shrink-0 min-w-[80px]">
                    {TYPE_LABELS[log.type] || log.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    {log.summary && <div className="leading-snug">{log.summary}</div>}
                    {(log.cardId || log.cardTitle) && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {log.cardTitle && <span className="mr-2">标题：{log.cardTitle}</span>}
                        {log.cardId && <span className="font-mono">id: {log.cardId}</span>}
                      </div>
                    )}
                    {log.detail && (
                      <details className="mt-1">
                        <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-slate-600">展开详情</summary>
                        <pre className="mt-1 text-[10px] bg-white/60 border border-slate-200 rounded p-2 overflow-auto max-h-40">
                          {JSON.stringify(log.detail, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-2 border-t border-slate-100 text-[11px] text-slate-400 shrink-0">
          日志保存在浏览器 IndexedDB，最多保留 2000 条。控制台可用：window.__aiCardLogger.get() / export() / clear()
        </div>
      </div>
    </div>
  );
});
