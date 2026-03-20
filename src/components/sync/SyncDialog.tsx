import { memo, useState, useCallback } from 'react';
import { X, RefreshCw, Check, AlertCircle, Loader2, Download } from 'lucide-react';
import { syncApi } from '../../db/apiClient.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import type { WorkspaceCategory } from '../../types/index.ts';

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
}

interface NotebookNote {
  _id: string;
  fileName: string;
  summary?: string;
  translatedSummary?: string;
  metadata?: {
    companies?: string[];
    industries?: string[];
    topics?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

interface SyncResult {
  foldersCreated: string[];
  notesImported: number;
  skipped: number;
  errors: string[];
}

// Map common industry names to categories
function guessCategory(industries: string[]): WorkspaceCategory {
  const personalKeywords = ['personal', '个人', '生活'];
  const overallKeywords = ['macro', '宏观', '策略', '市场', '研究框架', 'framework'];

  for (const ind of industries) {
    const lower = ind.toLowerCase();
    if (personalKeywords.some(k => lower.includes(k))) return 'personal';
    if (overallKeywords.some(k => lower.includes(k))) return 'overall';
  }
  return 'industry';
}

export const SyncDialog = memo(function SyncDialog({ open, onClose }: SyncDialogProps) {
  const [token, setToken] = useState(() => localStorage.getItem('rc_notebook_token') || '');
  const [step, setStep] = useState<'token' | 'preview' | 'syncing' | 'done'>('token');
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const updateWorkspaceCategory = useWorkspaceStore((s) => s.updateWorkspaceCategory);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);

  // Step 1: Fetch notes from ai-notebook
  const handleFetchNotes = useCallback(async () => {
    if (!token.trim()) {
      setError('Please enter your AI Notebook token');
      return;
    }
    setLoading(true);
    setError('');
    try {
      localStorage.setItem('rc_notebook_token', token);
      const data = await syncApi.fetchNotes(token);
      const notesList = data.transcriptions || data.data || data || [];
      if (!Array.isArray(notesList) || notesList.length === 0) {
        setError('No notes found in AI Notebook');
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

  // Step 2: Execute sync
  const handleSync = useCallback(async () => {
    setStep('syncing');
    setError('');

    const syncResult: SyncResult = {
      foldersCreated: [],
      notesImported: 0,
      skipped: 0,
      errors: [],
    };

    // Refresh workspace list
    await loadWorkspaces();
    const currentWorkspaces = useWorkspaceStore.getState().workspaces;
    const existingNames = new Map(currentWorkspaces.map(w => [w.name.toLowerCase(), w]));

    // Group notes by company (first company in metadata)
    const notesByCompany = new Map<string, NotebookNote[]>();
    const unclassified: NotebookNote[] = [];

    for (const note of notes) {
      const companies = note.metadata?.companies || [];
      if (companies.length > 0) {
        const company = companies[0];
        if (!notesByCompany.has(company)) notesByCompany.set(company, []);
        notesByCompany.get(company)!.push(note);
      } else {
        unclassified.push(note);
      }
    }

    const totalSteps = notesByCompany.size + (unclassified.length > 0 ? 1 : 0);
    setProgress({ current: 0, total: totalSteps });
    let stepCount = 0;

    // Process each company group
    for (const [company, companyNotes] of notesByCompany) {
      stepCount++;
      setProgress({ current: stepCount, total: totalSteps });

      try {
        // Find or create folder for this company
        let workspace = existingNames.get(company.toLowerCase())
          || currentWorkspaces.find(w => w.name === company);

        if (!workspace) {
          const industries = companyNotes[0]?.metadata?.industries || [];
          const category = guessCategory(industries);
          workspace = await createWorkspace(company, '📁');
          await updateWorkspaceCategory(workspace.id, category);
          syncResult.foldersCreated.push(company);
          existingNames.set(company.toLowerCase(), workspace);
        }

        // Create a canvas for each note's summary
        for (const note of companyNotes) {
          const summary = note.translatedSummary || note.summary;
          if (!summary) {
            syncResult.skipped++;
            continue;
          }

          const canvasTitle = note.fileName || `Note ${note._id.slice(-6)}`;

          // Create canvas with summary as a text node
          const canvas = await createCanvas(workspace.id, canvasTitle);

          // Add the summary as a markdown node via the canvas API
          const { canvasApi } = await import('../../db/apiClient.ts');
          await canvasApi.update(canvas.id, {
            nodes: [{
              id: `node-${Date.now()}`,
              type: 'markdown',
              position: { x: 50, y: 50 },
              size: { width: 600, height: 400 },
              data: {
                type: 'markdown',
                title: canvasTitle,
                content: summary,
              },
              isMain: true,
            }],
          });

          syncResult.notesImported++;
        }
      } catch (err: any) {
        syncResult.errors.push(`${company}: ${err.message}`);
      }
    }

    // Process unclassified notes → put in "未分类笔记" folder
    if (unclassified.length > 0) {
      stepCount++;
      setProgress({ current: stepCount, total: totalSteps });

      try {
        let miscFolder = existingNames.get('未分类笔记');
        if (!miscFolder) {
          miscFolder = await createWorkspace('未分类笔记', '📁');
          await updateWorkspaceCategory(miscFolder.id, 'overall');
          syncResult.foldersCreated.push('未分类笔记');
        }

        for (const note of unclassified) {
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
              data: {
                type: 'markdown',
                title: canvasTitle,
                content: summary,
              },
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
  }, [notes, loadWorkspaces, createWorkspace, updateWorkspaceCategory, createCanvas]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className="text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">
              从 AI Notebook 同步
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Step 1: Enter token */}
          {step === 'token' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                从 AI Notebook 同步笔记摘要到文件管理系统。会自动根据公司名称创建文件夹并导入摘要。
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  AI Notebook Token
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴你的 AI Notebook auth token..."
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

          {/* Step 2: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                找到 <strong>{notes.length}</strong> 条笔记。点击同步开始导入。
              </p>

              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {notes.slice(0, 50).map((note) => (
                  <div key={note._id} className="px-3 py-2">
                    <div className="text-xs font-medium text-slate-700 truncate">
                      {note.fileName}
                    </div>
                    <div className="text-[10px] text-slate-400 flex gap-2 mt-0.5">
                      {note.metadata?.companies?.length ? (
                        <span className="bg-blue-50 text-blue-600 px-1.5 rounded">
                          {note.metadata.companies[0]}
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-400 px-1.5 rounded">未分类</span>
                      )}
                      {note.metadata?.industries?.map((ind, i) => (
                        <span key={i} className="bg-green-50 text-green-600 px-1.5 rounded">
                          {ind}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {notes.length > 50 && (
                  <div className="px-3 py-2 text-xs text-slate-400 text-center">
                    ... 还有 {notes.length - 50} 条
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('token')}
                  className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  返回
                </button>
                <button
                  onClick={handleSync}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  <RefreshCw size={14} />
                  开始同步 ({notes.length} 条)
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Syncing */}
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
              <p className="text-xs text-slate-400">
                {progress.current} / {progress.total} 个公司文件夹
              </p>
            </div>
          )}

          {/* Step 4: Done */}
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
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-red-500">{e}</p>
                    ))}
                  </div>
                )}

                {result.foldersCreated.length > 0 && (
                  <div className="bg-slate-50 px-3 py-2 rounded">
                    <p className="text-slate-500 mb-1">新建的文件夹：</p>
                    <p className="text-slate-700">{result.foldersCreated.join('、')}</p>
                  </div>
                )}
              </div>

              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
