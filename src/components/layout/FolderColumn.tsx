import { memo, useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus,
  Trash2,
  FolderOpen,
  Folder,
  PanelLeftClose,
  ChevronRight,
  ChevronDown,
  Palette,
  Clock,
  Globe,
  Building2,
  User,
  RefreshCw,
  FileAudio,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { SyncDialog } from '../sync/SyncDialog.tsx';
import { AIProcessSyncDialog } from '../sync/AIProcessSyncDialog.tsx';
import CanvasNameModal from './CanvasNameModal.tsx';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore.ts';
import { resolveIcon } from '../../constants/industryCategories.ts';
import { IndustryCategoryManager } from './IndustryCategoryManager.tsx';
import type { Workspace, WorkspaceCategory } from '../../types/index.ts';

interface FolderColumnProps {
  collapsed: boolean;
  onToggle: () => void;
  headerless?: boolean;
}

const CATEGORY_CONFIG = [
  { key: 'recent' as const, label: '最近', icon: Clock },
  { key: 'overall' as const, label: '整体', icon: Globe },
  { key: 'industry' as const, label: '行业', icon: Building2 },
  { key: 'personal' as const, label: '个人', icon: User },
];

export const FolderColumn = memo(function FolderColumn({ collapsed, onToggle, headerless }: FolderColumnProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const recentWorkspaceIds = useWorkspaceStore((s) => s.recentWorkspaceIds);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const updateWorkspaceCategory = useWorkspaceStore((s) => s.updateWorkspaceCategory);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);
  const renameCanvas = useWorkspaceStore((s) => s.renameCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  const industryCategories = useIndustryCategoryStore((s) => s.categories);
  const industryCategoriesLoaded = useIndustryCategoryStore((s) => s.loaded);
  const loadIndustryCategories = useIndustryCategoryStore((s) => s.loadCategories);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceCategory, setNewWorkspaceCategory] = useState<WorkspaceCategory>('industry');
  const [showNewCanvas, setShowNewCanvas] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const canvasRenameRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; wsId: string } | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [showAIProcessSync, setShowAIProcessSync] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  useEffect(() => {
    loadIndustryCategories();
  }, [loadIndustryCategories]);

  useEffect(() => {
    if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); }
  }, [renamingId]);

  useEffect(() => {
    if (renamingCanvasId && canvasRenameRef.current) { canvasRenameRef.current.focus(); canvasRenameRef.current.select(); }
  }, [renamingCanvasId]);

  useEffect(() => {
    if (currentWorkspaceId) {
      setExpandedFolders((prev) => new Set(prev).add(currentWorkspaceId));
    }
  }, [currentWorkspaceId]);

  // Auto-select canvas when workspace has exactly 1 canvas
  useEffect(() => {
    if (canvases.length === 1 && !currentCanvasId) {
      setCurrentCanvas(canvases[0].id);
    }
  }, [canvases, currentCanvasId, setCurrentCanvas]);

  useEffect(() => {
    const h = () => {
      if (document.visibilityState === 'visible') {
        loadWorkspaces();
        const wsId = useWorkspaceStore.getState().currentWorkspaceId;
        if (wsId) loadCanvases(wsId);
      }
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [loadWorkspaces, loadCanvases]);

  // Listen for rc-new-workspace event from MainLayout (legacy support)
  useEffect(() => {
    const handler = () => setShowNewWorkspace(true);
    window.addEventListener('rc-new-workspace', handler);
    return () => window.removeEventListener('rc-new-workspace', handler);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    const ws = await createWorkspace(newWorkspaceName.trim(), '📁');
    // Set the category
    await updateWorkspaceCategory(ws.id, newWorkspaceCategory);
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
    setExpandedFolders((prev) => new Set(prev).add(ws.id));
    setCurrentWorkspace(ws.id);
  };

  const handleCreateCanvas = async (wsId: string, name: string) => {
    if (!name.trim()) return;
    const canvas = await createCanvas(wsId, name.trim());
    setShowNewCanvas(null);
    setCurrentCanvas(canvas.id);
  };

  const handleRenameConfirm = async () => {
    if (renamingId && renameValue.trim()) await renameWorkspace(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setCurrentWorkspace(id);
  };

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, wsId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, wsId });
  }, []);

  const handleSetCategory = useCallback(async (category: WorkspaceCategory, industryCategory?: string) => {
    if (contextMenu) {
      await updateWorkspaceCategory(contextMenu.wsId, category, industryCategory);
      setContextMenu(null);
    }
  }, [contextMenu, updateWorkspaceCategory]);

  // Filter workspaces — matching search
  const filtered = searchQuery.trim()
    ? workspaces.filter((ws) => ws.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : workspaces;

  // Group workspaces by category
  // "最近" uses updatedAt sorting (server-side) so it's consistent across browsers
  const recentWorkspaces = [...filtered]
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 5);

  const overallWorkspaces = filtered.filter(ws => ws.category === 'overall');
  const industryWorkspaces = filtered.filter(ws => !ws.category || ws.category === 'industry');
  const personalWorkspaces = filtered.filter(ws => ws.category === 'personal');

  function getNotesCount(ws: Workspace): number {
    return (ws.canvasIds || []).length;
  }

  // Group industry workspaces by big category for display
  const allMappedNames = new Set(industryCategories.flatMap(c => c.subCategories.map(s => s.toLowerCase())));
  const industryByBigCategory: { label: string; icon: any; items: Workspace[] }[] = industryCategories.map(cat => ({
    label: cat.label,
    icon: resolveIcon(cat.icon),
    items: industryWorkspaces.filter(ws =>
      // 1. Explicit industryCategory assignment (from right-click menu)
      ws.industryCategory === cat.label ||
      // 2. Fallback: name matches subCategories
      (!ws.industryCategory && cat.subCategories.some(s => s.toLowerCase() === ws.name.toLowerCase()))
    ),
  }));
  // Uncategorized: no explicit industryCategory AND name not in any subCategories
  const uncategorizedIndustry = industryWorkspaces.filter(ws =>
    !ws.industryCategory && !allMappedNames.has(ws.name.toLowerCase())
  );
  if (uncategorizedIndustry.length > 0) {
    industryByBigCategory.push({ label: '未分大类', icon: '📁', items: uncategorizedIndustry });
  }

  // Sort big categories by total notes count (descending)
  // Also sort small categories within each big category by notes count
  for (const bigCat of industryByBigCategory) {
    bigCat.items.sort((a, b) => getNotesCount(b) - getNotesCount(a));
  }
  industryByBigCategory.sort((a, b) => {
    const countA = a.items.reduce((sum, ws) => sum + getNotesCount(ws), 0);
    const countB = b.items.reduce((sum, ws) => sum + getNotesCount(ws), 0);
    return countB - countA;
  });

  const groupedData: { key: string; label: string; icon: typeof Clock; items: Workspace[] }[] = [
    { ...CATEGORY_CONFIG[0], items: recentWorkspaces },
    { ...CATEGORY_CONFIG[1], items: overallWorkspaces },
    { ...CATEGORY_CONFIG[3], items: personalWorkspaces },
  ];

  if (collapsed) {
    return null;
  }

  const renderWorkspaceItem = (ws: Workspace, isRecent = false) => {
    const isActive = currentWorkspaceId === ws.id;
    const isExpanded = expandedFolders.has(ws.id) && !isRecent;
    const isRenaming = renamingId === ws.id;

    return (
      <div key={isRecent ? `recent-${ws.id}` : ws.id}>
        {/* Folder row */}
        <div
          className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
          onClick={() => toggleFolder(ws.id)}
          onDoubleClick={(e) => {
            if (isRecent) return;
            e.stopPropagation();
            setRenamingId(ws.id);
            setRenameValue(ws.name);
          }}
          onContextMenu={(e) => !isRecent && handleContextMenu(e, ws.id)}
        >
          {!isRecent && (
            isExpanded ? <ChevronDown size={11} className="shrink-0 text-slate-400" /> : <ChevronRight size={11} className="shrink-0 text-slate-400" />
          )}
          {isActive
            ? <FolderOpen size={13} className="shrink-0 text-amber-500" />
            : <Folder size={13} className="shrink-0 text-amber-400" />
          }
          {isRenaming ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onBlur={handleRenameConfirm}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 text-xs px-1 border border-blue-400 rounded outline-none bg-white min-w-0"
            />
          ) : (
            <span className="flex-1 truncate">{ws.name}</span>
          )}
          {!isRenaming && !isRecent && (
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button
                onClick={(e) => { e.stopPropagation(); setShowNewCanvas(ws.id); }}
                className="p-0.5 rounded hover:bg-slate-200"
                title="新建画布"
              >
                <Plus size={11} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`删除文件夹「${ws.name}」？`)) deleteWorkspace(ws.id);
                }}
                className="p-0.5 rounded hover:bg-red-100 text-red-400"
                title="删除"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </div>

        {/* Canvases under folder (not for recent) */}
        {isExpanded && !isRecent && (
          <div className="ml-5 border-l border-slate-200/60 pl-2 mt-1 mb-1 space-y-0.5">
            {/* Canvas name modal is rendered at component root level */}

            {isActive && [...canvases].sort((a, b) => {
              // Priorities: 1=行业研究, 2=Expert, 3=Sellside, 4=Others
              const getRank = (t: string) => {
                const title = t.toLowerCase();
                if (title.includes('行业研究')) return 1;
                if (title.includes('expert')) return 2;
                if (title.includes('sellside')) return 3;
                return 4;
              };
              const rankA = getRank(a.title);
              const rankB = getRank(b.title);
              if (rankA !== rankB) return rankA - rankB; // Top ranks hoisted highest
              
              // Secondary sort: attachment node volume descending
              const countA = (a as any).nodeCount || 0;
              const countB = (b as any).nodeCount || 0;
              if (countB !== countA) return countB - countA;
              
              // Fallback alphabetical stability
              return a.title.localeCompare(b.title);
            }).map((canvas) => {
              const isCurrent = currentCanvasId === canvas.id;
              const isRenamingCanvas = renamingCanvasId === canvas.id;
              const attachmentCount = (canvas as any).nodeCount || 0;

              return (
                <div
                  key={canvas.id}
                  className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isCurrent ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                  onClick={() => setCurrentCanvas(canvas.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingCanvasId(canvas.id);
                    setCanvasRenameValue(canvas.title);
                  }}
                >
                  <Palette size={11} className="shrink-0 text-violet-500" />
                  {isRenamingCanvas ? (
                    <input
                      ref={canvasRenameRef}
                      value={canvasRenameValue}
                      onChange={(e) => setCanvasRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { if (canvasRenameValue.trim()) renameCanvas(canvas.id, canvasRenameValue.trim()); setRenamingCanvasId(null); }
                        if (e.key === 'Escape') setRenamingCanvasId(null);
                      }}
                      onBlur={() => { if (canvasRenameValue.trim()) renameCanvas(canvas.id, canvasRenameValue.trim()); setRenamingCanvasId(null); }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 text-xs px-1 border border-blue-400 rounded outline-none bg-white min-w-0"
                    />
                  ) : (
                    <span className="flex-1 truncate">
                       {canvas.title}
                       {attachmentCount > 0 && <span className="ml-1 text-[9px] px-1 bg-slate-100 rounded text-slate-400">{attachmentCount}</span>}
                    </span>
                  )}
                  {!isRenamingCanvas && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm(`删除画布「${canvas.title}」？`)) deleteCanvas(canvas.id); }}
                      className="hidden group-hover:block p-0.5 rounded hover:bg-red-100 text-red-400 shrink-0"
                      title="删除"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              );
            })}

            {isActive && canvases.length === 0 && !showNewCanvas && (
              <div className="px-3 py-1 text-[10px] text-slate-400">暂无画布</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-slate-50 shrink-0 ${headerless ? 'w-full min-w-0' : ''}`} style={headerless ? undefined : { width: 200 }}>
      {/* Header — hidden when headerless (MainLayout provides unified header) */}
      {!headerless && (
        <div className="flex items-center justify-between px-2 py-2 border-b border-slate-200 shrink-0">
          <span className="text-xs font-semibold text-slate-700">文件夹</span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setShowSync(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="从 AI Notebook 同步">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setShowAIProcessSync(true)} className="p-1 rounded hover:bg-blue-100 text-blue-500" title="从 AI Process 同步">
              <FileAudio size={14} />
            </button>
            <button onClick={() => setShowNewWorkspace(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="新建文件夹">
              <Plus size={14} />
            </button>
            <button onClick={onToggle} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="折叠">
              <PanelLeftClose size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Search + New folder button */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-100 shrink-0">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索..."
          className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white"
        />
        <button
          onClick={() => setShowCategoryManager(true)}
          className="p-1 rounded hover:bg-slate-200 text-slate-400 shrink-0"
          title="管理行业分类"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* New workspace input */}
      {showNewWorkspace && (
        <div className="px-2 py-1.5 border-b border-slate-100 shrink-0 space-y-1">
          <input
            autoFocus
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateWorkspace();
              if (e.key === 'Escape') setShowNewWorkspace(false);
            }}
            placeholder="文件夹名称..."
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
          />
          <select
            value={newWorkspaceCategory}
            onChange={(e) => setNewWorkspaceCategory(e.target.value as WorkspaceCategory)}
            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400 bg-white"
          >
            <option value="overall">整体</option>
            <option value="industry">行业</option>
            <option value="personal">个人</option>
          </select>
        </div>
      )}

      {/* Sectioned folder list */}
      <div className="flex-1 overflow-y-auto">
        {/* Standard sections (最近, 整体, 个人) */}
        {groupedData.map(({ key, label, icon: SectionIcon, items }) => {
          if (items.length === 0 && searchQuery) return null;
          const isSectionCollapsed = collapsedSections.has(key);

          return (
            <div key={key} className="border-b border-slate-100 last:border-b-0">
              <div
                className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-slate-100 select-none"
                onClick={() => toggleSection(key)}
              >
                {isSectionCollapsed
                  ? <ChevronRight size={11} className="text-slate-400" />
                  : <ChevronDown size={11} className="text-slate-400" />
                }
                <SectionIcon size={12} className="text-slate-400" />
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{items.length}</span>
              </div>
              {!isSectionCollapsed && (
                <div className="pb-1 mt-1 border-l border-slate-200/60 ml-5 pl-1.5 space-y-0.5">
                  {items.length === 0 ? (
                    <div className="px-4 py-1 text-[10px] text-slate-400">暂无</div>
                  ) : (
                    items.map(ws => renderWorkspaceItem(ws, key === 'recent'))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Big industry categories as top-level sections */}
        {industryByBigCategory.filter(g => g.items.length > 0 || !searchQuery).map(bigCat => {
          const bigKey = `big_${bigCat.label}`;
          const isBigCollapsed = collapsedSections.has(bigKey);
          return (
            <div key={bigKey} className="border-b border-slate-100 last:border-b-0">
              <div
                className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-slate-100 select-none"
                onClick={() => toggleSection(bigKey)}
              >
                {isBigCollapsed
                  ? <ChevronRight size={11} className="text-slate-400" />
                  : <ChevronDown size={11} className="text-slate-400" />
                }
                {typeof bigCat.icon === 'string' ? (
                  <span className="text-slate-500 shrink-0 w-[13px] flex justify-center text-[10px]">{bigCat.icon}</span>
                ) : (
                  <bigCat.icon size={13} className="text-slate-500 shrink-0" />
                )}
                <span className="text-[11px] font-medium text-slate-600 uppercase tracking-wider">{bigCat.label}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{bigCat.items.length}</span>
              </div>
              {!isBigCollapsed && (
                <div className="pb-1 mt-1 border-l border-slate-200/60 ml-5 pl-1.5 space-y-0.5">
                  {bigCat.items.length === 0 ? (
                    <div className="px-4 py-1 text-[10px] text-slate-400">暂无</div>
                  ) : (
                    bigCat.items.map(ws => renderWorkspaceItem(ws))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu for category change */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-[9999] max-h-[300px] overflow-y-auto"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] text-slate-400 font-medium">移动到分类</div>
          <button
            onClick={() => handleSetCategory('overall', '')}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            <Globe size={12} /> 整体
          </button>
          <button
            onClick={() => handleSetCategory('personal', '')}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            <User size={12} /> 个人
          </button>
          <div className="border-t border-slate-100 my-1" />
          {industryCategories.map(cat => {
            const IconComp = resolveIcon(cat.icon);
            return (
              <button
                key={cat.label}
                onClick={() => {
                  handleSetCategory('industry', cat.label);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
              >
                <IconComp size={13} className="text-slate-400 shrink-0" />
                {cat.label}
              </button>
            );
          })}
        </div>
      )}

      {!headerless && (
        <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
          {workspaces.length}
        </div>
      )}

      {/* Sync Dialog — only rendered when standalone (not headerless) */}
      {!headerless && <SyncDialog open={showSync} onClose={() => setShowSync(false)} />}
      {!headerless && <AIProcessSyncDialog open={showAIProcessSync} onClose={() => setShowAIProcessSync(false)} />}

      {/* Industry Category Manager */}
      <IndustryCategoryManager open={showCategoryManager} onClose={() => setShowCategoryManager(false)} />

      {/* Canvas Name Modal */}
      <CanvasNameModal
        open={!!showNewCanvas}
        workspaceName={workspaces.find(w => w.id === showNewCanvas)?.name || ''}
        onConfirm={(name) => {
          if (showNewCanvas) handleCreateCanvas(showNewCanvas, name);
        }}
        onClose={() => setShowNewCanvas(null)}
      />
    </div>
  );
});
