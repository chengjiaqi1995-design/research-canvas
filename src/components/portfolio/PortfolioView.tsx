import { memo, Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { ResponsiveLayout } from '../layout/ResponsiveLayout.tsx';
import { lazyWithRetry } from '../../utils/lazyWithRetry.ts';
import {
  RefreshCw, Upload, Plus, Trash2, ChevronDown, ChevronRight,
  BarChart3, Search, X,
  Edit3, Check, ArrowUpDown, ArrowUp, ArrowDown, FileDown,
  BookOpen, Languages, Sparkles, History, ShieldAlert, Activity,
} from 'lucide-react';
import type {
  PositionWithRelations,
  TaxonomyItem,
  TradeWithItems,
  CompanyResearch,
  ImportHistoryItem,
} from '../../aiprocess/types/portfolio';
import * as api from '../../aiprocess/api/portfolio';
import { toast } from 'sonner';
import { PrimaryButton } from '../ui/index.ts';

const DashboardView = lazyWithRetry(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })), 'PortfolioDashboardView');
const PositionsView = lazyWithRetry(() => import('./views/PositionsView').then((m) => ({ default: m.PositionsView })), 'PortfolioPositionsView');
const ImpactView = lazyWithRetry(() => import('./views/ImpactView').then((m) => ({ default: m.ImpactView })), 'PortfolioImpactView');
const ScreenerView = lazyWithRetry(() => import('./views/ScreenerView').then((m) => ({ default: m.ScreenerView })), 'PortfolioScreenerView');
const TechnicalAnalysisView = lazyWithRetry(() => import('./views/TechnicalAnalysisView').then((m) => ({ default: m.TechnicalAnalysisView })), 'PortfolioTechnicalAnalysisView');

type ViewTab = 'dashboard' | 'positions' | 'screener' | 'technical' | 'impact' | 'trades' | 'history';
type GroupBy = 'none' | 'sector' | 'theme' | 'topdown' | 'longShort' | 'priority';
type SortField = 'nameCn' | 'tickerBbg' | 'positionWeight' | 'positionAmount' | 'pnl' | 'return1d' | 'return1m' | 'pe2026' | 'marketCapRmb' | 'priority';
type SortDir = 'asc' | 'desc';

// ─── Helpers ───
function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return '-';
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null || isNaN(v)) return '-';
  return `${(v * 100).toFixed(decimals)}%`;
}
function fmtMoney(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '-';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}
function pnlColor(v: number | null | undefined): string {
  if (v == null || v === 0) return 'text-slate-600';
  return v > 0 ? 'text-emerald-600' : 'text-red-500';
}

const TAB_ICONS: Record<ViewTab, any> = {
  dashboard: BarChart3, positions: BookOpen, screener: Search, technical: Activity, impact: ShieldAlert, trades: ArrowUpDown,
  history: History,
};
const TAB_LABELS: Record<ViewTab, string> = {
  dashboard: 'Dashboard', positions: 'Positions', screener: 'Screener', technical: 'Technical', impact: 'Impact', trades: 'Trades',
  history: 'Import',
};

// ─── Add Position Modal ───
function AddPositionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ tickerBbg: '', nameEn: '', nameCn: '', longShort: 'long', priority: 'watchlist', market: '' });
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (!form.tickerBbg.trim()) return;
    setSaving(true);
    try {
      await api.createPosition(form as any);
      onCreated();
      onClose();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800 mb-4">新增持仓</h3>
        <div className="space-y-3">
          {[
            { key: 'tickerBbg', label: 'Ticker (BBG)', placeholder: '例: 700 HK Equity' },
            { key: 'nameEn', label: '英文名', placeholder: 'English name' },
            { key: 'nameCn', label: '中文名', placeholder: '中文名称' },
            { key: 'market', label: '市场', placeholder: '例: HK, CN, US' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-[11px] text-slate-500 mb-0.5">{label}</label>
              <input className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder={placeholder}
                value={(form as any)[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 mb-0.5">方向</label>
              <select className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" value={form.longShort} onChange={(e) => setForm((f) => ({ ...f, longShort: e.target.value }))}>
                <option value="long">Long</option><option value="short">Short</option><option value="watchlist">Watchlist</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-slate-500 mb-0.5">优先级</label>
              <select className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                <option value="core">Core</option><option value="satellite">Satellite</option><option value="trading">Trading</option><option value="watchlist">Watchlist</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <PrimaryButton variant="secondary" onClick={onClose}>取消</PrimaryButton>
          <PrimaryButton onClick={handleSave} disabled={saving || !form.tickerBbg.trim()}>
            {saving ? '保存中...' : '创建'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Position Row ───
function PositionRow({ pos, taxonomies, onUpdate, onDelete, onViewResearch }: {
  pos: PositionWithRelations;
  taxonomies: { sectors: TaxonomyItem[]; themes: TaxonomyItem[]; topdowns: TaxonomyItem[] };
  onUpdate: (id: number, data: Partial<PositionWithRelations>) => void;
  onDelete: (id: number) => void;
  onViewResearch: (pos: PositionWithRelations) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<PositionWithRelations>>({});
  const startEdit = () => {
    setEditData({ nameCn: pos.nameCn, priority: pos.priority, longShort: pos.longShort, positionAmount: pos.positionAmount, sectorId: pos.sectorId, themeId: pos.themeId, topdownId: pos.topdownId });
    setEditing(true);
  };
  const saveEdit = () => { onUpdate(pos.id, editData); setEditing(false); };
  const priorityColors: Record<string, string> = { core: 'bg-blue-100 text-blue-700', satellite: 'bg-blue-100 text-blue-700', watchlist: 'bg-slate-100 text-slate-500', trading: 'bg-amber-100 text-amber-700' };

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 text-[12px]">
      <td className="px-2 py-1.5 font-medium text-slate-800">
        {editing ? <input className="w-full border rounded px-1 py-0.5 text-[12px]" value={editData.nameCn ?? ''} onChange={(e) => setEditData((d) => ({ ...d, nameCn: e.target.value }))} />
          : <button onClick={() => onViewResearch(pos)} className="hover:text-blue-600 hover:underline text-left">{pos.nameCn || pos.nameEn}</button>}
      </td>
      <td className="px-2 py-1.5 text-slate-500 font-mono text-[11px]">{pos.tickerBbg}</td>
      <td className="px-2 py-1.5">
        {editing ? <select className="border rounded px-1 py-0.5 text-[11px]" value={editData.longShort ?? ''} onChange={(e) => setEditData((d) => ({ ...d, longShort: e.target.value }))}>
          <option value="long">Long</option><option value="short">Short</option>
        </select> : <span className={`text-[11px] ${pos.longShort === 'long' ? 'text-emerald-600' : 'text-red-500'}`}>{pos.longShort === 'long' ? 'L' : 'S'}</span>}
      </td>
      <td className="px-2 py-1.5">
        {editing ? <select className="border rounded px-1 py-0.5 text-[11px]" value={editData.priority ?? ''} onChange={(e) => setEditData((d) => ({ ...d, priority: e.target.value }))}>
          <option value="core">Core</option><option value="satellite">Satellite</option><option value="trading">Trading</option><option value="watchlist">Watchlist</option>
        </select> : <span className={`text-[11px] px-1.5 py-0.5 rounded ${priorityColors[pos.priority] || 'bg-slate-100 text-slate-500'}`}>{pos.priority}</span>}
      </td>
      <td className="px-2 py-1.5 text-right">{fmtMoney(pos.positionAmount)}</td>
      <td className="px-2 py-1.5 text-right">{fmtPct(pos.positionWeight)}</td>
      <td className="px-2 py-1.5 text-right">{fmtMoney(pos.marketCapRmb)}</td>
      <td className="px-2 py-1.5 text-right">{fmtNum(pos.pe2026)}</td>
      <td className={`px-2 py-1.5 text-right ${pnlColor(pos.pnl)}`}>{fmtMoney(pos.pnl)}</td>
      <td className={`px-2 py-1.5 text-right ${pnlColor(pos.return1d)}`}>{pos.return1d != null ? fmtPct(pos.return1d) : '-'}</td>
      <td className={`px-2 py-1.5 text-right ${pnlColor(pos.return1m)}`}>{pos.return1m != null ? fmtPct(pos.return1m) : '-'}</td>
      <td className="px-2 py-1.5 text-slate-500 text-[11px]">
        {editing ? <select className="border rounded px-1 py-0.5 text-[11px] w-full" value={editData.sectorId ?? ''} onChange={(e) => setEditData((d) => ({ ...d, sectorId: e.target.value ? Number(e.target.value) : null }))}>
          <option value="">-</option>{taxonomies.sectors.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select> : pos.sector?.name || '-'}
      </td>
      <td className="px-2 py-1.5 text-slate-500 text-[11px]">
        {editing ? <select className="border rounded px-1 py-0.5 text-[11px] w-full" value={editData.themeId ?? ''} onChange={(e) => setEditData((d) => ({ ...d, themeId: e.target.value ? Number(e.target.value) : null }))}>
          <option value="">-</option>{taxonomies.themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select> : pos.theme?.name || '-'}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {editing ? <>
            <button onClick={saveEdit} className="p-0.5 rounded hover:bg-blue-100 text-blue-600"><Check size={13} /></button>
            <button onClick={() => setEditing(false)} className="p-0.5 rounded hover:bg-slate-200 text-slate-400"><X size={13} /></button>
          </> : <button onClick={startEdit} className="p-0.5 rounded hover:bg-slate-200 text-slate-400" title="编辑"><Edit3 size={13} /></button>}
          <button onClick={() => onDelete(pos.id)} className="p-0.5 rounded hover:bg-red-100 text-red-400" title="删除"><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  );
}

// ─── Trades Panel ───
function TradesPanel() {
  const [trades, setTrades] = useState<TradeWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const loadTrades = useCallback(async () => {
    setLoading(true);
    try { const res = await api.getTrades(); setTrades(res.data?.data || []); } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadTrades(); }, [loadTrades]);

  const handleExport = async (id: number) => {
    try {
      const res = await api.exportTrade(id);
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `trade_${id}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  };
  const handleDelete = async (id: number) => { if (!confirm('确认删除此交易？')) return; try { await api.deleteTrade(id); loadTrades(); } catch (e) { console.error(e); } };
  const statusColors: Record<string, string> = { draft: 'bg-slate-100 text-slate-600', pending: 'bg-amber-100 text-amber-700', executed: 'bg-blue-100 text-blue-700', cancelled: 'bg-red-100 text-red-600' };

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>;
  return (
    <div className="space-y-3">
      {trades.length === 0 ? <div className="text-center text-slate-400 text-sm py-12">暂无交易记录</div> : trades.map((trade) => (
        <div key={trade.id} className="bg-white rounded border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">Trade #{trade.id}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${statusColors[trade.status] || 'bg-slate-100'}`}>{trade.status}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>{new Date(trade.createdAt).toLocaleDateString('zh-CN')}</span>
              <button onClick={() => handleExport(trade.id)} className="p-1 rounded hover:bg-slate-100" title="导出"><FileDown size={13} /></button>
              <button onClick={() => handleDelete(trade.id)} className="p-1 rounded hover:bg-red-100 text-red-400" title="删除"><Trash2 size={13} /></button>
            </div>
          </div>
          {trade.note && <p className="text-[11px] text-slate-500 mb-2">{trade.note}</p>}
          <table className="w-full text-[11px]">
            <thead><tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left px-1 py-1">Ticker</th><th className="text-left px-1 py-1">名称</th>
              <th className="text-left px-1 py-1">方向</th><th className="text-right px-1 py-1">GMV(K)</th><th className="text-left px-1 py-1">原因</th>
            </tr></thead>
            <tbody>{trade.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-50">
                <td className="px-1 py-1 font-mono">{item.tickerBbg}</td><td className="px-1 py-1">{item.name}</td>
                <td className={`px-1 py-1 ${item.transactionType === 'buy' ? 'text-emerald-600' : 'text-red-500'}`}>{item.transactionType === 'buy' ? 'Buy' : 'Sell'}{item.unwind ? ' (Unwind)' : ''}</td>
                <td className="px-1 py-1 text-right">{item.gmvUsdK === -1 ? 'All' : fmtNum(item.gmvUsdK, 0)}</td>
                <td className="px-1 py-1 text-slate-500">{item.reason}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Research Panel ───
const RESEARCH_FIELDS: { key: keyof CompanyResearch; label: string }[] = [
  { key: 'strategy', label: '投资策略' }, { key: 'tam', label: 'TAM' }, { key: 'competition', label: '竞争格局' },
  { key: 'valueProposition', label: '价值主张' }, { key: 'longTermFactors', label: '长期因素' }, { key: 'outlook3to5y', label: '3-5年展望' },
  { key: 'businessQuality', label: '商业质量' }, { key: 'trackingData', label: '跟踪数据' }, { key: 'valuation', label: '估值' },
  { key: 'revenueDownstream', label: '下游收入' }, { key: 'revenueProduct', label: '产品收入' }, { key: 'revenueCustomer', label: '客户收入' },
  { key: 'profitSplit', label: '利润拆分' }, { key: 'leverage', label: '杠杆/负债' }, { key: 'peerComparison', label: '同行对比' },
  { key: 'costStructure', label: '成本结构' }, { key: 'equipment', label: '设备/资本开支' }, { key: 'notes', label: '备注' },
];

function ResearchPanel({ positions }: { positions: PositionWithRelations[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [research, setResearch] = useState<Partial<CompanyResearch>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const selectedPos = positions.find((p) => p.id === selectedId);

  const loadResearch = useCallback(async (posId: number) => {
    setLoading(true);
    try { const res = await api.getResearch(posId); setResearch(res.data?.data || {}); } catch { setResearch({}); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (selectedId) loadResearch(selectedId); }, [selectedId, loadResearch]);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try { await api.saveResearch(selectedId, research); } catch (e) { console.error(e); } finally { setSaving(false); }
  };

  const handleAiFill = async () => {
    if (!selectedId) return;
    setAiLoading(true);
    try {
      await api.aiFillResearch({ positionId: selectedId, providerId: 'gemini', model: 'gemini-3-flash-preview' });
      await loadResearch(selectedId);
    } catch (e) { console.error(e); } finally { setAiLoading(false); }
  };

  return (
    <div className="flex h-full gap-4">
      {/* Position list */}
      <div className="w-56 shrink-0 bg-white rounded border border-slate-200 overflow-auto">
        <div className="p-2 border-b border-slate-100 text-[11px] font-semibold text-slate-500">选择持仓查看研究</div>
        {positions.filter((p) => p.longShort !== 'watchlist').map((p) => (
          <button key={p.id} onClick={() => setSelectedId(p.id)}
            className={`w-full text-left px-3 py-1.5 text-[12px] border-b border-slate-50 hover:bg-slate-50 ${selectedId === p.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}>
            {p.nameCn || p.nameEn}
            <span className="text-[10px] text-slate-400 ml-1">{p.tickerBbg}</span>
          </button>
        ))}
      </div>
      {/* Research form */}
      <div className="flex-1 bg-white rounded border border-slate-200 overflow-auto p-4">
        {!selectedId ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">选择一个持仓查看研究</div>
        ) : loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">{selectedPos?.nameCn || selectedPos?.nameEn} - 研究</h3>
              <div className="flex gap-2">
                <button onClick={handleAiFill} disabled={aiLoading} className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-blue-200 text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50">
                  <Sparkles size={12} className={aiLoading ? 'animate-spin' : ''} />
                  {aiLoading ? 'AI 填充中...' : 'AI 自动填充'}
                </button>
                <PrimaryButton onClick={handleSave} disabled={saving} size="sm">
                  {saving ? '保存中...' : '保存'}
                </PrimaryButton>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {RESEARCH_FIELDS.map(({ key, label }) => (
                <div key={key} className={key === 'notes' ? 'col-span-2' : ''}>
                  <label className="block text-[11px] text-slate-500 mb-0.5">{label}</label>
                  <textarea
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-[12px] min-h-[60px] resize-y"
                    value={(research as any)[key] || ''}
                    onChange={(e) => setResearch((r) => ({ ...r, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Taxonomy Panel ───
function TaxonomyPanel() {
  const [type, setType] = useState<'theme' | 'topdown'>('theme');
  const [items, setItems] = useState<TaxonomyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    try { const res = await api.getTaxonomies(type); setItems(res.data?.data || []); } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [type]);
  useEffect(() => { loadItems(); }, [loadItems]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try { await api.createTaxonomy({ type, name: newName.trim() }); setNewName(''); loadItems(); } catch (e) { console.error(e); }
  };
  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    try { await api.updateTaxonomy(id, { name: editName.trim() }); setEditingId(null); loadItems(); } catch (e) { console.error(e); }
  };
  const handleDelete = async (id: number) => {
    if (!confirm('删除此分类？关联的持仓分类将被清除。')) return;
    try { await api.deleteTaxonomy(id); loadItems(); } catch (e) { console.error(e); }
  };

  const typeLabels = { theme: '主题', topdown: '策略' };

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2 mb-4">
        {(['theme', 'topdown'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`px-3 py-1 text-[11px] font-medium rounded ${type === t ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>
            {typeLabels[t]}
          </button>
        ))}
      </div>
      {/* Add new */}
      <div className="flex gap-2 mb-3">
        <input className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder={`新增${typeLabels[type]}...`} value={newName}
          onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <PrimaryButton onClick={handleCreate}><Plus size={13} /></PrimaryButton>
      </div>
      {loading ? <div className="text-slate-400 text-sm">加载中...</div> : (
        <div className="bg-white rounded border border-slate-200">
          {items.length === 0 ? <div className="text-center text-slate-400 text-sm py-8">暂无{typeLabels[type]}</div> : items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2 border-b border-slate-100 last:border-0">
              {editingId === item.id ? (
                <input className="flex-1 border rounded px-2 py-0.5 text-sm mr-2" value={editName} onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUpdate(item.id)} autoFocus />
              ) : <span className="text-sm text-slate-700">{item.name}</span>}
              <div className="flex items-center gap-1">
                {editingId === item.id ? <>
                  <button onClick={() => handleUpdate(item.id)} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Check size={13} /></button>
                  <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-slate-200 text-slate-400"><X size={13} /></button>
                </> : <>
                  <button onClick={() => { setEditingId(item.id); setEditName(item.name); }} className="p-1 rounded hover:bg-slate-200 text-slate-400"><Edit3 size={13} /></button>
                  <button onClick={() => handleDelete(item.id)} className="p-1 rounded hover:bg-red-100 text-red-400"><Trash2 size={13} /></button>
                </>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Name Mapping Panel ───
function ImportHistoryPanel() {
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const res = await api.getImportHistory(); setHistory(res.data?.data || []); } catch (e) { console.error(e); } finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>;
  return (
    <div className="max-w-2xl">
      {history.length === 0 ? <div className="text-center text-slate-400 text-sm py-12">暂无导入记录</div> : (
        <div className="bg-white rounded border border-slate-200">
          <table className="w-full text-[12px]">
            <thead><tr className="text-[11px] text-slate-400 border-b border-slate-200 bg-slate-50">
              <th className="text-left px-3 py-1.5">时间</th><th className="text-left px-3 py-1.5">文件</th><th className="text-left px-3 py-1.5">类型</th>
              <th className="text-right px-3 py-1.5">总数</th><th className="text-right px-3 py-1.5">新增</th><th className="text-right px-3 py-1.5">更新</th>
            </tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id} className="border-b border-slate-50">
                <td className="px-3 py-1.5 text-slate-500">{new Date(h.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-3 py-1.5 text-slate-700">{h.fileName}</td>
                <td className="px-3 py-1.5 text-slate-500">{h.importType}</td>
                <td className="px-3 py-1.5 text-right">{h.recordCount}</td>
                <td className="px-3 py-1.5 text-right text-blue-600">{h.newCount}</td>
                <td className="px-3 py-1.5 text-right text-blue-600">{h.updatedCount}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════
// ─── Main Portfolio View ───
// ═══════════════════════════════════════════
export const PortfolioView = memo(function PortfolioView() {
  const [activeTab, setActiveTab] = useState<ViewTab>('positions');
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [taxonomies, setTaxonomies] = useState<{ sectors: TaxonomyItem[]; themes: TaxonomyItem[]; topdowns: TaxonomyItem[] }>({ sectors: [], themes: [], topdowns: [] });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortField, setSortField] = useState<SortField>('positionWeight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [researchPosId, setResearchPosId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    window.dispatchEvent(new Event('portfolio-data-updated'));
  }, []);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try {
      const response = await api.updatePrices();
      await loadData();
      const result = response.data?.data;
      if (result?.failed > 0) {
        const firstFailure = result.failures?.[0];
        toast.warning(`Price refresh partially failed: ${result.updated} updated, ${result.failed} failed`, {
          description: firstFailure ? `${firstFailure.tickerBbg}: ${firstFailure.error}` : undefined,
        });
      } else {
        toast.success(`Price refresh updated ${result?.updated ?? 0} positions`);
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Price refresh failed', {
        description: e?.response?.data?.error || e?.message || 'Unable to update portfolio returns.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      try { await api.importPositions(file); await loadData(); } catch (err) { console.error(err); }
    };
    input.click();
  };

  const handleUpdatePosition = async (id: number, data: Partial<PositionWithRelations>) => {
    try { await api.updatePosition(id, data); await loadData(); } catch (e) { console.error(e); }
  };
  const handleDeletePosition = async (id: number) => {
    if (!confirm('确认删除此持仓？')) return;
    try { await api.deletePosition(id); await loadData(); } catch (e) { console.error(e); }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const filteredPositions = useMemo(() => {
    let result = positions;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.nameCn?.toLowerCase().includes(q) || p.nameEn?.toLowerCase().includes(q) || p.tickerBbg?.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      const av = a[sortField] ?? 0, bv = b[sortField] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [positions, search, sortField, sortDir]);

  const groupedPositions = useMemo(() => {
    if (groupBy === 'none') return { '': filteredPositions };
    const groups: Record<string, PositionWithRelations[]> = {};
    filteredPositions.forEach((p) => {
      let key = '未分类';
      if (groupBy === 'sector') key = p.sector?.name || '未分类';
      else if (groupBy === 'theme') key = p.theme?.name || '未分类';
      else if (groupBy === 'topdown') key = p.topdown?.name || '未分类';
      else if (groupBy === 'longShort') key = p.longShort === 'long' ? 'Long' : 'Short';
      else if (groupBy === 'priority') key = p.priority || '未分类';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return groups;
  }, [filteredPositions, groupBy]);

  const SortHeader = ({ field, label, align = 'left' }: { field: SortField; label: string; align?: string }) => (
    <th className={`px-2 py-1.5 cursor-pointer hover:bg-slate-100 select-none ${align === 'right' ? 'text-right' : 'text-left'}`} onClick={() => handleSort(field)}>
      <span className="inline-flex items-center gap-0.5">{label}
        {sortField === field ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-30" />}
      </span>
    </th>
  );

  const portfolioSidebar = (
    <div className="flex flex-col h-full bg-slate-50 w-full">
      <div className="flex items-center gap-2 px-2 border-b border-slate-200 shrink-0 bg-white" style={{ minHeight: 38 }}>
        <BarChart3 className="text-slate-500 h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-semibold text-slate-700">Portfolio</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {(Object.keys(TAB_LABELS) as ViewTab[]).map((tab) => {
          const Icon = TAB_ICONS[tab];
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
                isActive
                ? 'bg-blue-100 text-blue-800 font-medium'
                : 'text-slate-500 hover:bg-slate-100'
              }`}>
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="w-full h-full bg-slate-50 text-slate-800 overflow-hidden">
      <ResponsiveLayout sidebar={portfolioSidebar} sidebarWidth={240} drawerTitle="Portfolio" mobileOpenerView="portfolio">
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="absolute top-3 right-3 md:top-4 md:right-4 flex items-center gap-2 z-10">
          {activeTab === 'positions' && (
            <PrimaryButton onClick={() => setShowAddModal(true)} icon={<Plus size={13} />}>Add</PrimaryButton>
          )}

          {activeTab === 'history' && (
            <PrimaryButton onClick={handleImport} icon={<Upload size={13} />}>Upload File</PrimaryButton>
          )}
        </div>

        <div className="mobile-scroll-container flex-1 overflow-auto p-3 md:p-6">
          {loading && (activeTab === 'positions' || activeTab === 'dashboard') ? (
            <div className="flex h-full items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-slate-400" /></div>
          ) : activeTab === 'trades' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Trades</h2>
              </div>
              <TradesPanel />
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Import Records</h2>
              </div>
              <ImportHistoryPanel />
            </div>
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-slate-400" /></div>}>
              {activeTab === 'dashboard' ? (
                <DashboardView />
              ) : activeTab === 'positions' ? (
                <PositionsView />
              ) : activeTab === 'screener' ? (
                <ScreenerView />
              ) : activeTab === 'technical' ? (
                <TechnicalAnalysisView />
              ) : (
                <ImpactView />
              )}
            </Suspense>
          )}
        </div>
      </div>
      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} onCreated={loadData} />}
      </ResponsiveLayout>
    </div>
  );
});
