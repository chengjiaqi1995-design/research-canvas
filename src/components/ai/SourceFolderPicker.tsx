import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, Calendar, FileText } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore.ts';
import { resolveIcon } from '../../constants/industryCategories.ts';
import { canvasApi, notesApi } from '../../db/apiClient.ts';
import type { Workspace, Canvas } from '../../types/index.ts';

interface SourceFolderPickerProps {
  selectedWorkspaceIds: string[];
  selectedCanvasIds?: string[];
  dateFrom: string;
  dateTo: string;
  dateField: 'occurred' | 'created';
  onChangeWorkspaces: (ids: string[]) => void;
  onChangeCanvases?: (ids: string[]) => void;
  onChangeDateFrom: (date: string) => void;
  onChangeDateTo: (date: string) => void;
  onChangeDateField: (field: 'occurred' | 'created') => void;
}

export const SourceFolderPicker = memo(function SourceFolderPicker({
  selectedWorkspaceIds,
  selectedCanvasIds = [],
  dateFrom,
  dateTo,
  dateField,
  onChangeWorkspaces,
  onChangeCanvases,
  onChangeDateFrom,
  onChangeDateTo,
  onChangeDateField,
}: SourceFolderPickerProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [allCanvases, setAllCanvases] = useState<Canvas[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set());
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [matchedNotes, setMatchedNotes] = useState<{id: string, title: string, workspaceName: string, date: string | null}[]>([]);
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

  const industryCategories = useIndustryCategoryStore((s) => s.categories);

  // Group by big category
  const bigCategories = useMemo(() => {
    const allMapped = new Set(industryCategories.flatMap(c => c.subCategories.map(s => s.toLowerCase())));
    const cats = industryCategories.map(cat => ({
      label: cat.label,
      icon: resolveIcon(cat.icon),
      industries: topLevel.filter(ws =>
        ws.industryCategory === cat.label ||
        (!ws.industryCategory && cat.subCategories.some(s => s.toLowerCase() === ws.name.toLowerCase()))
      ),
    }));
    const uncategorized = topLevel.filter(ws => !ws.industryCategory && !allMapped.has(ws.name.toLowerCase()));
    if (uncategorized.length > 0) {
      cats.push({ label: '未分大类', icon: '📁' as any, industries: uncategorized });
    }
    return cats.filter(c => c.industries.length > 0);
  }, [topLevel, industryCategories]);

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
    const hasSelection = selectedWorkspaceIds.length > 0 || selectedCanvasIds.length > 0;
    const hasDateFilter = !!dateFrom || !!dateTo;
    if (!hasSelection && !hasDateFilter) {
      setNotesCount(null);
      setMatchedNotes([]);
      return;
    }
    let cancelled = false;
    setCounting(true);
    notesApi.query(selectedWorkspaceIds, selectedCanvasIds, dateFrom || undefined, dateTo || undefined, dateField)
      .then(result => {
        if (!cancelled) {
            setNotesCount(result.total);
            setMatchedNotes(result.notes || []);
        }
      })
      .catch(() => { if (!cancelled) { setNotesCount(null); setMatchedNotes([]); } })
      .finally(() => { if (!cancelled) setCounting(false); });
    return () => { cancelled = true; };
  }, [selectedWorkspaceIds, selectedCanvasIds, dateFrom, dateTo, dateField]);

  return (
    <div className="flex flex-col h-full gap-2.5 min-h-0">
      {/* Date field selector + date range */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <Calendar size={11} className="text-slate-400 shrink-0" />
          <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded">
            <button
              onClick={() => onChangeDateField('occurred')}
              className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                dateField === 'occurred'
                  ? 'bg-white text-blue-900 shadow-sm font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              发生日期
            </button>
            <button
              onClick={() => onChangeDateField('created')}
              className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                dateField === 'created'
                  ? 'bg-white text-blue-900 shadow-sm font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              创建时间
            </button>
          </div>
          <input
            type="date"
            value={dateFrom}
            onChange={e => onChangeDateFrom(e.target.value)}
            className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-amber-500"
            placeholder="开始日期"
          />
          <span className="text-[10px] text-slate-400">~</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => onChangeDateTo(e.target.value)}
            className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:border-amber-500"
            placeholder="结束日期"
          />
        </div>
      </div>

      {/* Folder tree */}
      <div className="border border-slate-200 rounded max-h-[140px] shrink-0 overflow-y-auto custom-scrollbar">
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
                <span className="text-slate-500 mt-0.5 shrink-0 flex items-center justify-center w-3 h-3">
                  {typeof cat.icon === 'string' ? cat.icon : <cat.icon size={12} />}
                </span>
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
                        <Folder size={10} className="text-amber-500 shrink-0" />
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
                        <FileText size={9} className="text-amber-500 shrink-0" />
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
      <div className="flex-1 min-h-0 flex flex-col border border-slate-200 rounded overflow-hidden bg-slate-50/30">
        <div className="px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                <FileText size={11} className="text-amber-600" />
                包含笔记 {notesCount !== null ? `(${notesCount})` : ''}
            </span>
            {counting && <span className="text-[10px] text-amber-600 animate-pulse">检索中...</span>}
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
            {selectedWorkspaceIds.length === 0 && selectedCanvasIds.length === 0 && !dateFrom && !dateTo ? (
                <div className="flex flex-col items-center justify-center h-full text-[10px] text-slate-400 py-4">
                    在上方选择日期或勾选行业以预览笔记
                </div>
            ) : matchedNotes.length === 0 && !counting ? (
                <div className="flex flex-col items-center justify-center h-full text-[10px] text-slate-400 py-4">
                    当前范围无匹配笔记
                </div>
            ) : (
                matchedNotes.map(note => (
                    <div key={note.id} className="flex items-center justify-between px-2 py-1.5 hover:bg-white rounded border border-transparent hover:border-slate-200 hover:shadow-sm transition-all group">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <FileText size={10} className="text-slate-400 group-hover:text-amber-600 shrink-0 transition-colors" />
                            <span className="text-[11px] text-slate-700 truncate font-medium" title={note.title}>{note.title}</span>
                        </div>
                        <span className="text-[9px] text-slate-400 shrink-0 ml-2 max-w-[80px] truncate" title={note.workspaceName}>{note.date || note.workspaceName}</span>
                    </div>
                ))
            )}
        </div>
      </div>
    </div>
  );
});
