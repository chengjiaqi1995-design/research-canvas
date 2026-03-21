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
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { SyncDialog } from '../sync/SyncDialog.tsx';
import { INDUSTRY_CATEGORY_MAP } from '../../constants/industryCategories.ts';
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

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceCategory, setNewWorkspaceCategory] = useState<WorkspaceCategory>('industry');
  const [showNewCanvas, setShowNewCanvas] = useState<string | null>(null);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const canvasRenameRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; wsId: string } | null>(null);
  const [showSync, setShowSync] = useState(false);

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

  const handleCreateCanvas = async (wsId: string) => {
    if (!newCanvasName.trim()) return;
    const canvas = await createCanvas(wsId, newCanvasName.trim());
    setNewCanvasName('');
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

  const handleSetCategory = useCallback(async (category: WorkspaceCategory) => {
    if (contextMenu) {
      await updateWorkspaceCategory(contextMenu.wsId, category);
      setContextMenu(null);
    }
  }, [contextMenu, updateWorkspaceCategory]);

  // Filter workspaces — only top-level (no parentId), or matching search in both levels
  const topLevel = workspaces.filter(ws => !ws.parentId);
  const subFolders = workspaces.filter(ws => ws.parentId);
  const subByParent = new Map<string, Workspace[]>();
  for (const sub of subFolders) {
    const list = subByParent.get(sub.parentId!) || [];
    list.push(sub);
    subByParent.set(sub.parentId!, list);
  }

  const filtered = searchQuery.trim()
    ? topLevel.filter((ws) => {
        const nameMatch = ws.name.toLowerCase().includes(searchQuery.toLowerCase());
        // Also show parent if any child matches
        const childMatch = (subByParent.get(ws.id) || []).some(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
        return nameMatch || childMatch;
      })
    : topLevel;

  // Group workspaces by category
  const recentWorkspaces = recentWorkspaceIds
    .map(id => filtered.find(ws => ws.id === id))
    .filter((ws): ws is Workspace => !!ws)
    .slice(0, 5);

  const overallWorkspaces = filtered.filter(ws => ws.category === 'overall');
  const industryWorkspaces = filtered.filter(ws => !ws.category || ws.category === 'industry');
  const personalWorkspaces = filtered.filter(ws => ws.category === 'personal');

  // Count total notes (canvases) under a workspace including all sub-folders
  function getNotesCount(ws: Workspace): number {
    const directCount = (ws.canvasIds || []).length;
    const subs = subByParent.get(ws.id) || [];
    const subCount = subs.reduce((sum, sub) => sum + (sub.canvasIds || []).length, 0);
    return directCount + subCount;
  }

  // Sort sub-folders: 行业研究 first, Expert second, Sellside third, then companies
  const SPECIAL_FOLDER_ORDER: Record<string, number> = { '行业研究': 0, 'expert': 1, 'sellside': 2 };
  function sortSubFolders(parentId: string) {
    const subs = subByParent.get(parentId);
    if (!subs) return;
    subs.sort((a, b) => {
      const orderA = SPECIAL_FOLDER_ORDER[a.name.toLowerCase()] ?? 3;
      const orderB = SPECIAL_FOLDER_ORDER[b.name.toLowerCase()] ?? 3;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name, 'zh');
    });
  }

  // Sort sub-folders for all industry workspaces
  for (const ws of industryWorkspaces) {
    sortSubFolders(ws.id);
  }

  // Group industry workspaces by big category for display
  const allMappedNames = new Set(INDUSTRY_CATEGORY_MAP.flatMap(c => c.subCategories.map(s => s.toLowerCase())));
  const industryByBigCategory: { label: string; icon: string; items: Workspace[] }[] = INDUSTRY_CATEGORY_MAP.map(cat => ({
    label: cat.label,
    icon: cat.icon,
    items: industryWorkspaces.filter(ws => cat.subCategories.some(s => s.toLowerCase() === ws.name.toLowerCase())),
  }));
  // Uncategorized industry workspaces (not in any big category mapping)
  const uncategorizedIndustry = industryWorkspaces.filter(ws => !allMappedNames.has(ws.name.toLowerCase()));
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

        {/* Sub-folders and canvases under folder (not for recent) */}
        {isExpanded && !isRecent && (
          <div className="ml-3">
            {/* Sub-folders (company folders under industry) */}
            {(subByParent.get(ws.id) || [])
              .filter(sub => !searchQuery || sub.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(sub => {
                const isSubActive = currentWorkspaceId === sub.id;
                const isSubExpanded = expandedFolders.has(sub.id);
                return (
                  <div key={sub.id}>
                    <div
                      className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isSubActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                      onClick={() => toggleFolder(sub.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(sub.id);
                        setRenameValue(sub.name);
                      }}
                      onContextMenu={(e) => handleContextMenu(e, sub.id)}
                    >
                      {isSubExpanded ? <ChevronDown size={10} className="shrink-0 text-slate-400" /> : <ChevronRight size={10} className="shrink-0 text-slate-400" />}
                      <Folder size={11} className="shrink-0 text-amber-300" />
                      {renamingId === sub.id ? (
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
                        <span className="flex-1 truncate">{sub.name}</span>
                      )}
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowNewCanvas(sub.id); }}
                          className="p-0.5 rounded hover:bg-slate-200"
                          title="新建画布"
                        >
                          <Plus size={10} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`删除「${sub.name}」？`)) deleteWorkspace(sub.id);
                          }}
                          className="p-0.5 rounded hover:bg-red-100 text-red-400"
                          title="删除"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    {/* Canvases under sub-folder — hidden when only 1 canvas (auto-selected) */}
                    {isSubExpanded && isSubActive && canvases.length > 1 && (
                      <div className="ml-4">
                        {showNewCanvas === sub.id && (
                          <div className="px-2 py-1">
                            <input
                              autoFocus
                              value={newCanvasName}
                              onChange={(e) => setNewCanvasName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreateCanvas(sub.id);
                                if (e.key === 'Escape') setShowNewCanvas(null);
                              }}
                              placeholder="画布名称..."
                              className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
                            />
                          </div>
                        )}
                        {canvases.map((canvas) => {
                          const isCurrent = currentCanvasId === canvas.id;
                          const isRenamingCanvas = renamingCanvasId === canvas.id;
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
                              <Palette size={10} className="shrink-0 text-violet-400" />
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
                                <span className="flex-1 truncate">{canvas.title}</span>
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
                        {canvases.length === 0 && !showNewCanvas && (
                          <div className="px-3 py-1 text-[10px] text-slate-400">暂无画布</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Direct canvases under this folder (if no sub-folders, or for top-level folders without children) */}
            {showNewCanvas === ws.id && (
              <div className="px-2 py-1">
                <input
                  autoFocus
                  value={newCanvasName}
                  onChange={(e) => setNewCanvasName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateCanvas(ws.id);
                    if (e.key === 'Escape') setShowNewCanvas(null);
                  }}
                  placeholder="画布名称..."
                  className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-400"
                />
              </div>
            )}

            {isActive && !(subByParent.get(ws.id) || []).length && canvases.length > 1 && canvases.map((canvas) => {
              const isCurrent = currentCanvasId === canvas.id;
              const isRenamingCanvas = renamingCanvasId === canvas.id;

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
                    <span className="flex-1 truncate">{canvas.title}</span>
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

            {isActive && !(subByParent.get(ws.id) || []).length && canvases.length === 0 && !showNewCanvas && (
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
          onClick={() => setShowNewWorkspace(true)}
          className="p-1 rounded hover:bg-slate-200 text-slate-400 shrink-0"
          title="新建文件夹"
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
                <div className="pb-1">
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
                <span className="text-[11px]">{bigCat.icon}</span>
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{bigCat.label}</span>
                <span className="text-[10px] text-slate-400 ml-auto">{bigCat.items.length}</span>
              </div>
              {!isBigCollapsed && (
                <div className="pb-1">
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
            onClick={() => handleSetCategory('overall')}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            <Globe size={12} /> 整体
          </button>
          <button
            onClick={() => handleSetCategory('personal')}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
          >
            <User size={12} /> 个人
          </button>
          <div className="border-t border-slate-100 my-1" />
          {INDUSTRY_CATEGORY_MAP.map(cat => (
            <button
              key={cat.label}
              onClick={() => {
                // Set category to industry so it shows under the right big category
                handleSetCategory('industry');
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              <span className="text-[11px]">{cat.icon}</span> {cat.label}
            </button>
          ))}
        </div>
      )}

      {!headerless && (
        <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
          {workspaces.length} 个文件夹
        </div>
      )}

      {/* Sync Dialog — only rendered when standalone (not headerless) */}
      {!headerless && <SyncDialog open={showSync} onClose={() => setShowSync(false)} />}
    </div>
  );
});
