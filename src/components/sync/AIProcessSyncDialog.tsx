import { memo, useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Loader2, Check, AlertCircle, FileAudio, RefreshCw, Sparkles,
  Download, FileText, Building2, Tag, Info, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { canvasSyncApi, syncApi } from '../../db/apiClient.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { PrimaryButton } from '../ui/index.ts';

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

type Confidence = 'high' | 'medium' | 'low';
type PlannedAction = 'append' | 'create_canvas' | 'create_workspace_canvas' | 'skip_duplicate' | 'manual_edit';

interface Classification {
  id: string;
  fileName: string;
  organization: string;
  folder: string;
  canvasName: string;
  ticker: string;
  noteType?: string;
  folderSource?: string;
  routingRule?: string;
  routingReason?: string;
  confidence?: Confidence;
  plannedAction?: PlannedAction;
  isDuplicateSource?: boolean;
  targetWorkspaceId?: string;
  targetCanvasId?: string;
  targetCanvasTitle?: string;
  warnings?: string[];
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
type MergeState = 'idle' | 'previewing' | 'executing' | 'done';

interface MergeResult {
  dryRun: boolean;
  moved: number;
  duplicates: number;
  deleted: number;
  backupPath?: string;
  log: string[];
}

const ACTION_LABELS: Record<PlannedAction, string> = {
  append: '追加节点',
  create_canvas: '新建画布',
  create_workspace_canvas: '新建文件夹+画布',
  skip_duplicate: '重复跳过',
  manual_edit: '手动目标',
};

const ACTION_STYLES: Record<PlannedAction, string> = {
  append: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  create_canvas: 'border-blue-200 bg-blue-50 text-blue-700',
  create_workspace_canvas: 'border-amber-200 bg-amber-50 text-amber-700',
  skip_duplicate: 'border-slate-200 bg-slate-100 text-slate-500',
  manual_edit: 'border-violet-200 bg-violet-50 text-violet-700',
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  medium: 'text-slate-600 bg-slate-50 border-slate-200',
  low: 'text-amber-700 bg-amber-50 border-amber-200',
};

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const AIProcessSyncDialog = memo(function AIProcessSyncDialog({ open, onClose }: AIProcessSyncDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [results, setResults] = useState<SyncResult[]>([]);
  const [error, setError] = useState('');
  const [syncedCount, setSyncedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [bulkFolder, setBulkFolder] = useState('');
  const [bulkCanvasName, setBulkCanvasName] = useState('');
  const [emptyMessage, setEmptyMessage] = useState('');

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
        setEmptyMessage('没有未同步的 AI Process 笔记。这里同步的是 AI Process notes/transcriptions，不是任务包配置本身。');
      } else {
        setEmptyMessage('');
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
      const data = await canvasSyncApi.classify(ids, getApiConfig().metadataFillModel);
      const nextClassifications = (data.classifications || []).map((c: Classification) => ({
        ...c,
        warnings: c.warnings || [],
        excluded: c.plannedAction === 'skip_duplicate',
      }));
      setClassifications(nextClassifications);
      setBulkFolder('');
      setBulkCanvasName('');
      if (nextClassifications.length === 0) {
        setEmptyMessage('没有生成同步计划。可能是所选笔记已同步、后端没有取到详情，或这些内容不是 AI Process notes/transcriptions。');
        setStep('done');
        return;
      }
      setEmptyMessage('');
      setStep('confirm');
    } catch (err: any) {
      setError(err?.message || '分类失败');
      setStep('error');
    }
  }, [selected]);

  // Execute sync
  const handleSync = useCallback(async () => {
    const items = classifications
      .filter(c => !c.excluded && c.folder.trim() && c.canvasName.trim())
      .map(c => ({
        transcriptionId: c.id,
        folder: c.folder.trim(),
        canvasName: c.canvasName.trim(),
        ticker: c.ticker.trim(),
      }));

    if (items.length === 0) return;

    setStep('syncing');
    setError('');
    try {
      const data = await canvasSyncApi.execute(items);
      setResults(data.results || []);
      setSyncedCount(data.synced || 0);
      setSkippedCount(data.skipped || 0);
      setEmptyMessage('');
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

  const updateClassification = useCallback((id: string, patch: Partial<Pick<Classification, 'folder' | 'canvasName' | 'ticker'>>) => {
    setClassifications(prev => prev.map(c => {
      if (c.id !== id) return c;
      const warnings = new Set(c.warnings || []);
      warnings.add('已手动修改目标，创建/复用状态会在执行时按确认值重新判断');
      return {
        ...c,
        ...patch,
        plannedAction: 'manual_edit',
        confidence: 'low',
        warnings: Array.from(warnings),
      };
    }));
  }, []);

  const applyBulkTarget = useCallback((field: 'folder' | 'canvasName') => {
    const value = (field === 'folder' ? bulkFolder : bulkCanvasName).trim();
    if (!value) return;
    setClassifications(prev => prev.map(c => {
      if (c.excluded) return c;
      const warnings = new Set(c.warnings || []);
      warnings.add('已批量修改目标，创建/复用状态会在执行时按确认值重新判断');
      return {
        ...c,
        [field]: value,
        plannedAction: 'manual_edit' as PlannedAction,
        confidence: 'low' as Confidence,
        warnings: Array.from(warnings),
      };
    }));
  }, [bulkCanvasName, bulkFolder]);

  const handleDownloadPlan = useCallback(() => {
    const active = classifications.filter(c => !c.excluded);
    downloadJson(`ai-process-canvas-dry-run-${new Date().toISOString().slice(0, 10)}.json`, {
      generatedAt: new Date().toISOString(),
      total: classifications.length,
      active: active.length,
      excluded: classifications.length - active.length,
      plan: classifications,
    });
  }, [classifications]);

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
      setBulkFolder('');
      setBulkCanvasName('');
      setEmptyMessage('');
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
    setBulkFolder('');
    setBulkCanvasName('');
    setEmptyMessage('');
    loadUnsynced();
  }, [loadUnsynced]);

  if (!open) return null;

  const activeClassifications = classifications.filter(c => !c.excluded);
  const syncableClassifications = activeClassifications.filter(c => c.folder.trim() && c.canvasName.trim());
  const invalidTargetCount = activeClassifications.length - syncableClassifications.length;
  const newWorkspaces = new Set(activeClassifications.filter(c => c.isNewWorkspace).map(c => c.folder)).size;
  const newCanvases = new Set(activeClassifications.filter(c => c.isNewCanvas).map(c => `${c.folder}::${c.canvasName}`)).size;
  const duplicateCount = classifications.filter(c => c.plannedAction === 'skip_duplicate').length;
  const lowConfidenceCount = activeClassifications.filter(c => c.confidence === 'low').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-lg shadow-2xl w-[1080px] max-w-[calc(100vw-32px)] max-h-[88vh] flex flex-col overflow-hidden">
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
                    className={`flex items-start gap-3 p-2.5 rounded border cursor-pointer transition-colors ${
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
                      <div className="text-sm font-medium text-slate-800 truncate" title={t.fileName}>{t.topic || t.fileName}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-500">
                        {t.organization && <span>公司 {t.organization}</span>}
                        {t.industry && <span>行业 {t.industry}</span>}
                        {t.participants && <span>类型 {t.participants}</span>}
                        {t.eventDate && <span>日期 {t.eventDate}</span>}
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
              <span className="text-sm">正在生成 dry-run 同步计划...</span>
              <span className="text-xs text-slate-400 mt-1">正在分析 {selected.size} 条笔记，不会写入 Canvas</span>
            </div>
          )}

          {/* Step: Confirm classifications */}
          {step === 'confirm' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-700">同步预览</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    先预览，不写入 Canvas；上市公司进公司画布，非上市/无 ticker 的 expert/sellside/buyside 进入行业研究。
                  </div>
                </div>
                <button
                  onClick={handleDownloadPlan}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <Download size={12} />
                  下载计划
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-400">待执行</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-800">{syncableClassifications.length}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-400">新文件夹</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-800">{newWorkspaces}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-400">新画布</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-800">{newCanvases}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-400">低置信</div>
                  <div className={`mt-0.5 text-sm font-semibold ${lowConfidenceCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{lowConfidenceCount}</div>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-400">重复</div>
                  <div className="mt-0.5 text-sm font-semibold text-slate-800">{duplicateCount}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                <div className="min-w-[180px] flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-slate-500">批量设置文件夹</label>
                  <input
                    value={bulkFolder}
                    onChange={(e) => setBulkFolder(e.target.value)}
                    placeholder="例如 航空航天"
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={() => applyBulkTarget('folder')}
                  disabled={!bulkFolder.trim()}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  应用到待执行
                </button>
                <div className="min-w-[220px] flex-1">
                  <label className="mb-1 block text-[11px] font-medium text-slate-500">批量设置画布</label>
                  <input
                    value={bulkCanvasName}
                    onChange={(e) => setBulkCanvasName(e.target.value)}
                    placeholder="例如 [BA US] The Boeing Company"
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                  />
                </div>
                <button
                  onClick={() => applyBulkTarget('canvasName')}
                  disabled={!bulkCanvasName.trim()}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  应用到待执行
                </button>
              </div>

              {invalidTargetCount > 0 && (
                <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={13} />
                  有 {invalidTargetCount} 条缺少文件夹或画布，补齐后才能同步。
                </div>
              )}

              <div className="max-h-[48vh] overflow-y-auto rounded border border-slate-200">
                <table className="w-full table-fixed text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="w-8 px-2 py-2 text-left font-medium"></th>
                      <th className="w-[250px] px-2 py-2 text-left font-medium">笔记</th>
                      <th className="w-[160px] px-2 py-2 text-left font-medium">类型/公司</th>
                      <th className="w-[300px] px-2 py-2 text-left font-medium">目标</th>
                      <th className="w-[150px] px-2 py-2 text-left font-medium">动作</th>
                      <th className="px-2 py-2 text-left font-medium">规则和风险</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classifications.map(c => {
                      const tx = transcriptions.find(tt => tt.id === c.id);
                      const display = tx?.topic || c.fileName;
                      const action = c.plannedAction || 'append';
                      const confidence = c.confidence || 'medium';
                      return (
                        <tr key={c.id} className={`border-t border-slate-100 align-top ${c.excluded ? 'bg-slate-50/70 opacity-60' : 'bg-white'}`}>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={!c.excluded}
                              onChange={() => toggleExclude(c.id)}
                              className="rounded border-slate-300"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex min-w-0 items-start gap-1.5">
                              <FileText size={13} className="mt-0.5 shrink-0 text-slate-400" />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-slate-800" title={c.fileName}>{display}</div>
                                <div className="mt-0.5 truncate text-[11px] text-slate-400" title={c.fileName}>{c.fileName}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-slate-600">
                            <div className="flex items-center gap-1">
                              <Tag size={12} className="text-slate-400" />
                              <span className="truncate">{c.noteType || 'unknown'}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              <Building2 size={12} className="text-slate-400" />
                              <span className="truncate" title={c.organization}>{c.organization || '-'}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="grid grid-cols-[1fr,16px,1fr] items-center gap-1">
                              <input
                                value={c.folder}
                                onChange={(e) => updateClassification(c.id, { folder: e.target.value })}
                                className="min-w-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                                title="目标文件夹"
                              />
                              <ArrowRight size={12} className="text-slate-300" />
                              <input
                                value={c.canvasName}
                                onChange={(e) => updateClassification(c.id, { canvasName: e.target.value })}
                                className="min-w-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                                title="目标画布"
                              />
                            </div>
                            {c.ticker && (
                              <input
                                value={c.ticker}
                                onChange={(e) => updateClassification(c.id, { ticker: e.target.value })}
                                className="mt-1 w-full rounded border border-slate-100 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 outline-none focus:border-blue-300"
                                title="Ticker"
                              />
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${ACTION_STYLES[action]}`}>
                              {ACTION_LABELS[action]}
                            </span>
                            <span className={`ml-1 inline-flex rounded border px-1.5 py-0.5 text-[11px] ${CONFIDENCE_STYLES[confidence]}`}>
                              置信 {CONFIDENCE_LABELS[confidence]}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-start gap-1.5 text-slate-500">
                              <Info size={12} className="mt-0.5 shrink-0 text-slate-400" />
                              <span className="line-clamp-2" title={c.routingReason}>{c.routingReason || c.routingRule || '规则缺失'}</span>
                            </div>
                            {(c.warnings || []).length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {(c.warnings || []).map((warning) => (
                                  <div key={warning} className="flex items-start gap-1 text-amber-700">
                                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                    <span>{warning}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                  <Check size={28} className="text-emerald-500 mb-3" />
                  <span className="text-sm font-medium text-slate-800 mb-1">
                    同步完成
                  </span>
                  <span className="text-xs text-slate-500 mb-4">
                    已同步 {syncedCount} 条{skippedCount > 0 ? `，跳过 ${skippedCount} 条（重复）` : ''}
                  </span>

                  {/* Results list */}
                  {results.length > 0 && (
                    <div className="w-full max-h-[40vh] overflow-y-auto border border-slate-200 rounded">
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
                              <td className="px-3 py-1.5 truncate max-w-[180px]" title={r.fileName}>{transcriptions.find(tt => tt.id === r.id)?.topic || r.fileName}</td>
                              <td className="px-3 py-1.5 text-slate-600">{r.folder}</td>
                              <td className="px-3 py-1.5 text-slate-600">{r.canvas}</td>
                              <td className="px-3 py-1.5">
                                {r.status === 'synced' ? (
                                  <span className="text-emerald-600">✓ 已同步</span>
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
                  <span className="text-sm text-slate-500">{emptyMessage || '没有未同步的笔记'}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Legacy source canvas merge utility */}
        <ExistingNotesMergeSection disabled={step === 'classifying' || step === 'syncing'} />

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          <div className="text-xs text-slate-400">
            {step === 'select' && `${transcriptions.length} 条未同步`}
            {step === 'confirm' && `${syncableClassifications.length} 条可执行，${classifications.length - activeClassifications.length} 条排除`}
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
              <PrimaryButton
                onClick={handleClassify}
                disabled={selected.size === 0}
                icon={<Sparkles size={12} />}
              >
                开始分类 ({selected.size})
              </PrimaryButton>
            )}
            {step === 'confirm' && (
              <button
                onClick={handleSync}
                disabled={syncableClassifications.length === 0 || invalidTargetCount > 0}
                className="px-4 py-1.5 text-xs rounded bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Check size={12} />
                按计划同步 ({syncableClassifications.length})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/** 合并存量笔记：把 Expert/Sellside 画布里的笔记移到公司画布或行业研究 */
function ExistingNotesMergeSection({ disabled }: { disabled?: boolean }) {
  const [state, setState] = useState<MergeState>('idle');
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState('');
  const refreshWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);

  const handleMerge = useCallback(async (dryRun: boolean) => {
    setState(dryRun ? 'previewing' : 'executing');
    setError('');
    try {
      const res = await syncApi.reclassifyNotes(dryRun);
      setResult({
        dryRun: res.dryRun,
        moved: res.moved || 0,
        duplicates: res.duplicates || 0,
        deleted: res.deleted || 0,
        backupPath: res.backupPath,
        log: res.log || [],
      });
      setState('done');
      if (!dryRun && ((res.moved || 0) > 0 || (res.deleted || 0) > 0)) {
        void refreshWorkspaces();
      }
    } catch (err: any) {
      setError(err?.message || '合并失败');
      setState('idle');
    }
  }, [refreshWorkspaces]);

  const busy = state === 'previewing' || state === 'executing';
  const canApply = result?.dryRun && result.moved > 0;

  return (
    <div className="border-t border-slate-200 bg-white px-5 py-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[260px]">
            <div className="text-xs font-medium text-slate-700">合并存量笔记</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              将旧的 Expert/Sellside 画布内容合并到公司画布或行业研究。先 Dry-run，不会写入。
            </div>
          </div>
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 size={13} className="animate-spin text-blue-500" />
              {state === 'previewing' ? '正在生成预览...' : '正在执行合并...'}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleMerge(true)}
                disabled={disabled}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Dry-run 预览
              </button>
              {canApply && (
                <button
                  onClick={() => handleMerge(false)}
                  disabled={disabled}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  确认合并 ({result.moved})
                </button>
              )}
            </div>
          )}
        </div>

        {error && <div className="mt-2 text-xs text-red-500">{error}</div>}

        {result && (
          <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{result.dryRun ? '预览' : '已执行'}：{result.moved} 条待合并</span>
              <span>重复：{result.duplicates}</span>
              <span>删除空画布：{result.deleted}</span>
              {result.backupPath && <span className="truncate">备份：{result.backupPath}</span>}
            </div>
            {result.log.length > 0 && (
              <div className="mt-1 max-h-24 overflow-y-auto rounded bg-white p-2 text-[11px] text-slate-500">
                {result.log.slice(0, 12).map((line, index) => (
                  <div key={`${index}-${line}`} className="truncate" title={line}>{line}</div>
                ))}
                {result.log.length > 12 && <div className="text-slate-400">... 还有 {result.log.length - 12} 行</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
