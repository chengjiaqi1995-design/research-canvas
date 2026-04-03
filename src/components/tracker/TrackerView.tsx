import { memo, useState, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../../stores/workspaceStore.ts';
import * as XLSX from 'xlsx';
import { generateId } from '../../utils/id.ts';
import { 
  BarChart2, Filter, Upload, Plus, Calendar, Clock, 
  Activity, Check, X, AlertCircle, RefreshCw, Loader2, Settings,
  MessageSquare, Users, BookOpen, ChevronDown
} from 'lucide-react';
import { useTrackerStore } from '../../stores/trackerStore.ts';
import { aiApi } from '../../db/apiClient.ts';
import { getApiConfig } from '../../aiprocess/components/ApiConfigModal.tsx';
import type { Tracker, TrackerInboxItem, TrackerColumn, TrackerEntity, TrackerRecord } from '../../types/index.ts';


export const TrackerView = memo(function TrackerView() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const inboxItems = useTrackerStore((s) => s.inboxItems);
  const trackers = useTrackerStore((s) => s.trackers);
  const loadData = useTrackerStore((s) => s.loadData);
  const removeInboxItem = useTrackerStore((s) => s.removeInboxItem);
  const addOrUpdateTracker = useTrackerStore((s) => s.addOrUpdateTracker);
  const [timeView, setTimeView] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);

  const handleConfirmInboxItem = async (item: TrackerInboxItem) => {
    // 1. Try to find a matching tracker in the current active industry
    let targetTracker = trackers.find(t => 
      t.workspaceId === activeIndustryId &&
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
      targetTracker = trackers.find(t => t.workspaceId === activeIndustryId && t.name === 'AI 自动收集面板' && (!t.moduleType || t.moduleType === 'data'));
      
      if (!targetTracker) {
        targetTracker = {
          id: generateId(),
          workspaceId: activeIndustryId || workspaces[0]?.id || 'default',
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

  // Filter industry workspaces
  const industries = workspaces.filter(w => w.category === 'industry' || !w.category);
  const [activeIndustryId, setActiveIndustryId] = useState<string>('');

  useEffect(() => {
    if (!activeIndustryId && industries.length > 0) {
      setActiveIndustryId(industries[0].id);
    }
  }, [industries, activeIndustryId]);

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
        workspaceId: activeIndustryId || workspaces[0]?.id || 'default',
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

  const activeTrackers = trackers.filter(t => t.workspaceId === activeIndustryId || (!t.workspaceId && industries.length > 0));
  const dataTrackers = activeTrackers.filter(t => !t.moduleType || t.moduleType === 'data');
  const companyTrackers = activeTrackers.filter(t => t.moduleType === 'company');
  const expertTrackers = activeTrackers.filter(t => t.moduleType === 'expert');

  const handleImportExcel = (type: 'data' | 'company' | 'expert') => {
    targetModuleTypeRef.current = type;
    fileInputRef.current?.click();
  };

  const renderTrackerTable = (tracker: Tracker, type: 'data' | 'company' | 'expert') => {
    const timePeriods = Array.from(new Set(tracker.records?.map(r => r.timePeriod) || [])).sort();
    const isQualitative = type === 'company' || type === 'expert';

    return (
      <div key={tracker.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">📊 {tracker.name || '已解析表单'}</span>
            <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
              {tracker.entities?.length || 0} 个监控项目
            </span>
          </div>
          <button className="text-slate-400 hover:text-indigo-600"><Filter size={14}/></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr>
                <th className="w-48 p-3 text-xs font-medium text-slate-500 bg-white border-b border-slate-200 sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0]">追踪实体 / 指标</th>
                {timePeriods.map(th => (
                  <th key={th} className={`p-3 text-xs font-medium text-slate-500 border-b border-slate-200 ${isQualitative ? 'text-left min-w-[240px]' : 'text-right min-w-[120px]'}`}>
                    {th}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tracker.entities?.map(entity => (
                tracker.columns?.map(col => (
                  <tr key={`${entity.id}-${col.id}`} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="p-3 bg-white sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] align-top">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{entity.name}</span>
                        <span className="text-[10px] text-slate-500 mt-1">{col.name}</span>
                      </div>
                    </td>
                    {timePeriods.map(tp => {
                      const record = tracker.records?.find(r => r.entityId === entity.id && r.timePeriod === tp) || tracker.records?.find(r => r.entityId === entity.name && r.timePeriod === tp);
                      const val = record?.values?.[col.id] ?? record?.values?.[col.name] ?? '-';
                      return (
                        <td key={tp} className={`p-3 text-sm text-slate-700 align-top ${isQualitative ? 'text-left' : 'text-right font-mono'}`}>
                          {isQualitative ? (
                            <div className="line-clamp-4 leading-relaxed whitespace-pre-wrap" title={String(val)}>{val}</div>
                          ) : (
                            val
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTrackerGroup = (groupTitle: string, icon: any, trackerList: Tracker[], type: 'data' | 'company' | 'expert', emptyText: string) => {
    return (
      <div className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded">
              {icon}
            </div>
            <h2 className="text-base font-bold text-slate-800">{groupTitle}</h2>
            <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full">{trackerList.length} 个监控表</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleImportExcel(type)}
              disabled={isParsingExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-[11px] font-medium rounded hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            >
              {isParsingExcel && targetModuleTypeRef.current === type ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              导入 Excel 模块
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-medium rounded hover:bg-indigo-700 transition-colors shadow-sm">
              <Plus size={12} />
              新增项目
            </button>
          </div>
        </div>

        {trackerList.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <div className="text-slate-300 mb-2">{icon}</div>
            <p className="text-sm font-medium text-slate-500">{emptyText}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {trackerList.map(tracker => renderTrackerTable(tracker, type))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex w-full h-full bg-slate-50 overflow-hidden">
      
      {/* Left: Tracker Main Board */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200 bg-white">
        
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-6 border-b border-slate-100 shrink-0 bg-white z-20">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Activity size={18} />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-800 leading-tight">行业动态追踪看板</h1>
              <div className="text-slate-300 px-1">/</div>
              <select 
                value={activeIndustryId} 
                onChange={e => setActiveIndustryId(e.target.value)} 
                className="bg-transparent border-none outline-none font-semibold text-indigo-700 cursor-pointer appearance-none px-1"
              >
                {industries.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                {industries.length === 0 && <option value="">暂无行业信息</option>}
              </select>
              <ChevronDown size={14} className="text-indigo-400 -ml-1" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Time period toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg mr-2">
              {['week', 'month', 'quarter', 'year'].map((pt) => (
                <button
                  key={pt}
                  onClick={() => setTimeView(pt as any)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    timeView === pt 
                      ? 'bg-white text-indigo-700 shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {pt === 'week' ? '周' : pt === 'month' ? '月' : pt === 'quarter' ? '季' : '年'}
                </button>
              ))}
            </div>

            <div className="flex items-center">
              <button
                onClick={() => setShowPromptModal(true)}
                className="flex items-center justify-center px-2 py-1.5 bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors rounded shadow-sm"
                title="配置解析 Prompt"
              >
                <Settings size={14} />
              </button>
            </div>
            <input 
              type="file" 
              accept=".xlsx, .xls, .csv" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {/* Matrix Area */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50/30">
          <div className="max-w-6xl mx-auto">
            {renderTrackerGroup('行业数据跟踪', <BarChart2 size={16} />, dataTrackers, 'data', '暂无量化统计数据，请点击右侧按钮导入包含数字的 Excel 底表。')}
            {renderTrackerGroup('行业公司说法跟踪', <MessageSquare size={16} />, companyTrackers, 'company', '暂无定性言论，可导入高管讲话、财报问答纪要等 Excel。')}
            {renderTrackerGroup('行业专家跟踪', <Users size={16} />, expertTrackers, 'expert', '暂无专家洞察，可导入专家库速记或观点表。')}
          </div>
        </div>
      </div>

      {/* Right: AI Inbox Drawer */}
      <div className="w-80 shrink-0 flex flex-col bg-slate-50 border-l border-slate-200">
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-2 text-indigo-700">
            <div className="relative">
              <InboxIcon size={16} />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            </div>
            <span className="font-semibold text-sm">情报草稿箱 {inboxItems.length > 0 && `(${inboxItems.length})`}</span>
          </div>
          <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {inboxItems.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <InboxIcon size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-sm">暂无待确认数据</p>
            </div>
          ) : (
            inboxItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-blue-50/50 px-3 py-2 border-b border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-blue-700">
                    <SparklesIcon size={14} />
                    <span className="text-[11px] font-medium">
                      {item.source === 'crawler' ? '爬虫监测提取' : item.source === 'canvas' ? 'Canvas 内部提取' : '手动输入提取'}
                    </span>
                  </div>
                  <span className="text-[10px] text-blue-400">
                    {Math.round((Date.now() - item.timestamp) / 60000)} 分钟前
                  </span>
                </div>
                <div className="p-3 pb-2">
                   <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                     "{item.content}"
                   </p>
                   <div className="bg-slate-50 rounded p-2 border border-slate-100 flex flex-col gap-1">
                     <div className="flex justify-between text-[11px]">
                       <span className="text-slate-500">目标实体</span>
                       <span className="font-medium text-slate-700">{item.targetCompany}</span>
                     </div>
                     <div className="flex justify-between text-[11px]">
                       <span className="text-slate-500">指标列</span>
                       <span className="font-medium text-slate-700">{item.targetMetric}</span>
                     </div>
                     <div className="flex justify-between text-[11px]">
                       <span className="text-slate-500">时间标识</span>
                       <span className="font-medium text-slate-700">{item.timePeriod}</span>
                     </div>
                     <div className="flex justify-between text-xs mt-1 pt-1 border-t border-slate-200">
                       <span className="text-slate-600">提取数值</span>
                       <span className="font-semibold text-blue-600">{item.extractedValue}</span>
                     </div>
                   </div>
                </div>
                <div className="flex border-t border-slate-100 bg-slate-50">
                   <button 
                    onClick={() => removeInboxItem(item.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                   >
                     <X size={14} /> 放弃
                   </button>
                   <div className="w-px bg-slate-200"></div>
                   <button 
                    onClick={() => handleConfirmInboxItem(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
                   >
                     <Check size={14} /> 确认入库
                   </button>
                </div>
              </div>
            ))
          )}

        </div>
      </div>
      
      {/* Prompt Configuration Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPromptModal(false)}>
          <div 
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Settings size={18} className="text-slate-500" />
                配置 Excel 解析 Prompt
              </h2>
              <button onClick={() => setShowPromptModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 flex-1 min-h-[300px]">
              <p className="text-sm text-slate-500 mb-3">当遇到不规则的 Excel 表时，你可以在这里告诉 AI 如何准确地抠出实体、指标和数值。需要保留 JSON 模式规则保证解析成功：</p>
              <textarea
                value={excelPrompt}
                onChange={(e) => setExcelPrompt(e.target.value)}
                className="w-full h-80 p-4 border border-slate-300 rounded-lg text-sm text-slate-700 font-mono focus:outline-none focus:ring-2 focus:indigo-500 focus:border-transparent resize-none leading-relaxed"
                placeholder="请输入系统级 Prompt..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button 
                onClick={() => setShowPromptModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
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
                className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm"
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
