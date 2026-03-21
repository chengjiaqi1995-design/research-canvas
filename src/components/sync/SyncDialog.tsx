import { memo, useState, useCallback, useMemo } from 'react';
import { X, RefreshCw, Check, AlertCircle, Loader2, Globe, Building2, User, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { syncApi } from '../../db/apiClient.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { generateId } from '../../utils/id.ts';
import type { Workspace, WorkspaceCategory } from '../../types/index.ts';

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
}

interface NotebookNote {
  id: string;
  _id?: string;
  fileName: string;
  summary?: string;
  translatedSummary?: string;
  tags?: string[];
  participants?: string;
  actualDate?: string;
  status?: string;
  type?: string;
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
  topic?: string;
  organization?: string;
  intermediary?: string;
  industry?: string;
  country?: string;
  eventDate?: string;
  createdAt: string;
  updatedAt?: string;
}

interface SyncResult {
  industryFoldersCreated: string[];
  companyFoldersCreated: string[];
  notesImported: number;
  skipped: number;
  errors: string[];
}

// A company with its notes, assigned to an industry folder
interface CompanyMapping {
  company: string;
  ticker: string | null;      // Bloomberg ticker for listed companies
  notes: NotebookNote[];
  industries: string[];       // raw industry tags from notes
  assignedFolder: string;     // industry folder name (existing or _new:xxx)
  isCompanyExisting: boolean; // company sub-folder already exists
}

// Grouped by industry folder for display
interface IndustryGroup {
  folder: string;             // industry folder name
  isNew: boolean;             // folder needs to be created
  isSpecial: boolean;         // _overall or _personal
  companies: CompanyMapping[];
}

const CATEGORY_ICONS: Record<string, typeof Globe> = {
  _overall: Globe,
  _personal: User,
};

// ─── Last sync tracking ─────────────────────────────────
const LAST_SYNC_KEY = 'rc_last_sync_time';

function getLastSyncTime(): string | null {
  return localStorage.getItem(LAST_SYNC_KEY);
}

function setLastSyncTime(isoDate: string) {
  localStorage.setItem(LAST_SYNC_KEY, isoDate);
}

// ─── Helpers ─────────────────────────────────────────────
function getNoteId(note: NotebookNote): string {
  return note.id || note._id || '';
}

function getCompany(note: NotebookNote): string | null {
  if (note.metadata?.companies?.length) return note.metadata.companies[0];
  if (note.metadata?.organization) return note.metadata.organization;
  if (note.organization) return note.organization;
  return null;
}

// Extract note source type from type field or fileName
const KNOWN_NOTE_TYPES = ['expert', 'sellside'];
function getNoteType(note: NotebookNote): string | null {
  const t = (note.type || '').toLowerCase().trim();
  if (t && KNOWN_NOTE_TYPES.includes(t)) return t;
  const parts = note.fileName?.split('-') || [];
  for (const part of parts) {
    const p = part.trim().toLowerCase();
    if (KNOWN_NOTE_TYPES.includes(p)) return p;
  }
  return null;
}


function getIndustries(note: NotebookNote): string[] {
  const result: string[] = [];
  if (note.metadata?.industries?.length) result.push(...note.metadata.industries);
  if (note.metadata?.industry) result.push(note.metadata.industry);
  if (note.industry) result.push(note.industry);
  return [...new Set(result)].filter(Boolean);
}

function buildNoteContent(note: NotebookNote): string {
  const parts: string[] = [];
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
  if (eventDate) meta.push(`**发生日期**: ${eventDate}`);
  if (note.createdAt) meta.push(`**创建时间**: ${new Date(note.createdAt).toLocaleDateString('zh-CN')}`);
  if (note.tags?.length) meta.push(`**标签**: ${note.tags.join(', ')}`);

  if (meta.length > 0) {
    parts.push(meta.join(' | '));
    parts.push('---');
  }

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

// Simple keyword-based fallback matching
function matchIndustryFolder(industries: string[], topic: string | null, folderNames: string[]): string | null {
  const text = [...industries, topic || ''].join(' ').toLowerCase();
  for (const folder of folderNames) {
    if (text.includes(folder.toLowerCase())) return folder;
  }
  // Partial match
  for (const folder of folderNames) {
    const words = folder.toLowerCase().split(/[\s/]+/);
    if (words.some(w => w.length >= 2 && text.includes(w))) return folder;
  }
  return null;
}

// Fuzzy match company names: "地平线" and "地平线机器人" should be the same
function normalizeCompanyName(name: string, existingNames: string[]): string {
  const lower = name.toLowerCase().trim();
  // Exact match
  const exact = existingNames.find(n => n.toLowerCase() === lower);
  if (exact) return exact;
  // One contains the other — prefer the shorter (canonical) name
  for (const existing of existingNames) {
    const existLower = existing.toLowerCase();
    if (existLower.includes(lower) || lower.includes(existLower)) {
      return existing;
    }
  }
  return name;
}

export const SyncDialog = memo(function SyncDialog({ open, onClose }: SyncDialogProps) {
  const [step, setStep] = useState<'loading' | 'preview' | 'classifying' | 'confirm' | 'syncing' | 'done'>('loading');
  const [notes, setNotes] = useState<NotebookNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [industryGroups, setIndustryGroups] = useState<IndustryGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [hasFetched, setHasFetched] = useState(false);
  const [syncMode, setSyncMode] = useState<'incremental' | 'full'>('incremental');

  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);

  const lastSyncTime = getLastSyncTime();
  const lastSyncDisplay = lastSyncTime
    ? new Date(lastSyncTime).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const stats = useMemo(() => {
    const totalNotes = industryGroups.reduce((sum, g) => g.companies.reduce((s, c) => s + c.notes.length, sum), 0);
    const newIndustries = industryGroups.filter(g => g.isNew && !g.isSpecial).length;
    const newCompanies = industryGroups.reduce((sum, g) => g.companies.filter(c => !c.isCompanyExisting).length + sum, 0);
    return { totalNotes, newIndustries, newCompanies };
  }, [industryGroups]);

  // Fetch notes list
  const handleFetchNotes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await syncApi.fetchNotes();
      const notesList: NotebookNote[] = data?.data?.items || data?.items || data?.transcriptions || [];
      if (!Array.isArray(notesList) || notesList.length === 0) {
        setError('AI Notebook 中没有找到笔记');
        setLoading(false);
        return;
      }

      let filtered = notesList;
      if (syncMode === 'incremental' && lastSyncTime) {
        const lastSync = new Date(lastSyncTime).getTime();
        filtered = notesList.filter(n => new Date(n.createdAt).getTime() > lastSync);
        if (filtered.length === 0) {
          setError(`上次同步（${lastSyncDisplay}）后没有新笔记`);
          setLoading(false);
          return;
        }
      }

      setNotes(filtered);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || '无法连接 AI Notebook');
    }
    setLoading(false);
  }, [syncMode, lastSyncTime, lastSyncDisplay]);

  // Auto-fetch when dialog opens
  if (open && !hasFetched) {
    setHasFetched(true);
    handleFetchNotes();
  }
  if (!open && hasFetched) {
    setHasFetched(false);
    setStep('loading');
    setNotes([]);
    setError('');
    setResult(null);
    setSyncMode('incremental');
    setIndustryGroups([]);
  }

  // Step 2 → 3: AI classify notes into industry folders
  const handleClassify = useCallback(async () => {
    setStep('classifying');
    setError('');

    try {
      await loadWorkspaces();
      const allWorkspaces = useWorkspaceStore.getState().workspaces;

      // Get industry folders (top-level, category = industry or no category)
      const industryFolders = allWorkspaces.filter(w => !w.parentId && (!w.category || w.category === 'industry'));
      const industryFolderNames = industryFolders.map(w => w.name);

      // Get existing company sub-folders (have parentId)
      const companyFolders = allWorkspaces.filter(w => w.parentId);
      const companyByName = new Map<string, Workspace>();
      for (const cf of companyFolders) {
        companyByName.set(cf.name.toLowerCase(), cf);
      }

      // Build note info for classification
      const noteInfos = notes.map(note => ({
        id: getNoteId(note),
        company: getCompany(note),
        industries: getIndustries(note),
        topic: (note.metadata?.topic || note.topic) ?? null,
        fileName: note.fileName,
      }));

      // Try AI classification first, fall back to keyword matching
      let aiClassifications: Map<string, { folder: string; ticker?: string }> = new Map();
      try {
        const resp = await syncApi.classifyNotes(noteInfos, industryFolderNames);
        if (resp.success && resp.classifications) {
          for (const c of resp.classifications) {
            aiClassifications.set(c.id, { folder: c.folder, ticker: c.ticker });
          }
        }
      } catch (err) {
        console.warn('AI classification failed, falling back to keyword matching:', err);
      }

      // Collect all known company names (from existing sub-folders)
      const existingCompanyNames = Array.from(companyByName.values()).map(w => w.name);

      // Build company → industry mapping
      const companyMap = new Map<string, CompanyMapping>();
      const unmappedNotes: NotebookNote[] = [];

      for (const note of notes) {
        let company = getCompany(note);
        const noteId = getNoteId(note);
        const industries = getIndustries(note);
        const topic = note.metadata?.topic || note.topic || null;

        // Normalize company name via fuzzy match
        if (company) {
          company = normalizeCompanyName(company, existingCompanyNames);
          // Track for future normalization within this batch
          if (!existingCompanyNames.some(n => n.toLowerCase() === company!.toLowerCase())) {
            existingCompanyNames.push(company);
          }
        }

        // Determine industry folder and ticker
        const aiResult = aiClassifications.get(noteId);
        let folder: string | null = aiResult?.folder || null;
        let ticker: string | null = aiResult?.ticker || null;

        // Reject _new:xxx — force into existing folders or _unmatched
        if (folder && folder.startsWith('_new:')) {
          folder = null;
        }

        // If AI didn't classify or returned something not in existing folders, try keyword match
        if (!folder || (!industryFolderNames.includes(folder) && !folder.startsWith('_'))) {
          folder = matchIndustryFolder(industries, topic, industryFolderNames);
        }

        // If still no match, check if company already exists as sub-folder
        if (!folder && company) {
          const existing = companyByName.get(company.toLowerCase());
          if (existing?.parentId) {
            const parentWs = allWorkspaces.find(w => w.id === existing.parentId);
            if (parentWs) folder = parentWs.name;
          }
        }

        if (!folder) folder = '_unmatched';

        // Use company name, or fall back to note type (expert/sellside/management) as sub-folder
        const groupName = company || getNoteType(note);

        if (groupName) {
          const key = `${groupName}|||${folder}`;
          if (!companyMap.has(key)) {
            companyMap.set(key, {
              company: groupName,
              ticker: company ? ticker : null, // no ticker for type-based folders
              notes: [],
              industries,
              assignedFolder: folder,
              isCompanyExisting: !!companyByName.get(groupName.toLowerCase()),
            });
          } else if (ticker && company && !companyMap.get(key)!.ticker) {
            companyMap.get(key)!.ticker = ticker;
          }
          companyMap.get(key)!.notes.push(note);
        } else {
          unmappedNotes.push(note);
        }
      }

      // Group by industry folder
      const groupMap = new Map<string, IndustryGroup>();

      for (const mapping of companyMap.values()) {
        const folder = mapping.assignedFolder;
        if (!groupMap.has(folder)) {
          const isExistingFolder = industryFolderNames.includes(folder);
          groupMap.set(folder, {
            folder,
            isNew: !isExistingFolder && !folder.startsWith('_'),
            isSpecial: folder.startsWith('_'),
            companies: [],
          });
        }
        groupMap.get(folder)!.companies.push(mapping);
      }

      // Add unmapped notes as a special group
      if (unmappedNotes.length > 0) {
        if (!groupMap.has('_unmatched')) {
          groupMap.set('_unmatched', { folder: '_unmatched', isNew: false, isSpecial: true, companies: [] });
        }
        groupMap.get('_unmatched')!.companies.push({
          company: '未分类笔记',
          ticker: null,
          notes: unmappedNotes,
          industries: [],
          assignedFolder: '_unmatched',
          isCompanyExisting: false,
        });
      }

      // Sort: existing folders first, then new, then special
      const groups = Array.from(groupMap.values()).sort((a, b) => {
        if (a.isSpecial !== b.isSpecial) return a.isSpecial ? 1 : -1;
        if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
        return a.folder.localeCompare(b.folder, 'zh');
      });

      setIndustryGroups(groups);
      setExpandedGroups(new Set(groups.filter(g => g.isNew || g.isSpecial).map(g => g.folder)));
      setStep('confirm');
    } catch (err: any) {
      setError(err.message || 'AI 分类失败');
      setStep('preview');
    }
  }, [notes, loadWorkspaces]);

  // Change a company's assigned industry folder
  const handleChangeFolder = useCallback((company: string, oldFolder: string, newFolder: string) => {
    setIndustryGroups(prev => {
      const next = prev.map(g => ({ ...g, companies: [...g.companies] }));

      // Remove from old group
      const oldGroup = next.find(g => g.folder === oldFolder);
      let mapping: CompanyMapping | undefined;
      if (oldGroup) {
        const idx = oldGroup.companies.findIndex(c => c.company === company);
        if (idx >= 0) {
          mapping = { ...oldGroup.companies[idx], assignedFolder: newFolder };
          oldGroup.companies.splice(idx, 1);
        }
      }

      if (!mapping) return prev;

      // Add to new group (create if needed)
      let newGroup = next.find(g => g.folder === newFolder);
      if (!newGroup) {
        newGroup = { folder: newFolder, isNew: true, isSpecial: newFolder.startsWith('_'), companies: [] };
        next.push(newGroup);
      }
      newGroup.companies.push(mapping);

      // Remove empty groups
      return next.filter(g => g.companies.length > 0);
    });
  }, []);

  // Get all available industry folder names for dropdown
  const allIndustryFolderNames = useMemo(() => {
    const workspaces = useWorkspaceStore.getState().workspaces;
    const existing = workspaces.filter(w => !w.parentId && (!w.category || w.category === 'industry')).map(w => w.name);
    const newFromGroups = industryGroups.filter(g => g.isNew).map(g => g.folder);
    return [...new Set([...existing, ...newFromGroups])].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [industryGroups]);

  // Execute sync
  const handleSync = useCallback(async () => {
    setStep('syncing');
    setError('');

    const syncResult: SyncResult = {
      industryFoldersCreated: [],
      companyFoldersCreated: [],
      notesImported: 0,
      skipped: 0,
      errors: [],
    };

    await loadWorkspaces();
    const allWorkspaces = useWorkspaceStore.getState().workspaces;

    // Build lookup maps
    const industryByName = new Map<string, Workspace>();
    const companyByKey = new Map<string, Workspace>(); // key = parentId + '/' + name.lower

    for (const w of allWorkspaces) {
      if (!w.parentId && (!w.category || w.category === 'industry')) {
        industryByName.set(w.name.toLowerCase(), w);
      }
      if (w.parentId) {
        companyByKey.set(`${w.parentId}/${w.name.toLowerCase()}`, w);
      }
    }

    // Count total notes
    const totalNotes = industryGroups.reduce((sum, g) => g.companies.reduce((s, c) => s + c.notes.length, sum), 0);
    let notesDone = 0;
    const batchCanvases: any[] = []; // collect all canvases for single batch write
    setProgress({ current: 0, total: totalNotes, label: '' });
    let latestNoteDate = '';

    for (const group of industryGroups) {
      try {
        // Find or create industry folder
        let industryWs: Workspace | undefined;

        if (group.folder === '_unmatched' || group.folder === '_overall') {
          // Use or create a general folder
          const name = group.folder === '_overall' ? '整体研究' : '未分类笔记';
          industryWs = industryByName.get(name.toLowerCase());
          if (!industryWs) {
            const cat: WorkspaceCategory = group.folder === '_overall' ? 'overall' : 'industry';
            industryWs = await createWorkspace(name, '📁', cat);
            syncResult.industryFoldersCreated.push(name);
            industryByName.set(name.toLowerCase(), industryWs);
          }
        } else if (group.folder === '_personal') {
          industryWs = industryByName.get('个人');
          if (!industryWs) {
            industryWs = await createWorkspace('个人', '📁', 'personal');
            syncResult.industryFoldersCreated.push('个人');
            industryByName.set('个人', industryWs);
          }
        } else {
          industryWs = industryByName.get(group.folder.toLowerCase());
          if (!industryWs) {
            // New industry folder suggested by AI
            industryWs = await createWorkspace(group.folder, '📁', 'industry');
            syncResult.industryFoldersCreated.push(group.folder);
            industryByName.set(group.folder.toLowerCase(), industryWs);
          }
        }

        // Helper: find or create a sub-folder under the industry workspace
        async function findOrCreateSubFolder(parentWs: Workspace, folderName: string): Promise<Workspace> {
          const folderLower = folderName.toLowerCase();
          const folderWithoutTicker = folderLower.replace(/^\[.*?\]\s*/, '');
          // Check existing sub-folders
          let found = allWorkspaces.find(w =>
            w.parentId === parentWs.id && (() => {
              const wLower = w.name.toLowerCase();
              const wWithoutTicker = wLower.replace(/^\[.*?\]\s*/, '');
              return wLower === folderLower
                || wWithoutTicker === folderWithoutTicker
                || (folderWithoutTicker.length > 3 && (wWithoutTicker.includes(folderWithoutTicker) || folderWithoutTicker.includes(wWithoutTicker)));
            })()
          );
          if (found) return found;
          // Also check companyByKey cache
          const cacheKey = `${parentWs.id}/${folderLower}`;
          const cached = companyByKey.get(cacheKey);
          if (cached) return cached;
          // Create new
          found = await createWorkspace(folderName, '📁', 'industry', parentWs.id);
          syncResult.companyFoldersCreated.push(`${parentWs.name}/${folderName}`);
          companyByKey.set(cacheKey, found);
          // Also add to allWorkspaces so future lookups find it
          allWorkspaces.push(found);
          return found;
        }

        // Collect notes grouped by target workspace, then batch-import as nodes
        const notesByTarget = new Map<string, { ws: Workspace; notes: NotebookNote[] }>();

        for (const companyMapping of group.companies) {
          for (const note of companyMapping.notes) {
            // Determine target sub-folder
            const company = getCompany(note);
            let targetWs: Workspace;
            let targetKey: string;

            if (company || (companyMapping.company && !['expert', 'sellside'].includes(companyMapping.company.toLowerCase()))) {
              const folderName = companyMapping.ticker
                ? `[${companyMapping.ticker}] ${companyMapping.company}`
                : companyMapping.company;
              targetWs = await findOrCreateSubFolder(industryWs, folderName);
            } else {
              const noteType = getNoteType(note);
              const specialFolder = noteType === 'expert' ? 'Expert' : 'Sellside';
              targetWs = await findOrCreateSubFolder(industryWs, specialFolder);
            }
            targetKey = targetWs.id;

            if (!notesByTarget.has(targetKey)) {
              notesByTarget.set(targetKey, { ws: targetWs, notes: [] });
            }
            notesByTarget.get(targetKey)!.notes.push(note);
          }
        }

        // Build canvases for batch import — one canvas per target workspace
        const { canvasApi } = await import('../../db/apiClient.ts');

        for (const [, { ws: targetWs, notes: targetNotes }] of notesByTarget) {
          try {
            // Find existing canvas in this workspace
            let existingCanvases: any[] = [];
            try {
              existingCanvases = await canvasApi.list(targetWs.id);
            } catch { /* empty */ }

            let existingNodes: any[] = [];
            let canvasId = existingCanvases[0]?.id;

            if (canvasId) {
              // Load existing nodes
              try {
                const canvasData = await canvasApi.get(canvasId);
                existingNodes = canvasData.nodes || [];
              } catch { /* empty */ }
            } else {
              canvasId = generateId();
            }

            // Build set of existing node titles for dedup (skip already imported notes)
            const existingTitles = new Set(existingNodes.map((n: any) => (n.data?.title || '').toLowerCase()));

            // Build new nodes for each note
            const newNodes: any[] = [];
            for (const note of targetNotes) {
              notesDone++;
              setProgress({ current: notesDone, total: totalNotes, label: note.fileName?.slice(0, 30) || '' });

              try {
                let fullNote = note;
                try {
                  const detail = await syncApi.fetchNoteDetail(getNoteId(note));
                  if (detail?.data || detail?.transcription) {
                    fullNote = { ...note, ...(detail.data || detail.transcription || detail) };
                  }
                } catch { /* fallback to list data */ }

                const content = buildNoteContent(fullNote);
                if (content === '(无内容)') { syncResult.skipped++; continue; }

                const nodeTitle = note.fileName || `Note ${getNoteId(note).slice(-6)}`;

                // Skip if already imported (dedup by title)
                if (existingTitles.has(nodeTitle.toLowerCase())) {
                  syncResult.skipped++;
                  continue;
                }

                newNodes.push({
                  id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  type: 'markdown',
                  position: { x: 0, y: 0 },
                  size: { width: 600, height: 400 },
                  data: { type: 'markdown', title: nodeTitle, content },
                  isMain: false,
                });
                syncResult.notesImported++;

                if (note.createdAt > latestNoteDate) latestNoteDate = note.createdAt;
              } catch (err: any) {
                syncResult.errors.push(`${targetWs.name}/${note.fileName}: ${err.message}`);
              }
            }

            if (newNodes.length > 0) {
              const allNodes = [...existingNodes, ...newNodes];
              // Ensure at least one main node
              if (!allNodes.some((n: any) => n.isMain)) {
                allNodes[0].isMain = true;
              }

              // Add to batch for single index write
              batchCanvases.push({
                id: canvasId,
                workspaceId: targetWs.id,
                title: targetWs.name,
                nodes: allNodes,
              });
            }
          } catch (err: any) {
            syncResult.errors.push(`${targetWs.name}: ${err.message}`);
          }
        }
      } catch (err: any) {
        syncResult.errors.push(`${group.folder}: ${err.message}`);
      }
    }

    // Batch write all canvases at once (single index update, no GCS rate limit)
    if (batchCanvases.length > 0) {
      setProgress({ current: notesDone, total: totalNotes, label: '写入数据...' });
      try {
        await syncApi.batchImport(batchCanvases);
      } catch (err: any) {
        syncResult.errors.push(`批量写入失败: ${err.message}`);
      }
    }

    if (latestNoteDate) {
      setLastSyncTime(latestNoteDate);
    }

    await loadWorkspaces();
    setResult(syncResult);
    setStep('done');
  }, [industryGroups, loadWorkspaces, createWorkspace, createCanvas]);

  const toggleGroup = useCallback((folder: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[620px] max-h-[85vh] flex flex-col"
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

          {/* Step 1: Loading */}
          {step === 'loading' && (
            <div className="space-y-4 text-center py-8">
              {loading ? (
                <>
                  <Loader2 size={32} className="animate-spin text-blue-600 mx-auto" />
                  <p className="text-sm text-slate-700">正在从 AI Notebook 获取笔记...</p>
                </>
              ) : error ? (
                <>
                  <AlertCircle size={32} className="text-amber-500 mx-auto" />
                  <p className="text-sm text-slate-600">{error}</p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => { setSyncMode('full'); setHasFetched(false); }}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                    >
                      全量同步（所有笔记）
                    </button>
                    <button
                      onClick={() => { setError(''); setHasFetched(false); }}
                      className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                    >
                      重试
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Step 2: Preview notes */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  {syncMode === 'incremental' && lastSyncDisplay
                    ? <>自 {lastSyncDisplay} 以来有 <strong>{notes.length}</strong> 条新笔记</>
                    : <>找到 <strong>{notes.length}</strong> 条笔记</>
                  }
                </p>
                {syncMode === 'incremental' && lastSyncTime && (
                  <button
                    onClick={() => { setSyncMode('full'); setHasFetched(false); setStep('loading'); }}
                    className="text-[10px] text-blue-600 hover:underline"
                  >
                    切换全量同步
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {notes.slice(0, 50).map((note) => {
                  const company = getCompany(note);
                  const industries = getIndustries(note);
                  const topic = note.metadata?.topic || note.topic;
                  return (
                    <div key={getNoteId(note)} className="px-3 py-2">
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
                      </div>
                    </div>
                  );
                })}
                {notes.length > 50 && (
                  <div className="px-3 py-2 text-xs text-slate-400 text-center">... 还有 {notes.length - 50} 条</div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">
                  取消
                </button>
                <button
                  onClick={handleClassify}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  <Sparkles size={14} />
                  AI 智能归类
                </button>
              </div>
            </div>
          )}

          {/* Step 2.5: AI classifying */}
          {step === 'classifying' && (
            <div className="space-y-4 text-center py-8">
              <Sparkles size={32} className="text-purple-600 mx-auto animate-pulse" />
              <p className="text-sm text-slate-700">AI 正在分析笔记并匹配行业文件夹...</p>
              <p className="text-xs text-slate-400">分析 {notes.length} 条笔记的行业、公司信息</p>
            </div>
          )}

          {/* Step 3: Confirm industry → company mapping */}
          {step === 'confirm' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                AI 已将笔记归类到行业文件夹 → 公司子文件夹。请确认后点击「开始同步」。
              </p>

              <div className="flex gap-3 text-[10px] text-slate-400 flex-wrap">
                <span>行业文件夹: <strong className="text-slate-700">{industryGroups.length}</strong> 个</span>
                {stats.newIndustries > 0 && (
                  <span>新建行业: <strong className="text-green-600">{stats.newIndustries}</strong></span>
                )}
                <span>新建公司: <strong className="text-blue-600">{stats.newCompanies}</strong></span>
                <span>总笔记: <strong className="text-slate-700">{stats.totalNotes}</strong></span>
              </div>

              <div className="max-h-[45vh] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {industryGroups.map((group) => {
                  const isExpanded = expandedGroups.has(group.folder);
                  const SpecialIcon = CATEGORY_ICONS[group.folder] || Building2;
                  const noteCount = group.companies.reduce((s, c) => s + c.notes.length, 0);
                  const displayName = group.folder === '_unmatched' ? '⚠️ 未匹配' :
                    group.folder === '_overall' ? '整体研究' :
                    group.folder === '_personal' ? '个人' :
                    group.folder;

                  return (
                    <div key={group.folder}>
                      {/* Industry folder header */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 ${group.isNew ? 'bg-green-50/50' : ''}`}
                        onClick={() => toggleGroup(group.folder)}
                      >
                        {isExpanded ? <ChevronDown size={12} className="text-slate-400 shrink-0" /> : <ChevronRight size={12} className="text-slate-400 shrink-0" />}
                        <SpecialIcon size={13} className={group.isSpecial ? 'text-purple-500' : 'text-blue-500'} />
                        <span className="text-xs font-semibold text-slate-700 flex-1 truncate">{displayName}</span>
                        <span className="text-[10px] text-slate-400">{group.companies.length} 公司 · {noteCount} 笔记</span>
                        {group.isNew && <span className="text-[9px] bg-green-100 text-green-600 px-1.5 rounded">新建</span>}
                      </div>

                      {/* Company list under this industry */}
                      {isExpanded && (
                        <div className="bg-slate-50/50">
                          {group.companies.map((cm) => (
                            <div key={cm.company} className="flex items-center gap-2 px-3 py-1.5 pl-8 border-t border-slate-100">
                              <span className="text-xs text-slate-600 flex-1 truncate">
                                {cm.company}
                                {cm.ticker && <span className="text-[10px] text-slate-400 ml-1">({cm.ticker})</span>}
                              </span>
                              <span className="text-[10px] text-slate-400 shrink-0">({cm.notes.length})</span>
                              {cm.isCompanyExisting && (
                                <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 rounded shrink-0">已存在</span>
                              )}
                              {/* Dropdown to change industry folder */}
                              {!group.isSpecial && (
                                <select
                                  value={cm.assignedFolder}
                                  onChange={(e) => handleChangeFolder(cm.company, group.folder, e.target.value)}
                                  className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 max-w-[100px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {allIndustryFolderNames.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 text-[10px]">
                <span className="flex items-center gap-1"><Building2 size={10} className="text-blue-500" /> 行业文件夹 → 公司子文件夹 → 笔记</span>
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
              <p className="text-sm text-slate-700">同步中... 逐条获取全文</p>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: progress.total ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                />
              </div>
              <p className="text-xs text-slate-400">
                {progress.current} / {progress.total}
                {progress.label && <span className="block text-slate-300 truncate mt-0.5">{progress.label}</span>}
              </p>
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
                {result.industryFoldersCreated.length > 0 && (
                  <div className="flex justify-between bg-green-50 px-3 py-2 rounded">
                    <span>新建行业文件夹</span>
                    <span className="font-medium">{result.industryFoldersCreated.length} 个</span>
                  </div>
                )}
                <div className="flex justify-between bg-green-50 px-3 py-2 rounded">
                  <span>新建公司子文件夹</span>
                  <span className="font-medium">{result.companyFoldersCreated.length} 个</span>
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
                    {result.errors.slice(0, 10).map((e, i) => <p key={i} className="text-red-500">{e}</p>)}
                    {result.errors.length > 10 && <p className="text-red-400">... 还有 {result.errors.length - 10} 个错误</p>}
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
