import { memo, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar = memo(function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const currentCanvasId = useWorkspaceStore((s) => s.currentCanvasId);

  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const setCurrentCanvas = useWorkspaceStore((s) => s.setCurrentCanvas);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const createCanvas = useWorkspaceStore((s) => s.createCanvas);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const deleteCanvas = useWorkspaceStore((s) => s.deleteCanvas);

  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [showNewCanvas, setShowNewCanvas] = useState<string | null>(null);

  const toggleWorkspace = (id: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setCurrentWorkspace(id);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    const ws = await createWorkspace(newWorkspaceName.trim(), '📁');
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
    setExpandedWorkspaces((prev) => new Set(prev).add(ws.id));
    setCurrentWorkspace(ws.id);
  };

  const handleCreateCanvas = async (workspaceId: string) => {
    if (!newCanvasName.trim()) return;
    const canvas = await createCanvas(workspaceId, newCanvasName.trim());
    setNewCanvasName('');
    setShowNewCanvas(null);
    setCurrentCanvas(canvas.id);
  };

  return (
    <div
      className="flex flex-col h-full bg-slate-50 border-r border-slate-200 select-none shrink-0"
      style={{
        width: collapsed ? '48px' : '256px',
        transition: 'width 0.2s ease-in-out',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200" style={{ minHeight: '48px' }}>
        {!collapsed && (
          <h1 className="text-sm font-semibold text-slate-800 whitespace-nowrap">Research Canvas</h1>
        )}
        <div className="flex items-center gap-1" style={{ marginLeft: collapsed ? 'auto' : undefined, marginRight: collapsed ? 'auto' : undefined }}>
          {!collapsed && (
            <button
              onClick={() => setShowNewWorkspace(true)}
              className="p-1 rounded hover:bg-slate-200 text-slate-500"
              title="新建工作区"
            >
              <Plus size={16} />
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1 rounded hover:bg-slate-200 text-slate-400"
            title={collapsed ? '展开侧栏' : '折叠侧栏'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </div>

      {/* Collapsed: hide rest */}
      {collapsed ? null : (
        <>
          {/* New workspace input */}
          {showNewWorkspace && (
            <div className="px-3 py-2 border-b border-slate-200">
              <input
                autoFocus
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateWorkspace();
                  if (e.key === 'Escape') setShowNewWorkspace(false);
                }}
                placeholder="工作区名称..."
                className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:border-blue-400"
              />
            </div>
          )}

          {/* Workspace list */}
          <div className="flex-1 overflow-y-auto py-1">
            {workspaces.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                暂无工作区，点击 + 创建
              </div>
            )}
            {workspaces.map((ws) => {
              const isExpanded = expandedWorkspaces.has(ws.id);
              const isActive = currentWorkspaceId === ws.id;

              return (
                <div key={ws.id}>
                  {/* Workspace item */}
                  <div
                    className={`flex items-center gap-1 px-2 py-1.5 mx-1 rounded cursor-pointer group ${isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    onClick={() => toggleWorkspace(ws.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0" />
                    )}
                    <span className="text-sm truncate flex-1">{ws.name}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowNewCanvas(ws.id);
                        }}
                        className="p-0.5 rounded hover:bg-slate-200"
                        title="新建画布"
                      >
                        <Plus size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确定删除工作区「${ws.name}」及其所有画布？`)) {
                            deleteWorkspace(ws.id);
                          }
                        }}
                        className="p-0.5 rounded hover:bg-red-100 text-red-400"
                        title="删除工作区"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Canvas list under workspace */}
                  {isExpanded && (
                    <div className="ml-5">
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

                      {isActive &&
                        canvases.map((canvas) => (
                          <div
                            key={canvas.id}
                            onClick={() => setCurrentCanvas(canvas.id)}
                            className={`flex items-center gap-1.5 px-2 py-1 mx-1 rounded cursor-pointer group text-sm ${currentCanvasId === canvas.id
                                ? 'bg-blue-100 text-blue-800'
                                : 'text-slate-600 hover:bg-slate-100'
                              }`}
                          >
                            <span className="truncate flex-1">{canvas.title}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`确定删除画布「${canvas.title}」？`)) {
                                  deleteCanvas(canvas.id);
                                }
                              }}
                              className="hidden group-hover:block p-0.5 rounded hover:bg-red-100 text-red-400"
                              title="删除画布"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}

                      {isActive && canvases.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-400">暂无画布</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-slate-200 text-xs text-slate-400">
            {workspaces.length} 个工作区
          </div>
        </>
      )}
    </div>
  );
});
