import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Folder, Calendar, FileText } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { INDUSTRY_CATEGORY_MAP } from '../../constants/industryCategories.ts';
import { notesApi } from '../../db/apiClient.ts';
import type { Workspace } from '../../types/index.ts';

interface SourceFolderPickerProps {
  selectedWorkspaceIds: string[];
  dateFrom: string;
  dateTo: string;
  onChangeWorkspaces: (ids: string[]) => void;
  onChangeDateFrom: (date: string) => void;
  onChangeDateTo: (date: string) => void;
}

export const SourceFolderPicker = memo(function SourceFolderPicker({
  selectedWorkspaceIds,
  dateFrom,
  dateTo,
  onChangeWorkspaces,
  onChangeDateFrom,
  onChangeDateTo,
}: SourceFolderPickerProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedIndustries, setExpandedIndustries] = useState<Set<string>>(new Set());
  const [notesCount, setNotesCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  // Build workspace hierarchy
  const topLevel = useMemo(() => workspaces.filter(ws => !ws.parentId && (!ws.category || ws.category === 'industry')), [workspaces]);
  const subByParent = useMemo(() => {
    const map = new Map<string, Workspace[]>();
    for (const ws of workspaces) {
      if (ws.parentId) {
        const list = map.get(ws.parentId) || [];
        list.push(ws);
        map.set(ws.parentId, list);
      }
    }
    return map;
  }, [workspaces]);

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

  const selectedSet = useMemo(() => new Set(selectedWorkspaceIds), [selectedWorkspaceIds]);

  const toggleWs = useCallback((id: string) => {
    const next = new Set(selectedWorkspaceIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChangeWorkspaces([...next]);
  }, [selectedWorkspaceIds, onChangeWorkspaces]);

  const toggleIndustry = useCallback((ws: Workspace) => {
    const subs = subByParent.get(ws.id) || [];
    const allIds = [ws.id, ...subs.map(s => s.id)];
    const allSelected = allIds.every(id => selectedSet.has(id));
    const next = new Set(selectedWorkspaceIds);
    if (allSelected) {
      allIds.forEach(id => next.delete(id));
    } else {
      allIds.forEach(id => next.add(id));
    }
    onChangeWorkspaces([...next]);
  }, [selectedWorkspaceIds, selectedSet, subByParent, onChangeWorkspaces]);

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
    if (selectedWorkspaceIds.length === 0) {
      setNotesCount(null);
      return;
    }
    let cancelled = false;
    setCounting(true);
    notesApi.query(selectedWorkspaceIds, dateFrom || undefined, dateTo || undefined)
      .then(result => {
        if (!cancelled) setNotesCount(result.total);
      })
      .catch(() => { if (!cancelled) setNotesCount(null); })
      .finally(() => { if (!cancelled) setCounting(false); });
    return () => { cancelled = true; };
  }, [selectedWorkspaceIds, dateFrom, dateTo]);

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
                const subs = subByParent.get(ws.id) || [];
                const allIds = [ws.id, ...subs.map(s => s.id)];
                const someSelected = allIds.some(id => selectedSet.has(id));
                const allSelected = allIds.every(id => selectedSet.has(id));
                const isIndustryExpanded = expandedIndustries.has(ws.id);

                return (
                  <div key={ws.id}>
                    <div className="flex items-center gap-1 pl-5 pr-2 py-0.5 hover:bg-slate-50 text-[10px]">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={() => toggleIndustry(ws)}
                        className="shrink-0"
                      />
                      <div
                        className="flex items-center gap-1 flex-1 cursor-pointer min-w-0"
                        onClick={() => subs.length > 0 && toggleIndustryExpand(ws.id)}
                      >
                        {subs.length > 0 && (
                          isIndustryExpanded
                            ? <ChevronDown size={9} className="text-slate-400 shrink-0" />
                            : <ChevronRight size={9} className="text-slate-400 shrink-0" />
                        )}
                        <Folder size={10} className="text-amber-400 shrink-0" />
                        <span className="truncate text-slate-600">{ws.name}</span>
                      </div>
                    </div>
                    {isIndustryExpanded && subs.map(sub => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-1 pl-10 pr-2 py-0.5 hover:bg-slate-50 text-[10px]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSet.has(sub.id)}
                          onChange={() => toggleWs(sub.id)}
                          className="shrink-0"
                        />
                        <Folder size={9} className="text-amber-300 shrink-0" />
                        <span className="truncate text-slate-500">{sub.name}</span>
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
        {selectedWorkspaceIds.length === 0 ? (
          <span>未选择文件夹</span>
        ) : counting ? (
          <span>统计中...</span>
        ) : notesCount !== null ? (
          <span>匹配 {notesCount} 条笔记</span>
        ) : (
          <span>已选 {selectedWorkspaceIds.length} 个文件夹</span>
        )}
      </div>
    </div>
  );
});
