import { memo, useState, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  FolderOpen,
  Folder,
  PanelLeftClose,
  ChevronRight,
  ChevronDown,
  Palette,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface FolderColumnProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const FolderColumn = memo(function FolderColumn({ collapsed, onToggle }: FolderColumnProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const reorderWorkspaces = useWorkspaceStore((s) => s.reorderWorkspaces);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);
  const renameCanvas = useWorkspaceStore((s) => s.renameCanvas);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadCanvases = useWorkspaceStore((s) => s.loadCanvases);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showNewCanvas, setShowNewCanvas] = useState<string | null>(null);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const canvasRenameRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (renamingId && renameRef.current) { renameRef.current.focus(); renameRef.current.select(); }
  }, [renamingId]);

  useEffect(() => {
    if (renamingCanvasId && canvasRenameRef.current) { canvasRenameRef.current.focus(); canvasRenameRef.current.select(); }
  }, [renamingCanvasId]);

  // Auto-expand current workspace
  useEffect(() => {
    if (currentWorkspaceId) {
      setExpandedFolders((prev) => new Set(prev).add(currentWorkspaceId));
    }
  }, [currentWorkspaceId]);

  // Refresh on tab visible
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

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    const ws = await createWorkspace(newWorkspaceName.trim(), '📁');
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

  const filtered = searchQuery.trim()
    ? workspaces.filter((ws) => ws.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : workspaces;

  // Collapsed state: only show a thin strip with expand button
  if (collapsed) {
    return null; // MainLayout handles collapsed state for both columns
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 shrink-0" style={{ width: 200 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-slate-200 shrink-0">
        <span className="text-xs font-semibold text-slate-700">文件夹</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setShowNewWorkspace(true)} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="新建文件夹">
            <Plus size={14} />
          </button>
          <button onClick={onToggle} className="p-1 rounded hover:bg-slate-200 text-slate-400" title="折叠">
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-slate-100 shrink-0">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索..."
          className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400 bg-white"
        />
      </div>

      {/* New workspace input */}
      {showNewWorkspace && (
        <div className="px-2 py-1.5 border-b border-slate-100 shrink-0">
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
        </div>
      )}

      {/* Folder + Canvas tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-400">
            {searchQuery ? '无匹配' : '暂无文件夹'}
          </div>
        )}
        {filtered.map((ws, index) => {
          const isActive = currentWorkspaceId === ws.id;
          const isExpanded = expandedFolders.has(ws.id);
          const isRenaming = renamingId === ws.id;

          return (
            <div
              key={ws.id}
              draggable={!isRenaming}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => { e.preventDefault(); setDropIndex(index); }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) reorderWorkspaces(dragIndex, index);
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
              style={{
                opacity: dragIndex === index ? 0.4 : 1,
                borderTop: dropIndex === index && dragIndex !== null && dragIndex !== index ? '2px solid #3b82f6' : '2px solid transparent',
              }}
            >
              {/* Folder row */}
              <div
                className={`flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer group text-xs ${isActive ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-100'}`}
                onClick={() => toggleFolder(ws.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(ws.id);
                  setRenameValue(ws.name);
                }}
              >
                {isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
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
                {!isRenaming && (
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

              {/* Canvas list under folder */}
              {isExpanded && (
                <div className="ml-4">
                  {/* New canvas input */}
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

                  {isActive && canvases.map((canvas) => {
                    const isCurrent = currentCanvasId === canvas.id;
                    const isRenamingCanvas = renamingCanvasId === canvas.id;

                    return (
                      <div
                        key={canvas.id}
                        className={`flex items-center gap-1 px-2 py-1 mx-1 rounded cursor-pointer group text-xs ${isCurrent ? 'bg-blue-100 text-blue-800 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
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

                  {isActive && canvases.length === 0 && !showNewCanvas && (
                    <div className="px-3 py-1 text-[10px] text-slate-400">暂无画布</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-2 py-1.5 border-t border-slate-200 text-[10px] text-slate-400 shrink-0">
        {workspaces.length} 个文件夹
      </div>
    </div>
  );
});
