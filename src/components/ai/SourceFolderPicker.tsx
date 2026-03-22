import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, Calendar, FileText } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { INDUSTRY_CATEGORY_MAP } from '../../constants/industryCategories.ts';
import { canvasApi, notesApi } from '../../db/apiClient.ts';
import type { Workspace, Canvas } from '../../types/index.ts';

interface SourceFolderPickerProps {
  selectedWorkspaceIds: string[];
  selectedCanvasIds?: string[];
  dateFrom: string;
  dateTo: string;
  onChangeWorkspaces: (ids: string[]) => void;
  onChangeCanvases?: (ids: string[]) => void;
  onChangeDateFrom: (date: string) => void;
  onChangeDateTo: (date: string) => void;
}

export const SourceFolderPicker = memo(function SourceFolderPicker({
  selectedWorkspaceIds,
  selectedCanvasIds = [],
  dateFrom,
  dateTo,
  onChangeWorkspaces,
  onChangeCanvases,
  onChangeDateFrom,
  onChangeDateTo,
}: SourceFolderPickerProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [allCanvases, setAllCanvases] = useState<Canvas[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set());
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    canvasApi.list().then(setAllCanvases).catch(console.error);
  }, []);

  // Build workspace hierarchy
  const topLevel = useMemo(() => workspaces.filter(ws => (!ws.category || ws.category === 'industry' || ws.category === 'overall' || ws.category === 'personal')), [workspaces]);
  
  const canvasesByWs = useMemo(() => {
    const map = new Map<string, Canvas[]>();
    for (const c of allCanvases) {
      const list = map.get(c.workspaceId) || [];
      list.push(c);
      map.set(c.workspaceId, list);
    }
    return map;
  }, [allCanvases]);

  // Group by big category
  const bigCategories = useMemo(() => {
    const allMapped = new Set(INDUSTRY_CATEGORY_MAP.flatMap(c => c.subCategories.map(s => s.toLowerCase())));
    const cats = INDUSTRY_CATEGORY_MAP.map(cat => ({
      label: cat.label,
      icon: cat.icon,
      industries: topLevel.filter(ws => cat.subCategories.some(s => s.toLowerCase() === ws.name.toLowerCase())),
    }));
    const uncategorized = topLevel.filter(ws => !allMapped.has(ws.name.toLowerCase()));
    if (uncategorized.length > 0) {
      cats.push({ label: '未分大类', icon: '📁', industries: uncategorized });
    }
    return cats.filter(c => c.industries.length > 0);
  }, [topLevel]);

  const selectedWsSet = useMemo(() => new Set(selectedWorkspaceIds), [selectedWorkspaceIds]);
  const selectedCanvasSet = useMemo(() => new Set(selectedCanvasIds), [selectedCanvasIds]);

  const toggleCanvas = useCallback((id: string) => {
    if (!onChangeCanvases) return;
    const next = new Set(selectedCanvasIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChangeCanvases([...next]);
  }, [selectedCanvasIds, onChangeCanvases]);

  const toggleIndustry = useCallback((ws: Workspace) => {
    const canvases = canvasesByWs.get(ws.id) || [];
    const canvasIds = canvases.map(c => c.id);
    
    const wsSelected = selectedWsSet.has(ws.id);
    const allCanvasesSelected = canvasIds.length > 0 && canvasIds.every(id => selectedCanvasSet.has(id));
    
    // If workspace is selected, unselect it.
    // If it's not selected, we select the workspace (which implies all its canvases).
    const nextWs = new Set(selectedWorkspaceIds);
    const nextCanvases = new Set(selectedCanvasIds);

    if (wsSelected || allCanvasesSelected) {
      nextWs.delete(ws.id);
      canvasIds.forEach(id => nextCanvases.delete(id));
    } else {
      nextWs.add(ws.id);
      canvasIds.forEach(id => nextCanvases.add(id));
    }
    
    onChangeWorkspaces([...nextWs]);
    if (onChangeCanvases) onChangeCanvases([...nextCanvases]);
  }, [selectedWorkspaceIds, selectedCanvasIds, selectedWsSet, selectedCanvasSet, canvasesByWs, onChangeWorkspaces, onChangeCanvases]);

  const toggleCat = useCallback((catLabel: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(catLabel)) next.delete(catLabel); else next.add(catLabel);
      return next;
    });
  }, []);

  const toggleIndustryExpand = useCallback((id: string) => {
    setExpandedIndustries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Count matching notes when selection changes
  useEffect(() => {
    if (selectedWorkspaceIds.length === 0 && selectedCanvasIds.length === 0) {
      setNotesCount(null);
      return;
    }
    let cancelled = false;
    setCounting(true);
    notesApi.query(selectedWorkspaceIds, selectedCanvasIds, dateFrom || undefined, dateTo || undefined)
      .then(result => {
        if (!cancelled) setNotesCount(result.total);
      })
      .catch(() => { if (!cancelled) setNotesCount(null); })
      .finally(() => { if (!cancelled) setCounting(false); });
    return () => { cancelled = true; };
  }, [selectedWorkspaceIds, selectedCanvasIds, dateFrom, dateTo]);

  return (
    <div className="space-y-2">
      {/* Date range */}
      <div className="flex items-center gap-2">
        <Calendar size={11} className="text-slate-400 shrink-0" />
        <input
          type="date"
          value={dateFrom}
          onChange={e => onChangeDateFrom(e.target.value)}
          className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-violet-400"
          placeholder="开始日期"
        />
        <span className="text-[10px] text-slate-400">~</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => onChangeDateTo(e.target.value)}
          className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-violet-400"
          placeholder="结束日期"
        />
      </div>

      {/* Folder tree */}
      <div className="border border-slate-200 rounded-lg max-h-[240px] overflow-y-auto">
        {bigCategories.map(cat => {
          const isExpanded = expandedCats.has(cat.label);
          return (
            <div key={cat.label}>
              <div
                className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-slate-50 text-[11px]"
                onClick={() => toggleCat(cat.label)}
              >
                {isExpanded
                  ? <ChevronDown size={10} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={10} className="text-slate-400 shrink-0" />
                }
                <span>{cat.icon}</span>
                <span className="font-medium text-slate-600">{cat.label}</span>
              </div>
              {isExpanded && cat.industries.map(ws => {
                const canvases = canvasesByWs.get(ws.id) || [];
                const canvasIds = canvases.map(c => c.id);
                
                const isWsSelected = selectedWsSet.has(ws.id);
                const someCanvasesSelected = canvasIds.some(id => selectedCanvasSet.has(id));
                const allCanvasesSelected = canvasIds.length > 0 && canvasIds.every(id => selectedCanvasSet.has(id));
                
                const isSelected = isWsSelected || allCanvasesSelected;
                const isIndeterminate = !isSelected && someCanvasesSelected;
                const isIndustryExpanded = expandedIndustries.has(ws.id);

                return (
                  <div key={ws.id}>
                    <div className="flex items-center gap-1 pl-5 pr-2 py-0.5 hover:bg-slate-50 text-[10px]">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                        onChange={() => toggleIndustry(ws)}
                        className="shrink-0"
                      />
                      <div
                        className="flex items-center gap-1 flex-1 cursor-pointer min-w-0"
                        onClick={() => canvases.length > 0 && toggleIndustryExpand(ws.id)}
                      >
                        {canvases.length > 0 && (
                          isIndustryExpanded
                            ? <ChevronDown size={9} className="text-slate-400 shrink-0" />
                            : <ChevronRight size={9} className="text-slate-400 shrink-0" />
                        )}
                        <Folder size={10} className="text-amber-400 shrink-0" />
                        <span className="truncate text-slate-600">{ws.name}</span>
                      </div>
                    </div>
                    {isIndustryExpanded && canvases.map(canvas => (
                      <div
                        key={canvas.id}
                        className="flex items-center gap-1 pl-10 pr-2 py-0.5 hover:bg-slate-50 text-[10px]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCanvasSet.has(canvas.id) || isWsSelected}
                          disabled={isWsSelected}
                          onChange={() => toggleCanvas(canvas.id)}
                          className="shrink-0"
                        />
                        <FileText size={9} className="text-violet-400 shrink-0" />
                        <span className="truncate text-slate-500">{canvas.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Notes count preview */}
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        <FileText size={10} />
        {selectedWorkspaceIds.length === 0 && selectedCanvasIds.length === 0 ? (
          <span>未选择范围</span>
        ) : counting ? (
          <span>统计中...</span>
        ) : notesCount !== null ? (
          <span>匹配 {notesCount} 条笔记</span>
        ) : (
          <span>已选 {selectedWorkspaceIds.length} 个文件夹, {selectedCanvasIds.length} 个画布</span>
        )}
      </div>
    </div>
  );
});
