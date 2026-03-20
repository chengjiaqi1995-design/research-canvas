import { memo, useState, useCallback, useMemo } from 'react';
import { X, RefreshCw, Check, AlertCircle, Loader2, Download, Globe, Building2, User } from 'lucide-react';
import { syncApi } from '../../db/apiClient.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import type { WorkspaceCategory } from '../../types/index.ts';

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
}

interface NotebookNote {
  _id: string;
  id?: string;
  fileName: string;
  summary?: string;
  translatedSummary?: string;
  tags?: string[];
  participants?: string;
  actualDate?: string;
  status?: string;
  type?: string;
  // metadata fields (can be nested or flat)
  metadata?: {
    topic?: string;
    organization?: string;
    intermediary?: string;
    industry?: string;
    country?: string;
    participants?: string;
    eventDate?: string;
    companies?: string[];
    industries?: string[];
    topics?: string[];
  };
  // flat metadata (some versions of the API)
  topic?: string;
  organization?: string;
  intermediary?: string;
  industry?: string;
  country?: string;
  eventDate?: string;
  createdAt: string;
  updatedAt: string;
}

interface SyncResult {
  foldersCreated: string[];
  notesImported: number;
  skipped: number;
  errors: string[];
}

interface CompanyGroup {
  company: string;
  notes: NotebookNote[];
  industries: string[];
  category: WorkspaceCategory;
  isExisting: boolean; // already exists as a folder
}

const CATEGORY_LABELS: Record<WorkspaceCategory, { label: string; color: string }> = {
  overall: { label: '整体', color: 'text-purple-600 bg-purple-50' },
  industry: { label: '行业', color: 'text-blue-600 bg-blue-50' },
  personal: { label: '个人', color: 'text-orange-600 bg-orange-50' },
};

// Extract company/org name from note (handles both flat and nested metadata)
function getCompany(note: NotebookNote): string | null {
  // Try nested metadata first
  if (note.metadata?.companies?.length) return note.metadata.companies[0];
  if (note.metadata?.organization) return note.metadata.organization;
  // Try flat fields
  if (note.organization) return note.organization;
  return null;
}

// Extract industries from note
function getIndustries(note: NotebookNote): string[] {
  const result: string[] = [];
  if (note.metadata?.industries?.length) result.push(...note.metadata.industries);
  if (note.metadata?.industry) result.push(note.metadata.industry);
  if (note.industry) result.push(note.industry);
  return [...new Set(result)].filter(Boolean);
}

// Build a rich markdown content from all note fields
function buildNoteContent(note: NotebookNote): string {
  const parts: string[] = [];

  // Header metadata table
  const meta: string[] = [];
  const topic = note.metadata?.topic || note.topic;
  const org = getCompany(note);
  const industries = getIndustries(note);
  const country = note.metadata?.country || note.country;
  const participants = note.metadata?.participants || note.participants;
  const intermediary = note.metadata?.intermediary || note.intermediary;
  const eventDate = note.metadata?.eventDate || note.eventDate || note.actualDate;

  if (topic) meta.push(`**主题**: ${topic}`);
  if (org) meta.push(`**公司**: ${org}`);
  if (industries.length) meta.push(`**行业**: ${industries.join(', ')}`);
  if (country) meta.push(`**国家**: ${country}`);
  if (participants) meta.push(`**参与人**: ${participants}`);
  if (intermediary) meta.push(`**中介**: ${intermediary}`);
  if (eventDate) meta.push(`**日期**: ${eventDate}`);
  if (note.tags?.length) meta.push(`**标签**: ${note.tags.join(', ')}`);

  if (meta.length > 0) {
    parts.push(meta.join(' | '));
    parts.push('---');
  }

  // Main summary content
  if (note.translatedSummary) {
    parts.push(note.translatedSummary);
  }
  if (note.summary) {
    if (note.translatedSummary) {
      parts.push('\n---\n**English Summary:**\n');
    }
    parts.push(note.summary);
  }

  return parts.join('\n\n') || '(无内容)';
}

// Auto-guess category from industry keywords
function guessCategory(industries: string[]): WorkspaceCategory {
  const personalKeywords = ['personal', '个人', '生活'];
  const overallKeywords = ['macro', '宏观', '策略', '市场', '研究框架', 'framework', 'etf', '指数'];

  for (const ind of industries) {
    const lower = ind.toLowerCase();
    if (personalKeywords.some(k => lower.includes(k))) return 'personal';
    if (overallKeywords.some(k => lower.includes(k))) return 'overall';
  }
  return 'industry';
}

export const SyncDialog = memo(function SyncDialog({ open, onClose }: SyncDialogProps) {
  const [token, setToken] = useState(() => localStorage.getItem('rc_notebook_token') || '');
  const [step, setStep] = useState<'token' | 'preview' | 'confirm' | 'syncing' | 'done'>('token');
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [companyGroups, setCompanyGroups] = useState<CompanyGroup[]>([]);
  const [unclassifiedNotes, setUnclassifiedNotes] = useState<NotebookNote[]>([]);
  const [unclassifiedCategory, setUnclassifiedCategory] = useState<WorkspaceCategory>('overall');

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const updateWorkspaceCategory = useWorkspaceStore((s) => s.updateWorkspaceCategory);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);

  // Stats
  const newFoldersCount = useMemo(
    () => companyGroups.filter(g => !g.isExisting).length + (unclassifiedNotes.length > 0 ? 1 : 0),
    [companyGroups, unclassifiedNotes]
  );

  // Step 1: Fetch notes from ai-notebook
  const handleFetchNotes = useCallback(async () => {
    if (!token.trim()) {
      setError('请输入 AI Notebook 的 token');
      return;
    }
    setLoading(true);
    setError('');
    try {
      localStorage.setItem('rc_notebook_token', token);
      const data = await syncApi.fetchNotes(token);
      const notesList = data.transcriptions || data.data || data || [];
      if (!Array.isArray(notesList) || notesList.length === 0) {
        setError('AI Notebook 中没有找到笔记');
        setLoading(false);
        return;
      }
      setNotes(notesList);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to fetch notes');
    }
    setLoading(false);
  }, [token]);

  // Step 2: Build company groups for confirmation
  const handleBuildGroups = useCallback(async () => {
    await loadWorkspaces();
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    const existingNamesLower = new Set(currentWorkspaces.map(w => w.name.toLowerCase()));

    const groupMap = new Map<string, { notes: NotebookNote[]; industries: Set<string> }>();
    const unclassified: NotebookNote[] = [];

    for (const note of notes) {
      const company = getCompany(note);
      if (company) {
        if (!groupMap.has(company)) {
          groupMap.set(company, { notes: [], industries: new Set() });
        }
        const g = groupMap.get(company)!;
        g.notes.push(note);
        getIndustries(note).forEach(ind => g.industries.add(ind));
      } else {
        unclassified.push(note);
      }
    }

    const groups: CompanyGroup[] = Array.from(groupMap.entries()).map(([company, data]) => {
      const industries = Array.from(data.industries);
      return {
        company,
        notes: data.notes,
        industries,
        category: guessCategory(industries),
        isExisting: existingNamesLower.has(company.toLowerCase()),
      };
    });

    // Sort: new folders first, then existing
    groups.sort((a, b) => {
      if (a.isExisting !== b.isExisting) return a.isExisting ? 1 : -1;
      return a.company.localeCompare(b.company, 'zh');
    });

    setCompanyGroups(groups);
    setUnclassifiedNotes(unclassified);
    setStep('confirm');
  }, [notes, loadWorkspaces]);

  // Update a company's category
  const handleCategoryChange = useCallback((company: string, category: WorkspaceCategory) => {
    setCompanyGroups(prev =>
      prev.map(g => g.company === company ? { ...g, category } : g)
    );
  }, []);

  // Step 3: Execute sync with confirmed categories
  const handleSync = useCallback(async () => {
    setStep('syncing');
    setError('');

    const syncResult: SyncResult = {
      foldersCreated: [],
      notesImported: 0,
      skipped: 0,
      errors: [],
    };

    await loadWorkspaces();
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    const existingNames = new Map(currentWorkspaces.map(w => [w.name.toLowerCase(), w]));

    const totalSteps = companyGroups.length + (unclassifiedNotes.length > 0 ? 1 : 0);
    setProgress({ current: 0, total: totalSteps });
    let stepCount = 0;

    // Process each company group
    for (const group of companyGroups) {
      stepCount++;
      setProgress({ current: stepCount, total: totalSteps });

      try {
        let workspace = existingNames.get(group.company.toLowerCase())
          || currentWorkspaces.find(w => w.name === group.company);

        if (!workspace) {
          workspace = await createWorkspace(group.company, '📁');
          await updateWorkspaceCategory(workspace.id, group.category);
          syncResult.foldersCreated.push(group.company);
          existingNames.set(group.company.toLowerCase(), workspace);
        }

        for (const note of group.notes) {
          const content = buildNoteContent(note);
          if (content === '(无内容)') { syncResult.skipped++; continue; }

          const canvasTitle = note.fileName || `Note ${(note._id || note.id || '').slice(-6)}`;
          const canvas = await createCanvas(workspace.id, canvasTitle);

          const { canvasApi } = await import('../../db/apiClient.ts');
          await canvasApi.update(canvas.id, {
            nodes: [{
              id: `node-${Date.now()}`,
              type: 'markdown',
              position: { x: 50, y: 50 },
              size: { width: 600, height: 400 },
              data: { type: 'markdown', title: canvasTitle, content },
              isMain: true,
            }],
          });
          syncResult.notesImported++;
        }
      } catch (err: any) {
        syncResult.errors.push(`${group.company}: ${err.message}`);
      }
    }

    // Process unclassified
    if (unclassifiedNotes.length > 0) {
      stepCount++;
      setProgress({ current: stepCount, total: totalSteps });

      try {
        let miscFolder = existingNames.get('未分类笔记');
        if (!miscFolder) {
          miscFolder = await createWorkspace('未分类笔记', '📁');
          await updateWorkspaceCategory(miscFolder.id, unclassifiedCategory);
          syncResult.foldersCreated.push('未分类笔记');
        }

        for (const note of unclassifiedNotes) {
          const summary = note.translatedSummary || note.summary;
          if (!summary) { syncResult.skipped++; continue; }

          const canvasTitle = note.fileName || `Note ${note._id.slice(-6)}`;
          const canvas = await createCanvas(miscFolder.id, canvasTitle);

          const { canvasApi } = await import('../../db/apiClient.ts');
          await canvasApi.update(canvas.id, {
            nodes: [{
              id: `node-${Date.now()}`,
              type: 'markdown',
              position: { x: 50, y: 50 },
              size: { width: 600, height: 400 },
              data: { type: 'markdown', title: canvasTitle, content: summary },
              isMain: true,
            }],
          });
          syncResult.notesImported++;
        }
      } catch (err: any) {
        syncResult.errors.push(`未分类: ${err.message}`);
      }
    }

    await loadWorkspaces();
    setResult(syncResult);
    setStep('done');
  }, [companyGroups, unclassifiedNotes, unclassifiedCategory, loadWorkspaces, createWorkspace, updateWorkspaceCategory, createCanvas]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">从 AI Notebook 同步</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Step 1: Token */}
          {step === 'token' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                从 AI Notebook 同步笔记摘要。自动根据公司名称创建文件夹并导入。
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">AI Notebook Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴 AI Notebook auth token..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleFetchNotes()}
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  在 AI Notebook 控制台运行：<code className="bg-slate-100 px-1 rounded">localStorage.getItem('auth_token')</code>
                </p>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                  <AlertCircle size={14} /> {error}
                </div>
              )}
              <button
                onClick={handleFetchNotes}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {loading ? '获取中...' : '获取笔记列表'}
              </button>
            </div>
          )}

          {/* Step 2: Preview notes */}
          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                找到 <strong>{notes.length}</strong> 条笔记。下一步确认文件夹分类。
              </p>
              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {notes.slice(0, 50).map((note) => {
                  const company = getCompany(note);
                  const industries = getIndustries(note);
                  const topic = note.metadata?.topic || note.topic;
                  return (
                    <div key={note._id || note.id} className="px-3 py-2">
                      <div className="text-xs font-medium text-slate-700 truncate">{note.fileName}</div>
                      <div className="text-[10px] text-slate-400 flex gap-2 mt-0.5 flex-wrap">
                        {company ? (
                          <span className="bg-blue-50 text-blue-600 px-1.5 rounded">{company}</span>
                        ) : (
                          <span className="bg-slate-100 text-slate-400 px-1.5 rounded">未分类</span>
                        )}
                        {industries.map((ind, i) => (
                          <span key={i} className="bg-green-50 text-green-600 px-1.5 rounded">{ind}</span>
                        ))}
                        {topic && <span className="bg-amber-50 text-amber-600 px-1.5 rounded truncate max-w-[120px]">{topic}</span>}
                        {note.tags?.slice(0, 2).map((tag, i) => (
                          <span key={i} className="bg-slate-100 text-slate-500 px-1.5 rounded">{tag}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {notes.length > 50 && (
                  <div className="px-3 py-2 text-xs text-slate-400 text-center">... 还有 {notes.length - 50} 条</div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep('token')} className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">
                  返回
                </button>
                <button
                  onClick={handleBuildGroups}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  下一步：确认分类
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm categories */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                以下是将要创建或更新的文件夹。请确认每个公司的分类，修改后点击「开始同步」。
              </p>

              <div className="flex gap-3 text-[10px] text-slate-400">
                <span>新建文件夹: <strong className="text-slate-700">{newFoldersCount}</strong></span>
                <span>总笔记: <strong className="text-slate-700">{notes.length}</strong></span>
              </div>

              {/* Company list with category selectors */}
              <div className="max-h-[45vh] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {companyGroups.map((group) => (
                  <div key={group.company} className={`px-3 py-2 flex items-center gap-2 ${group.isExisting ? 'bg-slate-50/50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-700 truncate">{group.company}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">({group.notes.length})</span>
                        {group.isExisting && (
                          <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 rounded shrink-0">已存在</span>
                        )}
                      </div>
                      {group.industries.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {group.industries.join(', ')}
                        </div>
                      )}
                    </div>

                    {/* Category selector */}
                    {!group.isExisting && (
                      <div className="flex gap-1 shrink-0">
                        {(['overall', 'industry', 'personal'] as WorkspaceCategory[]).map(cat => {
                          const cfg = CATEGORY_LABELS[cat];
                          const isActive = group.category === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() => handleCategoryChange(group.company, cat)}
                              className={`px-2 py-0.5 text-[10px] rounded-full border transition-all ${
                                isActive
                                  ? `${cfg.color} border-current font-medium`
                                  : 'text-slate-400 border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              {cfg.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                {/* Unclassified group */}
                {unclassifiedNotes.length > 0 && (
                  <div className="px-3 py-2 flex items-center gap-2 bg-yellow-50/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-700">未分类笔记</span>
                        <span className="text-[10px] text-slate-400">({unclassifiedNotes.length})</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">无公司信息的笔记</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(['overall', 'industry', 'personal'] as WorkspaceCategory[]).map(cat => {
                        const cfg = CATEGORY_LABELS[cat];
                        const isActive = unclassifiedCategory === cat;
                        return (
                          <button
                            key={cat}
                            onClick={() => setUnclassifiedCategory(cat)}
                            className={`px-2 py-0.5 text-[10px] rounded-full border transition-all ${
                              isActive
                                ? `${cfg.color} border-current font-medium`
                                : 'text-slate-400 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Legend */}
              <div className="flex gap-3 text-[10px]">
                <span className="flex items-center gap-1"><Globe size={10} className="text-purple-500" /> 整体 = 宏观/框架</span>
                <span className="flex items-center gap-1"><Building2 size={10} className="text-blue-500" /> 行业 = 行业研究</span>
                <span className="flex items-center gap-1"><User size={10} className="text-orange-500" /> 个人 = 个人相关</span>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('preview')} className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">
                  返回
                </button>
                <button
                  onClick={handleSync}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  <RefreshCw size={14} />
                  开始同步
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Syncing */}
          {step === 'syncing' && (
            <div className="space-y-4 text-center py-8">
              <Loader2 size={32} className="animate-spin text-blue-600 mx-auto" />
              <p className="text-sm text-slate-700">同步中...</p>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                />
              </div>
              <p className="text-xs text-slate-400">{progress.current} / {progress.total}</p>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 'done' && result && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <Check size={32} className="text-green-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-800">同步完成</p>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between bg-green-50 px-3 py-2 rounded">
                  <span>新建文件夹</span>
                  <span className="font-medium">{result.foldersCreated.length} 个</span>
                </div>
                <div className="flex justify-between bg-blue-50 px-3 py-2 rounded">
                  <span>导入笔记</span>
                  <span className="font-medium">{result.notesImported} 条</span>
                </div>
                {result.skipped > 0 && (
                  <div className="flex justify-between bg-yellow-50 px-3 py-2 rounded">
                    <span>跳过（无摘要）</span>
                    <span className="font-medium">{result.skipped} 条</span>
                  </div>
                )}
                {result.errors.length > 0 && (
                  <div className="bg-red-50 px-3 py-2 rounded">
                    <p className="text-red-600 font-medium mb-1">错误：</p>
                    {result.errors.map((e, i) => <p key={i} className="text-red-500">{e}</p>)}
                  </div>
                )}
                {result.foldersCreated.length > 0 && (
                  <div className="bg-slate-50 px-3 py-2 rounded">
                    <p className="text-slate-500 mb-1">新建的文件夹：</p>
                    <p className="text-slate-700">{result.foldersCreated.join('、')}</p>
                  </div>
                )}
              </div>
              <button onClick={onClose} className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
