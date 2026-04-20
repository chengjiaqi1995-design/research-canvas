import { memo, useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import { useIndustryCategoryStore } from '../../stores/industryCategoryStore.ts';
import * as XLSX from 'xlsx';
import { generateId } from '../../utils/id.ts';
import { 
  BarChart2, Filter, Upload, Plus, Calendar, Clock, 
  Activity, Check, X, AlertCircle, RefreshCw, Loader2, Settings,
  MessageSquare, Users, BookOpen, ChevronDown, AlignLeft, Bot
} from 'lucide-react';
import { useTrackerStore } from '../../stores/trackerStore.ts';
import { aiApi, canvasApi } from '../../db/apiClient.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import type { Tracker, TrackerInboxItem, TrackerColumn, TrackerEntity, TrackerRecord } from '../../types/index.ts';
import React from 'react';
import { TrackerAIModal } from './TrackerAIModal.tsx';
import { IndustryWikiConsole } from './IndustryWikiConsole.tsx';
import { PageHeader, SegmentedToggle, IconButton, PrimaryButton } from '../ui/index.ts';

interface PivotRowItem {
  id: string; // unique key
  moduleType: 'data' | 'company' | 'expert';
  trackerName: string;
  columnName: string;
  cells: Record<string, string | number>;
}

interface PivotRow {
  entityName: string;
  items: PivotRowItem[];
}


export const TrackerView = memo(function TrackerView() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const inboxItems = useTrackerStore((s) => s.inboxItems);
  const trackers = useTrackerStore((s) => s.trackers);
  const loadData = useTrackerStore((s) => s.loadData);
  const removeInboxItem = useTrackerStore((s) => s.removeInboxItem);
  const addOrUpdateTracker = useTrackerStore((s) => s.addOrUpdateTracker);
  const [timeView, setTimeView] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [subView, setSubView] = useState<'matrix' | 'wiki'>('wiki');
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [wikiScopeId, setWikiScopeId] = useState<string>('industry');

  const handleConfirmInboxItem = async (item: TrackerInboxItem) => {
    const effectiveWorkspaceId = matchingWorkspaceIds[0] || (activeSubCategoryName && activeSubCategoryName.length > 0 ? activeSubCategoryName : 'default');

    // 1. Try to find a matching tracker in the current active industry
    let targetTracker = trackers.find(t => 
      t.workspaceId === effectiveWorkspaceId &&
      (t.entities?.some(e => e.name.toLowerCase().includes(item.targetCompany.toLowerCase())) || 
       t.name.toLowerCase().includes(item.targetCompany.toLowerCase()))
    );

    // 2. Try to find ANY matching tracker globally if not found in current industry
    if (!targetTracker) {
      targetTracker = trackers.find(t => 
        t.entities?.some(e => e.name.toLowerCase().includes(item.targetCompany.toLowerCase())) || 
        t.name.toLowerCase().includes(item.targetCompany.toLowerCase())
      );
    }

    // 3. If no matching tracker exists, create/use the default AI panel in the CURRENT industry
    if (!targetTracker) {
      targetTracker = trackers.find(t => t.workspaceId === effectiveWorkspaceId && t.name === 'AI 自动收集面板' && (!t.moduleType || t.moduleType === 'data'));
      
      if (!targetTracker) {
        targetTracker = {
          id: generateId(),
          workspaceId: effectiveWorkspaceId,
          name: 'AI 自动收集面板',
          moduleType: 'data',
          columns: [],
          entities: [],
          records: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        } as Tracker;
      }
    }

    const mergedTracker = JSON.parse(JSON.stringify(targetTracker)) as Tracker;

    let entity = mergedTracker.entities?.find((e: TrackerEntity) => e.name === item.targetCompany);
    if (!entity) {
      entity = { id: `e_${generateId()}`, name: item.targetCompany };
      if (!mergedTracker.entities) mergedTracker.entities = [];
      mergedTracker.entities.push(entity);
    }

    let column = mergedTracker.columns?.find((c: TrackerColumn) => c.name === item.targetMetric);
    if (!column) {
      column = { id: `c_${generateId()}`, name: item.targetMetric, type: 'number', period: 'month' };
      if (!mergedTracker.columns) mergedTracker.columns = [];
      mergedTracker.columns.push(column);
    }

    if (!mergedTracker.records) mergedTracker.records = [];
    const existingRecord = mergedTracker.records.find((r: TrackerRecord) => r.entityId === entity!.id && r.timePeriod === item.timePeriod);
    if (existingRecord) {
      existingRecord.values[column.id] = item.extractedValue;
    } else {
      mergedTracker.records.push({
        entityId: entity!.id,
        timePeriod: item.timePeriod || new Date().toISOString().slice(0, 7), // fallback to current YYYY-MM
        values: { [column.id]: item.extractedValue }
      });
    }

    mergedTracker.updatedAt = Date.now();

    try {
      await addOrUpdateTracker(mergedTracker);
      await removeInboxItem(item.id);
    } catch (e: any) {
      alert('入库失败: ' + e.message);
    }
  };
  const [excelPrompt, setExcelPrompt] = useState(`你是一个非常专业的数据工程师，能够从极不规范的带有杂乱表头的 Excel 矩阵中提取出标准的结构化时序数据。
请你读取我提供的 2D 数组格式的 JSON，提取出并返回一个包含 entities, columns, records 的标准 JSON 格式。
不要输出任何其他解释，只输出合法的 JSON 对象，不要用 markdown 包裹、不要带有 \`\`\`json 标记，直接输出纯 JSON！

必须符合以下类型：
{
  "name": "自动提取的视图名称",
  "entities": [{ "id": "e_唯一自增", "name": "公司或实体的名字" }],
  "columns": [{ "id": "c_唯一自增", "name": "指标或列的名字", "type": "number", "period": "month" }],
  "records": [{ "entityId": "e_关联ID", "timePeriod": "如 2026-01", "values": { "c_关联ID": 100 } }]
}`);

  // Load tracker data on mount
  useEffect(() => {
    loadData();
    aiApi.getSettings().then(res => {
      if (res && res.excelParsingPrompt) {
        setExcelPrompt(res.excelParsingPrompt);
      }
    }).catch(() => {});
  }, [loadData]);

  // Filter industry workspaces and sync with Category Manager
  const categories = useIndustryCategoryStore(s => s.categories);
  const loadCategories = useIndustryCategoryStore(s => s.loadCategories);
  
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const allSubCategories = React.useMemo(() => {
    return categories.flatMap(c => c.subCategories);
  }, [categories]);

  const [activeSubCategoryName, setActiveSubCategoryName] = useState<string>('');

  useEffect(() => {
    if (!activeSubCategoryName) {
      if (allSubCategories.length > 0) {
        setActiveSubCategoryName(allSubCategories[0]);
      } else {
        const unmatched = workspaces.filter(w => w.category === 'industry' || !w.category);
        if (unmatched.length > 0) {
          setActiveSubCategoryName(unmatched[0].id);
        }
      }
    }
  }, [allSubCategories, activeSubCategoryName, workspaces]);

  // Find matching workspaces for the active sub-category string
  const matchingWorkspaceIds = React.useMemo(() => {
    return workspaces.filter(w => w.name === activeSubCategoryName).map(w => w.id);
  }, [workspaces, activeSubCategoryName]);

  const [workspaceCanvases, setWorkspaceCanvases] = useState<any[]>([]);

  useEffect(() => {
    if (matchingWorkspaceIds.length > 0) {
      canvasApi.list(matchingWorkspaceIds[0], true).then(data => {
        setWorkspaceCanvases(data || []);
      }).catch(err => {
        console.error('Failed to load canvases for wiki sync', err);
      });
    } else {
      setWorkspaceCanvases([]);
    }
  }, [matchingWorkspaceIds]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetModuleTypeRef = useRef<'data'|'company'|'expert'>('data');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsParsingExcel(true);
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      
      // Limit to 200 rows to prevent context window overflow during AI parsing.
      const sampleData = jsonData.slice(0, 200);

      let resultString = '';
      const config = getApiConfig();
      const model = config.excelParsingModel || 'gemini-3-flash-preview';

      for await (const event of aiApi.chatStream({
        model,
        messages: [{ role: 'user', content: `这是 Excel 解析出的矩阵数据：\n${JSON.stringify(sampleData)}` }],
        systemPrompt: excelPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          resultString += event.content;
        }
      }

      // cleanup markdown
      resultString = resultString.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      
      const parsed = JSON.parse(resultString);
      
      const newTracker = {
        id: generateId(),
        workspaceId: matchingWorkspaceIds[0] || (activeSubCategoryName && activeSubCategoryName.length > 0 ? activeSubCategoryName : 'default'),
        name: parsed.name || firstSheetName,
        moduleType: targetModuleTypeRef.current,
        columns: parsed.columns || [],
        entities: parsed.entities || [],
        records: parsed.records || [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await addOrUpdateTracker(newTracker as any);
      alert('从无规则 Excel 智能提取成功！结构化底表已建立。');

    } catch (err: any) {
      alert(`AI 解析 Excel 失败: ${err.message}`);
    } finally {
      setIsParsingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const activeTrackers = trackers.filter(t => 
    matchingWorkspaceIds.includes(t.workspaceId) || 
    t.workspaceId === activeSubCategoryName || 
    (!t.workspaceId && matchingWorkspaceIds.length > 0)
  );
  const dataTrackers = activeTrackers.filter(t => !t.moduleType || t.moduleType === 'data');
  const companyTrackers = activeTrackers.filter(t => t.moduleType === 'company');
  const expertTrackers = activeTrackers.filter(t => t.moduleType === 'expert');

  // Filter out structural/category canvases so they don't incorrectly appear as "Company" trackers
  const EXCLUDED_COMPANY_TABS = ['expert', 'sellside', '行业研究', '行业'];
  
  const filteredCanvases = workspaceCanvases.filter(c => 
    c.title && !EXCLUDED_COMPANY_TABS.some(ex => c.title.toLowerCase().includes(ex))
  );

  // Merge explicitly added Entities in Matrix with Canvases (Companies) that exist in the Workspace
  const allEntities = Array.from(new Map<string, any>([
    ...filteredCanvases.map(c => [c.title || '', { id: c.id, name: c.title }] as [string, any]),
    ...activeTrackers.flatMap(t => t.entities || []).map(e => [e.name, e] as [string, any])
  ]).values());

  const handleImportExcel = (type: 'data' | 'company' | 'expert') => {
    targetModuleTypeRef.current = type;
    fileInputRef.current?.click();
  };

  const renderPivotGrid = () => {
    // 1. Gather all active time periods across all trackers
    const rawTimePeriods = Array.from(new Set(
      activeTrackers.flatMap(t => t.records?.map(r => r.timePeriod) || [])
    )).sort();

    const allTimePeriods = rawTimePeriods.length > 0 ? rawTimePeriods : ['(近期动态)'];
  
    // 2. Build the Pivot structure
    const entityMap = new Map<string, PivotRowItem[]>();
    
    activeTrackers.forEach(tracker => {
      tracker.entities?.forEach(entity => {
        const entityKey = entity.name.trim().toLowerCase();
        const items = entityMap.get(entityKey) || [];
        
        tracker.columns?.forEach(col => {
          const rowItem: PivotRowItem = {
            id: `${tracker.id}-${entity.id}-${col.id}`,
            moduleType: tracker.moduleType || 'data',
            trackerName: tracker.name,
            columnName: col.name,
            cells: {}
          };
          
          tracker.records?.forEach(record => {
             // Match either by strict entityId or legacy entity name fallback
             if (record.entityId === entity.id || record.entityId === entity.name) {
               const val = record.values?.[col.id] ?? record.values?.[col.name];
               if (val !== undefined && val !== null && val !== '') {
                 rowItem.cells[record.timePeriod] = val;
               }
             }
          });
  
          items.push(rowItem);
        });
        entityMap.set(entityKey, items);
      });
    });
  
    const pivotRows: PivotRow[] = Array.from(entityMap.entries()).map(([_, items]) => {
       // use original mapped name
       const originalName = activeTrackers.flatMap(t => t.entities || []).find(e => e.name.toLowerCase() === _)?.name || _;
       return {
         entityName: originalName,
         items: items.sort((a,b) => {
           const order = { 'data': 1, 'company': 2, 'expert': 3 };
           if (order[a.moduleType as keyof typeof order] !== order[b.moduleType as keyof typeof order]) return order[a.moduleType as keyof typeof order] - order[b.moduleType as keyof typeof order];
           return a.columnName.localeCompare(b.columnName);
         })
       };
    }).sort((a,b) => a.entityName.localeCompare(b.entityName));
  
    return (
      <div className="border border-slate-200 rounded flex flex-col h-full bg-white overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-2 border-b border-slate-200 bg-white shrink-0" style={{ minHeight: 38 }}>
          <div className="flex items-center gap-1.5 min-w-0">
             <AlignLeft size={13} className="text-slate-400 shrink-0" />
             <span className="text-xs font-semibold text-slate-700 truncate">全维追踪聚合网格</span>
             <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
               {pivotRows.length}
             </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => setShowAIModal(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="画布自动嗅探"
              >
                <Bot size={12} />
                <span>嗅探</span>
              </button>
              <button
                onClick={() => handleImportExcel('data')}
                disabled={isParsingExcel}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                title="快速导入数据"
              >
                {isParsingExcel ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                <span>导入</span>
              </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto relative">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr>
                <th className="w-72 px-2 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border-b border-r border-slate-200 sticky top-0 left-0 z-30">实体 / 指标</th>
                {allTimePeriods.map(th => (
                  <th key={th} className="px-2 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-50 border-b border-r border-slate-200 sticky top-0 z-20 text-center min-w-[160px] whitespace-nowrap">
                    {th}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pivotRows.map((row) => (
                 <React.Fragment key={row.entityName}>
                   {/* Entity Header Row */}
                   <tr className="bg-slate-50">
                     <td className="px-2 py-1 sticky left-0 z-10 bg-slate-50 border-b border-r border-slate-200 font-semibold text-slate-700 text-xs" colSpan={1}>
                       {row.entityName}
                     </td>
                     <td className="border-b border-r border-slate-200" colSpan={allTimePeriods.length}></td>
                   </tr>
                   {/* Metric Rows */}
                   {row.items.map(item => {
                      const isQualitative = item.moduleType === 'company' || item.moduleType === 'expert';
                      const iconColor = item.moduleType === 'data' ? 'text-blue-400' : item.moduleType === 'company' ? 'text-violet-400' : 'text-emerald-400';
                      return (
                        <tr key={item.id} className="hover:bg-blue-50/40 transition-colors group border-b border-slate-100">
                          <td className="px-2 py-1.5 bg-white sticky left-0 z-10 border-r border-slate-200 align-top pl-5 group-hover:bg-blue-50/40 transition-colors">
                            <div className="flex items-start gap-1.5">
                              <span className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${iconColor.replace('text-', 'bg-')}`} title={item.trackerName}></span>
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium text-slate-700 leading-tight truncate">{item.columnName}</span>
                                <span className="text-[10px] text-slate-400 truncate" title={`来源 Tracker: ${item.trackerName}`}>{item.trackerName}</span>
                              </div>
                            </div>
                          </td>
                          {allTimePeriods.map(tp => {
                            const val = item.cells[tp];
                            if (val === undefined || val === null) {
                              return <td key={tp} className="px-2 py-1.5 text-[11px] text-center text-slate-300 border-r border-slate-100">-</td>;
                            }
                            return (
                              <td key={tp} className={`px-2 py-1.5 border-r border-slate-100 align-top ${isQualitative ? 'text-left' : 'text-right font-mono'}`}>
                                {isQualitative ? (
                                  <div className="text-[11px] text-slate-600 line-clamp-3 leading-relaxed whitespace-pre-wrap hover:line-clamp-none transition-all" title={String(val)}>
                                    {val}
                                  </div>
                                ) : (
                                  <div className="text-xs font-semibold text-slate-700 tabular-nums">
                                    {val}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                   })}
                 </React.Fragment>
              ))}
             {pivotRows.length === 0 && (
               <tr>
                 <td colSpan={allTimePeriods.length + 1} className="p-0">
                   <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-white">
                     <Activity size={24} className="mb-2 opacity-30" />
                     <p className="text-xs font-medium text-slate-600 mb-1">暂无追踪实体</p>
                     <p className="text-[11px] text-slate-400 mb-4">尚未探测到任何相关的监控数据</p>
                     <div className="flex items-center gap-2">
                       <PrimaryButton onClick={() => handleImportExcel('data')} icon={<Upload size={12} />}>
                         导入 Excel
                       </PrimaryButton>
                       <button
                         onClick={() => setShowAIModal(true)}
                         className="flex items-center gap-1 px-3 py-1 bg-white text-slate-600 border border-slate-200 text-xs font-medium rounded hover:bg-slate-50 transition-colors"
                       >
                         <Bot size={12} />
                         从画布嗅探
                       </button>
                     </div>
                   </div>
                 </td>
               </tr>
             )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden">
      
      {/* Left: Tracker Main Board */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200 bg-white">
        
        {/* Header */}
        <PageHeader
          className="z-20"
          right={
            <>
              <SegmentedToggle
                value={subView}
                onChange={(v) => setSubView(v)}
                options={[
                  { value: 'matrix', label: '数据矩阵', icon: <Activity size={12} /> },
                  { value: 'wiki', label: <>行业百科 <sup>Wiki</sup></>, icon: <BookOpen size={12} /> },
                ]}
                className="mr-1"
              />
              {subView === 'matrix' && (
                <SegmentedToggle
                  value={timeView}
                  onChange={(v) => setTimeView(v)}
                  options={[
                    { value: 'week', label: '周' },
                    { value: 'month', label: '月' },
                    { value: 'quarter', label: '季' },
                    { value: 'year', label: '年' },
                  ]}
                  className="mr-1"
                />
              )}
              <IconButton onClick={() => setShowPromptModal(true)} title="配置解析 Prompt">
                <Settings size={14} />
              </IconButton>
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
            </>
          }
        >
          <div className="flex items-center gap-0.5">
            <select
              value={activeSubCategoryName}
              onChange={e => { setActiveSubCategoryName(e.target.value); setWikiScopeId('industry'); }}
              className="bg-transparent border-none outline-none text-xs font-semibold text-slate-700 cursor-pointer appearance-none px-0"
            >
              {categories.map(cat => (
                <optgroup key={cat.label} label={cat.label}>
                  {cat.subCategories.length > 0 ? (
                    cat.subCategories.map(sub => <option key={sub} value={sub}>{sub}</option>)
                  ) : (
                    <option disabled>无子分类</option>
                  )}
                </optgroup>
              ))}
              {/* 兼容那些还未加入系统分类树的历史命名文件夹 */}
              {(() => {
                const unmatched = workspaces.filter(w => (w.category === 'industry' || !w.category) && !allSubCategories.includes(w.name));
                if (unmatched.length === 0) return null;
                return (
                  <optgroup label="其他及未归类 (Legacy)">
                    {unmatched.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </optgroup>
                );
              })()}
              {categories.length === 0 && <option value="">暂无分类</option>}
            </select>
            <ChevronDown size={11} className="text-slate-400 -ml-0.5" />

            {subView === 'wiki' && (
              <>
                <span className="text-slate-200 mx-1">/</span>
                <select
                  value={wikiScopeId}
                  onChange={e => setWikiScopeId(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-medium text-slate-500 cursor-pointer appearance-none px-0"
                >
                  <option value="industry">大盘知识库</option>
                  {allEntities.length > 0 && (
                    <optgroup label="公司专属库">
                      {allEntities.map((ent: any) => (
                        <option key={ent.id} value={ent.id}>{ent.name} 专属库</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <ChevronDown size={11} className="text-slate-400 -ml-0.5" />
              </>
            )}
          </div>
        </PageHeader>

        {/* Area Context dependent on subView */}
        {subView === 'matrix' ? (
          <div className="flex-1 overflow-auto p-6 bg-slate-50/30 flex flex-col">
            <div className="flex-1 max-w-[1400px] w-full mx-auto relative flex flex-col h-full h-full pb-4">
              {renderPivotGrid()}
            </div>
          </div>
        ) : (
            <div className="flex-1 w-full flex bg-white overflow-hidden">
              <div className="flex-1 min-w-0 bg-white z-0 relative">
                <IndustryWikiConsole
                  industryCategory={
                    wikiScopeId === 'industry'
                      ? activeSubCategoryName || 'default'
                      : `${activeSubCategoryName || 'default'}::${allEntities.find((e: any) => e.id === wikiScopeId)?.name || wikiScopeId}`
                  }
                  workspaceIds={matchingWorkspaceIds}
                  entityNames={allEntities.map((e: any) => e.name)}
                />
              </div>
            </div>
        )}
      </div>

      {/* Right: AI Inbox Drawer (only in matrix mode maybe? Keep for both for now or hide in wiki) */}
      {subView === 'matrix' && (
        <div className="w-72 shrink-0 flex flex-col bg-slate-50 border-l border-slate-200">
        <PageHeader
          right={
            <IconButton title="刷新">
              <RefreshCw size={13} />
            </IconButton>
          }
        >
          <div className="relative">
            <InboxIcon size={14} className="text-slate-500" />
            {inboxItems.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            )}
          </div>
          <span className="font-semibold text-xs text-slate-700">情报草稿箱</span>
          {inboxItems.length > 0 && (
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{inboxItems.length}</span>
          )}
        </PageHeader>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">

          {inboxItems.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <InboxIcon size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs">暂无待确认数据</p>
            </div>
          ) : (
            inboxItems.map(item => (
              <div key={item.id} className="bg-white rounded border border-slate-200 overflow-hidden flex flex-col">
                <div className="bg-slate-50 px-2 py-1 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-1 text-slate-500">
                    <SparklesIcon size={11} />
                    <span className="text-[10px] font-medium">
                      {item.source === 'crawler' ? '爬虫监测' : item.source === 'canvas' ? 'Canvas 提取' : '手动输入'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {Math.round((Date.now() - item.timestamp) / 60000)} 分钟前
                  </span>
                </div>
                <div className="p-2">
                   <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed line-clamp-2">
                     "{item.content}"
                   </p>
                   <div className="bg-slate-50 rounded p-1.5 border border-slate-100 flex flex-col gap-0.5">
                     <div className="flex justify-between text-[10px]">
                       <span className="text-slate-400">目标实体</span>
                       <span className="font-medium text-slate-700 truncate ml-2">{item.targetCompany}</span>
                     </div>
                     <div className="flex justify-between text-[10px]">
                       <span className="text-slate-400">指标列</span>
                       <span className="font-medium text-slate-700 truncate ml-2">{item.targetMetric}</span>
                     </div>
                     <div className="flex justify-between text-[10px]">
                       <span className="text-slate-400">时间标识</span>
                       <span className="font-medium text-slate-700">{item.timePeriod}</span>
                     </div>
                     <div className="flex justify-between text-[11px] mt-0.5 pt-0.5 border-t border-slate-200">
                       <span className="text-slate-500">提取数值</span>
                       <span className="font-semibold text-blue-600">{item.extractedValue}</span>
                     </div>
                   </div>
                </div>
                <div className="flex border-t border-slate-100 bg-slate-50">
                   <button
                    onClick={() => removeInboxItem(item.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                   >
                     <X size={12} /> 放弃
                   </button>
                   <div className="w-px bg-slate-200"></div>
                   <button
                    onClick={() => handleConfirmInboxItem(item)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
                   >
                     <Check size={12} /> 确认入库
                   </button>
                </div>
              </div>
            ))
          )}

        </div>
      </div>
      )}
      
      {/* AI Note Extraction Modal */}
      {showAIModal && (
        <TrackerAIModal 
          onClose={() => setShowAIModal(false)}
          activeIndustryId={matchingWorkspaceIds[0] || (activeTrackers.length > 0 ? activeTrackers[0].workspaceId : activeSubCategoryName)}
          activeTrackers={activeTrackers}
        />
      )}

      {/* Prompt Configuration Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" onClick={() => setShowPromptModal(false)}>
          <div
            className="bg-white rounded shadow-lg w-full max-w-2xl mx-4 overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 border-b border-slate-200" style={{ minHeight: 38 }}>
              <h2 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Settings size={13} className="text-slate-400" />
                配置 Excel 解析 Prompt
              </h2>
              <button onClick={() => setShowPromptModal(false)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-3 flex-1 min-h-[300px]">
              <p className="text-xs text-slate-500 mb-2">当遇到不规则的 Excel 表时，你可以在这里告诉 AI 如何准确地抠出实体、指标和数值。需要保留 JSON 模式规则保证解析成功：</p>
              <textarea
                value={excelPrompt}
                onChange={(e) => setExcelPrompt(e.target.value)}
                className="w-full h-80 p-3 border border-slate-200 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-blue-400 bg-slate-50 resize-none leading-relaxed"
                placeholder="请输入系统级 Prompt..."
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => setShowPromptModal(false)}
                className="px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  aiApi.saveSettings({ excelParsingPrompt: excelPrompt }).then(() => {
                    alert('Prompt 保存成功！');
                    setShowPromptModal(false);
                  }).catch(e => {
                    alert('保存失败: ' + e.message);
                  });
                }}
                className="px-3 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded transition-colors"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
});

function InboxIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>
  );
}

function SparklesIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg>
  );
}
