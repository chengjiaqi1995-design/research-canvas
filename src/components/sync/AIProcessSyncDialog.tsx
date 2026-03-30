import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { X, Loader2, Check, AlertCircle, FileAudio, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import { canvasSyncApi } from '../../db/apiClient.ts';

interface AIProcessSyncDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Transcription {
  id: string;
  fileName: string;
  organization: string | null;
  industry: string | null;
  topic: string | null;
  country: string | null;
  participants: string | null;
  eventDate: string | null;
  createdAt: string;
}

interface Classification {
  id: string;
  fileName: string;
  organization: string;
  folder: string;
  canvasName: string;
  ticker: string;
  isNewWorkspace: boolean;
  isNewCanvas: boolean;
  excluded?: boolean; // user can exclude items
}

interface SyncResult {
  id: string;
  fileName: string;
  folder: string;
  canvas: string;
  status: string;
}

type Step = 'loading' | 'select' | 'classifying' | 'confirm' | 'syncing' | 'done' | 'error';

export const AIProcessSyncDialog = memo(function AIProcessSyncDialog({ open, onClose }: AIProcessSyncDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [results, setResults] = useState<SyncResult[]>([]);
  const [error, setError] = useState('');
  const [syncedCount, setSyncedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  // Load unsynced transcriptions when dialog opens
  const loadUnsynced = useCallback(async () => {
    setStep('loading');
    setError('');
    try {
      const data = await canvasSyncApi.fetchUnsynced();
      const items = data.data?.items || [];
      setTranscriptions(items);
      setSelected(new Set(items.map((t: Transcription) => t.id)));
      setStep(items.length > 0 ? 'select' : 'done');
      if (items.length === 0) {
        setSyncedCount(0);
        setSkippedCount(0);
      }
    } catch (err: any) {
      setError(err?.message || '加载失败');
      setStep('error');
    }
  }, []);

  // Start classification
  const handleClassify = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    setStep('classifying');
    setError('');
    try {
      const data = await canvasSyncApi.classify(ids);
      setClassifications((data.classifications || []).map(c => ({ ...c, excluded: false })));
      setStep('confirm');
    } catch (err: any) {
      setError(err?.message || '分类失败');
      setStep('error');
    }
  }, [selected]);

  // Execute sync
  const handleSync = useCallback(async () => {
    const items = classifications
      .filter(c => !c.excluded)
      .map(c => ({
        transcriptionId: c.id,
        folder: c.folder,
        canvasName: c.canvasName,
        ticker: c.ticker,
      }));

    if (items.length === 0) return;

    setStep('syncing');
    setError('');
    try {
      const data = await canvasSyncApi.execute(items);
      setResults(data.results || []);
      setSyncedCount(data.synced || 0);
      setSkippedCount(data.skipped || 0);
      setStep('done');
    } catch (err: any) {
      setError(err?.message || '同步失败');
      setStep('error');
    }
  }, [classifications]);

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === transcriptions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transcriptions.map(t => t.id)));
    }
  };

  // Toggle exclude in confirm step
  const toggleExclude = (id: string) => {
    setClassifications(prev => prev.map(c =>
      c.id === id ? { ...c, excluded: !c.excluded } : c
    ));
  };

  // Reset and load when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setStep('loading');
      setTranscriptions([]);
      setSelected(new Set());
      setClassifications([]);
      setResults([]);
      setError('');
      setSyncedCount(0);
      setSkippedCount(0);
      loadUnsynced();
    }
    prevOpenRef.current = open;
  }, [open, loadUnsynced]);

  const handleReload = useCallback(() => {
    setStep('loading');
    setTranscriptions([]);
    setSelected(new Set());
    setClassifications([]);
    setResults([]);
    setError('');
    setSyncedCount(0);
    setSkippedCount(0);
    loadUnsynced();
  }, [loadUnsynced]);

  if (!open) return null;

  const activeClassifications = classifications.filter(c => !c.excluded);
  const newWorkspaces = new Set(activeClassifications.filter(c => c.isNewWorkspace).map(c => c.folder)).size;
  const newCanvases = new Set(activeClassifications.filter(c => c.isNewCanvas).map(c => `${c.folder}::${c.canvasName}`)).size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileAudio size={18} className="text-blue-500" />
            <h2 className="text-base font-semibold text-slate-800">从 AI Process 同步到 Canvas</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Loading */}
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={24} className="animate-spin mb-3" />
              <span className="text-sm">正在加载未同步的转录笔记...</span>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertCircle size={24} className="text-red-400 mb-3" />
              <span className="text-sm text-red-600 mb-4">{error}</span>
              <button
                onClick={handleReload}
                className="px-4 py-1.5 text-sm bg-slate-100 rounded hover:bg-slate-200"
              >
                重试
              </button>
            </div>
          )}

          {/* Step: Select transcriptions */}
          {step === 'select' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-600">
                  找到 <b>{transcriptions.length}</b> 条未同步的笔记，已选 <b>{selected.size}</b> 条
                </span>
                <button
                  onClick={toggleAll}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  {selected.size === transcriptions.length ? '取消全选' : '全选'}
                </button>
              </div>
              <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                {transcriptions.map(t => (
                  <label
                    key={t.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selected.has(t.id) ? 'border-blue-200 bg-blue-50/50' : 'border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{t.fileName}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
                        {t.organization && <span>🏢 {t.organization}</span>}
                        {t.industry && <span>📂 {t.industry}</span>}
                        {t.topic && <span>📌 {t.topic}</span>}
                        {t.eventDate && <span>📅 {t.eventDate}</span>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step: Classifying */}
          {step === 'classifying' && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={24} className="animate-spin mb-3" />
              <span className="text-sm">AI 正在分类笔记到行业文件夹...</span>
              <span className="text-xs text-slate-400 mt-1">正在分析 {selected.size} 条笔记</span>
            </div>
          )}

          {/* Step: Confirm classifications */}
          {step === 'confirm' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-600">
                  分类结果预览 — 请确认后同步
                </span>
                <span className="text-xs text-slate-400">
                  {activeClassifications.length} 条待同步
                </span>
              </div>

              {/* Classification table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="text-left px-3 py-2 font-medium w-8"></th>
                      <th className="text-left px-3 py-2 font-medium">笔记</th>
                      <th className="text-left px-3 py-2 font-medium">公司</th>
                      <th className="text-left px-3 py-2 font-medium">→ 行业文件夹</th>
                      <th className="text-left px-3 py-2 font-medium">→ 画布</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classifications.map(c => (
                      <tr
                        key={c.id}
                        className={`border-t border-slate-100 ${c.excluded ? 'opacity-40' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!c.excluded}
                            onChange={() => toggleExclude(c.id)}
                            className="rounded border-slate-300"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="truncate max-w-[160px]" title={c.fileName}>{c.fileName}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <div className="truncate max-w-[100px]">{c.organization || '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 ${c.isNewWorkspace ? 'text-amber-600' : 'text-slate-700'}`}>
                            <FolderOpen size={12} />
                            {c.folder === '_unmatched' ? '未分类' : c.folder === '_overall' ? '宏观' : c.folder === '_personal' ? '个人' : c.folder}
                            {c.isNewWorkspace && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">新</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`${c.isNewCanvas ? 'text-blue-600' : 'text-slate-700'}`}>
                            {c.canvasName}
                            {c.isNewCanvas && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1 rounded">新</span>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              {(newWorkspaces > 0 || newCanvases > 0) && (
                <div className="mt-3 px-3 py-2 bg-amber-50 rounded-lg text-xs text-amber-700">
                  将创建{newWorkspaces > 0 ? ` ${newWorkspaces} 个新文件夹` : ''}{newWorkspaces > 0 && newCanvases > 0 ? '、' : ''}{newCanvases > 0 ? ` ${newCanvases} 个新画布` : ''}
                </div>
              )}
            </div>
          )}

          {/* Step: Syncing */}
          {step === 'syncing' && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Loader2 size={24} className="animate-spin mb-3" />
              <span className="text-sm">正在同步到 Canvas...</span>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-8">
              {syncedCount > 0 || results.length > 0 ? (
                <>
                  <Check size={28} className="text-green-500 mb-3" />
                  <span className="text-sm font-medium text-slate-800 mb-1">
                    同步完成
                  </span>
                  <span className="text-xs text-slate-500 mb-4">
                    已同步 {syncedCount} 条{skippedCount > 0 ? `，跳过 ${skippedCount} 条（重复）` : ''}
                  </span>

                  {/* Results list */}
                  {results.length > 0 && (
                    <div className="w-full max-h-[40vh] overflow-y-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 sticky top-0">
                            <th className="text-left px-3 py-2 font-medium">笔记</th>
                            <th className="text-left px-3 py-2 font-medium">文件夹</th>
                            <th className="text-left px-3 py-2 font-medium">画布</th>
                            <th className="text-left px-3 py-2 font-medium">状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.map(r => (
                            <tr key={r.id} className="border-t border-slate-100">
                              <td className="px-3 py-1.5 truncate max-w-[180px]">{r.fileName}</td>
                              <td className="px-3 py-1.5 text-slate-600">{r.folder}</td>
                              <td className="px-3 py-1.5 text-slate-600">{r.canvas}</td>
                              <td className="px-3 py-1.5">
                                {r.status === 'synced' ? (
                                  <span className="text-green-600">✓ 已同步</span>
                                ) : (
                                  <span className="text-slate-400">跳过</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {results.length === 0 && transcriptions.length === 0 && (
                    <span className="text-xs text-slate-400">所有笔记已同步，没有新的待同步内容</span>
                  )}
                </>
              ) : (
                <>
                  <Check size={28} className="text-slate-400 mb-3" />
                  <span className="text-sm text-slate-500">没有未同步的笔记</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-400">
            {step === 'select' && `${transcriptions.length} 条未同步`}
            {step === 'confirm' && `${activeClassifications.length} 条将同步`}
          </div>
          <div className="flex items-center gap-2">
            {step === 'done' && (
              <button
                onClick={handleReload}
                className="px-3 py-1.5 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center gap-1"
              >
                <RefreshCw size={12} />
                重新加载
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              {step === 'done' ? '关闭' : '取消'}
            </button>
            {step === 'select' && (
              <button
                onClick={handleClassify}
                disabled={selected.size === 0}
                className="px-4 py-1.5 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Sparkles size={12} />
                开始分类 ({selected.size})
              </button>
            )}
            {step === 'confirm' && (
              <button
                onClick={handleSync}
                disabled={activeClassifications.length === 0}
                className="px-4 py-1.5 text-xs rounded bg-green-500 hover:bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Check size={12} />
                确认同步 ({activeClassifications.length})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
