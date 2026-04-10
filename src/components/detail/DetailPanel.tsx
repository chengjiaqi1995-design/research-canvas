import { memo, useMemo, useState, useCallback, useEffect, Suspense } from 'react';
import { X, Loader2, ArrowRightLeft, Edit2, Database } from 'lucide-react';
import { Modal, Input } from 'antd';
import { useCanvasStore } from '../../stores/canvasStore.ts';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { canvasApi, aiApi } from '../../db/apiClient.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import { useTrackerStore } from '../../stores/trackerStore.ts';
import type { TrackerInboxItem } from '../../types/index.ts';
import { generateId } from '../../utils/id.ts';
import { lazyWithRetry } from '../../utils/lazyWithRetry.ts';
import { CanvasMetadataEditor } from './CanvasMetadataEditor.tsx';

const NoteEditor = lazyWithRetry(() =>
  import('./NoteEditor.tsx').then((m) => ({ default: m.NoteEditor })), 'NoteEditor'
);
const SpreadsheetEditor = lazyWithRetry(() =>
  import('./SpreadsheetEditor.tsx').then((m) => ({ default: m.SpreadsheetEditor })), 'SpreadsheetEditor'
);
const PdfNode = lazyWithRetry(() =>
  import('../nodes/PdfNode.tsx').then((m) => ({ default: m.PdfNode })), 'PdfNode'
);
const HtmlViewer = lazyWithRetry(() =>
  import('./HtmlViewer.tsx').then((m) => ({ default: m.HtmlViewer })), 'HtmlViewer'
);

export const DetailPanel = memo(function DetailPanel() {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const nodes = useCanvasStore((s) => s.nodes);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, nodes]);

  const currentCanvasId = useCanvasStore((s) => s.currentCanvasId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  // Title editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');

  // Move to canvas state
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [allCanvases, setAllCanvases] = useState<any[]>([]);
  const [moveSearch, setMoveSearch] = useState('');
  const [moving, setMoving] = useState(false);
  const [loadingCanvases, setLoadingCanvases] = useState(false);

  // Metadata editing state
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editMetadataValues, setEditMetadataValues] = useState<Record<string, string>>({});

  // Tracker extraction state
  const trackers = useTrackerStore((s) => s.trackers);
  const addInboxItem = useTrackerStore((s) => s.addInboxItem);
  const loadTrackerData = useTrackerStore((s) => s.loadData);
  const [isExtracting, setIsExtracting] = useState(false);

  useEffect(() => {
    // Make sure we have the latest trackers loaded when rendering DetailPanel
    loadTrackerData();
  }, [loadTrackerData]);

  useEffect(() => {
    if (showMoveMenu) {
      setLoadingCanvases(true);
      setMoveSearch('');
      canvasApi.list(undefined, true).then(c => { setAllCanvases(c || []); setLoadingCanvases(false); }).catch(() => setLoadingCanvases(false));
      // Close on outside click
      const handler = () => setShowMoveMenu(false);
      setTimeout(() => document.addEventListener('click', handler), 0);
      return () => document.removeEventListener('click', handler);
    }
  }, [showMoveMenu]);

  const handleMoveNode = useCallback(async (targetCanvasId: string, targetCanvasTitle: string) => {
    if (!selectedNode || !currentCanvasId || moving) return;
    setMoving(true);
    try {
      // Strip ticker prefix like "[6324 JP] Harmonic..." → "Harmonic..."
      const companyName = targetCanvasTitle.replace(/^\[.*?\]\s*/, '') || targetCanvasTitle;
      await canvasApi.moveNode(selectedNode.id, currentCanvasId, targetCanvasId, companyName);
      // Remove from local state
      const removeNode = useCanvasStore.getState().removeNode;
      removeNode(selectedNode.id);
      setShowMoveMenu(false);
    } catch (err: any) {
      alert(`移动失败: ${err.message}`);
    }
    setMoving(false);
  }, [selectedNode, currentCanvasId, moving]);

  const handleStartEditTitle = useCallback(() => {
    if (selectedNode) {
      setEditTitle(selectedNode.data.title || '');
      setIsEditingTitle(true);
    }
  }, [selectedNode]);

  const handleSaveTitle = useCallback(() => {
    if (editTitle.trim() && selectedNode) {
      updateNodeData(selectedNode.id, { title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  }, [editTitle, selectedNode, updateNodeData]);

  const handleExtractToTracker = useCallback(async () => {
    if (!selectedNode || isExtracting) return;
    
    const schemaDesc = trackers.map(t => {
      const eNames = t.entities?.map(e => e.name).join(', ') || '';
      const cNames = t.columns?.map(c => c.name).join(', ') || '';
      return `【看板：${t.name}】包括实体：[${eNames}]，包括指标：[${cNames}]`;
    }).join('\n');

    const config = getApiConfig();
    const model = config.summaryModel || 'gemini-3-flash-preview';

    const nodeData = selectedNode.data as any;
    const textContent = 
      nodeData.content || 
      nodeData.summary || 
      nodeData.text || 
      nodeData.title;

    if (!textContent || textContent.length < 10) {
      alert('抱歉，节点内容过短，无法提取数据。');
      return;
    }

    setIsExtracting(true);
    let rawJsonStr = '';

    const systemPrompt = `你是一个强大的情报分析专家。请仔细阅读用户提供的文本材料，并将文本段落中涉及到的行业、公司或者特定指标的重要数据提取出来。

当前系统中已经配置了以下监控看板：
${schemaDesc}

请识别出：
1. targetCompany（必须是你能在上面的配置里找到的相关实体名字，或者是文本里明确提到的一家公司/机构名）
2. targetMetric（必须是你能在上面的配置里找到的相关指标名字，或者是文本里明确提到的某个数据指标）
3. extractedValue（提取出的具体数字，可以带单位，比如 1.8亿。如果是字符串请保留）
4. timePeriod（文本里提及的数据时间，如 "2026-Q2"、"2026-05"、"本季度" 等。如果没有提及留空）
5. content（包含这个数据的那句原文，用来作为后续人工校验的依据）

只返回一个符合下面 JSON Array 格式的纯 JSON，不要包含任何 markdown 或外层包裹标记：
[
  {
    "targetCompany": "string",
    "targetMetric": "string",
    "extractedValue": "number or string",
    "timePeriod": "string",
    "content": "string"
  }
]
如果没有发现任何相关指标对应的数据，返回 []`;

    try {
      for await (const event of aiApi.chatStream({
        model,
        messages: [{ role: 'user', content: `需提取的文献：\n${textContent}` }],
        systemPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          rawJsonStr += event.content;
        }
      }

      let cleanJson = rawJsonStr.trim();
      if (cleanJson.startsWith('```json')) cleanJson = cleanJson.substring(7);
      if (cleanJson.startsWith('```')) cleanJson = cleanJson.substring(3);
      if (cleanJson.endsWith('```')) cleanJson = cleanJson.substring(0, cleanJson.length - 3);
      cleanJson = cleanJson.trim();

      const extractedItems = JSON.parse(cleanJson);
      
      if (!Array.isArray(extractedItems) || extractedItems.length === 0) {
        throw new Error('未提取到任何相关监控数据。');
      }

      for (const item of extractedItems) {
        const inboxItem: TrackerInboxItem = {
          id: `inbox_${generateId()}`,
          source: 'canvas',
          content: item.content || '无原文引用',
          targetCompany: item.targetCompany || '未知实体',
          targetMetric: item.targetMetric || '未知指标',
          extractedValue: item.extractedValue || 0,
          timePeriod: item.timePeriod || '',
          timestamp: Date.now()
        };
        await addInboxItem(inboxItem);
      }

      alert(`提取成功！共发掘 ${extractedItems.length} 条数据，已推送至行业看板进行入库审核。`);
    } catch (e: any) {
      alert('提取结果: ' + e.message);
    } finally {
      setIsExtracting(false);
    }
  }, [selectedNode, trackers, isExtracting, addInboxItem]);

  if (!selectedNode) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        点击画布上的节点查看详情
      </div>
    );
  }

  const tags = (selectedNode.data as any).tags as string[] | undefined;
  const showTags = (selectedNode.data.type === 'markdown' || selectedNode.data.type === 'text') && Array.isArray(tags) && tags.length > 0;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Panel header */}
      <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center justify-between gap-2">
          {/* Editable title */}
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                onBlur={handleSaveTitle}
                className="w-full text-sm font-medium border-b-2 border-blue-400 outline-none pb-0.5 bg-transparent text-slate-700"
              />
            ) : (
              <span
                className="text-sm font-medium text-slate-700 truncate block cursor-pointer hover:text-blue-600 transition-colors"
                onClick={handleStartEditTitle}
                title="点击编辑标题"
              >
                {selectedNode.data.title}
              </span>
            )}
          </div>
          {/* Tags in header, right side */}
          {showTags && (
            <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
              {tags!.map((tag, idx) => (
                <span key={idx} className="group inline-flex items-center gap-0.5 bg-gray-100/80 text-gray-500 border border-gray-200 rounded-full pl-2 pr-1 py-0.5 text-[10px] font-medium hover:bg-gray-200">
                  <span
                    className="outline-none min-w-[16px] cursor-text border-b border-transparent focus:border-gray-400"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      const newVal = e.currentTarget.textContent || '';
                      const newTags = [...tags!];
                      if (newVal.trim() === '') {
                        newTags.splice(idx, 1);
                      } else {
                        newTags[idx] = newVal.trim();
                      }
                      if (JSON.stringify(newTags) !== JSON.stringify(tags)) {
                        updateNodeData(selectedNode.id, { tags: newTags });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  >
                    {tag}
                  </span>
                  <button
                    onClick={() => {
                      const newTags = [...tags!];
                      newTags.splice(idx, 1);
                      updateNodeData(selectedNode.id, { tags: newTags });
                    }}
                    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-3 h-3 rounded-full hover:bg-gray-300 text-gray-400 hover:text-gray-600 transition-all cursor-pointer"
                    title="删除标签"
                  >
                    x
                  </button>
                </span>
              ))}
              <button
                onClick={() => {
                  const newTags = [...(tags || []), '新标签'];
                  updateNodeData(selectedNode.id, { tags: newTags });
                }}
                className="inline-flex items-center text-gray-400 border border-gray-200 border-dashed rounded-full px-1.5 py-0.5 text-[10px] hover:bg-gray-100 hover:text-gray-600 cursor-pointer"
                title="添加标签"
              >
                +
              </button>
            </div>
          )}
          {/* Move to canvas and Extract */}
          <div className="relative flex-shrink-0 flex items-center gap-1">
            <button
              onClick={handleExtractToTracker}
              disabled={isExtracting}
              className="px-2 py-1 flex items-center gap-1 text-[11px] font-medium rounded text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors disabled:opacity-50"
              title="一键提取数据进入行业看板草稿箱"
            >
              {isExtracting ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
              提取入库
            </button>
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="p-1 rounded hover:bg-slate-200 text-slate-400"
              title="移动到其他画布"
            >
              <ArrowRightLeft size={14} />
            </button>
            {showMoveMenu && (
              <div
                className="absolute right-0 top-8 w-[300px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-[450px] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Search input */}
                <div className="px-2 py-2 border-b border-slate-100 shrink-0">
                  <input
                    autoFocus
                    value={moveSearch}
                    onChange={(e) => setMoveSearch(e.target.value)}
                    placeholder="搜索画布名或工作区名..."
                    className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400"
                  />
                </div>
                {/* Canvas list */}
                <div className="flex-1 overflow-y-auto">
                  {loadingCanvases ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-400">
                      <Loader2 size={14} className="animate-spin inline mr-1" />加载中...
                    </div>
                  ) : (() => {
                    const wsById = new Map(workspaces.map(w => [w.id, w]));
                    const query = moveSearch.trim().toLowerCase();
                    const grouped = new Map<string, { wsName: string; canvases: any[] }>();
                    for (const c of allCanvases) {
                      if (c.id === currentCanvasId) continue;
                      const ws = wsById.get(c.workspaceId);
                      const wsName = String(ws?.name || '未知');
                      const title = String(c.title || c.id || '');
                      // Filter by search
                      if (query && !title.toLowerCase().includes(query) && !wsName.toLowerCase().includes(query)) continue;
                      if (!grouped.has(c.workspaceId)) {
                        grouped.set(c.workspaceId, { wsName, canvases: [] });
                      }
                      grouped.get(c.workspaceId)!.canvases.push(c);
                    }
                    const entries = [...grouped.entries()].sort((a, b) => {
                      if (a[0] === currentWorkspaceId) return -1;
                      if (b[0] === currentWorkspaceId) return 1;
                      return a[1].wsName.localeCompare(b[1].wsName);
                    });
                    if (entries.length === 0) {
                      return <div className="px-3 py-4 text-center text-xs text-slate-400">无匹配画布</div>;
                    }
                    return entries.map(([wsId, { wsName, canvases }]) => (
                      <div key={wsId}>
                        <div className="px-3 py-1 text-[10px] text-slate-500 font-medium bg-slate-50 sticky top-0">
                          {wsName} {wsId === currentWorkspaceId && '(当前)'}
                        </div>
                        {canvases.map(c => (
                          <button
                            key={c.id}
                            onClick={() => handleMoveNode(c.id, c.title || c.id)}
                            disabled={moving}
                            className="w-full text-left px-4 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 truncate"
                          >
                            {c.title || c.id}
                          </button>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => selectNode(null)}
            className="p-1 rounded hover:bg-slate-200 text-slate-400 flex-shrink-0"
            title="关闭面板"
          >
            <X size={16} />
          </button>
        </div>
        {/* Metadata info strip — dot separated compact view */}
        {(() => {
          const meta = ((selectedNode.data as any).metadata as Record<string, string> | undefined) || {};
          // Group English and Chinese equivalents so we only take one instance of each piece of metadata
          const fieldGroups = [
            ['organization', '公司'],
            ['speaker', '演讲人'],
            ['industry', '行业'],
            ['participants', '参与人'],
            ['intermediary', '中介'],
            ['country', '国家'],
            ['eventDate', '发生日期'],
            ['createdAt', '创建时间']
          ];
          
          const activeValues: string[] = [];
          for (const group of fieldGroups) {
            for (const key of group) {
              if (meta[key]) {
                activeValues.push(meta[key]);
                break;
              }
            }
          }

          // 只在 Markdown/Text 类型笔记上允许编辑元数据
          const canEditMeta = selectedNode.data.type === 'markdown' || selectedNode.data.type === 'text';
          if (activeValues.length === 0 && !canEditMeta) return null;

          return (
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-400 mt-1 min-h-[16px] group">
              {activeValues.map((val, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-slate-300 mr-1.5">·</span>}
                  <span className="hover:text-blue-500 transition-colors">{val}</span>
                </span>
              ))}
              {canEditMeta && (
                <button
                  onClick={() => {
                    setEditMetadataValues(meta);
                    setIsEditingMetadata(true);
                  }}
                  className={`p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-blue-500 transition-colors ${activeValues.length === 0 ? 'opacity-0 group-hover:opacity-100' : 'ml-1'}`}
                  title="编辑元数据"
                >
                  <Edit2 size={12} />
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {isEditingMetadata && (
        <CanvasMetadataEditor
          initialMetadata={editMetadataValues}
          textContent={(selectedNode.data as any).content || (selectedNode.data as any).summary || (selectedNode.data as any).text || (selectedNode.data as any).title || ''}
          createdAt={(selectedNode.data as any).createdAt || Date.now()}
          onSave={(newMetadata) => {
            const oldMeta = (selectedNode.data as any).metadata || {};
            updateNodeData(selectedNode.id, { metadata: { ...oldMeta, ...newMetadata } });
            setIsEditingMetadata(false);
          }}
          onClose={() => setIsEditingMetadata(false)}
        />
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="animate-spin mr-2" size={16} />加载中...</div>}>
          {selectedNode.data.type === 'text' && (
            <NoteEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'table' && (
            <SpreadsheetEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'pdf' && (
            <PdfNode key={selectedNode.id} data={selectedNode.data} />
          )}
          {selectedNode.data.type === 'html' && (
            <HtmlViewer key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data as import('../../types/index.ts').HtmlNodeData} />
          )}
          {selectedNode.data.type === 'markdown' && (
            <NoteEditor key={selectedNode.id} nodeId={selectedNode.id} data={selectedNode.data as import('../../types/index.ts').MarkdownNodeData} />
          )}
        </Suspense>
      </div>
    </div>
  );
});
