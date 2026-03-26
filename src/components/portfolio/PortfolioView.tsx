import './portfolio.css';
import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardView } from './views/DashboardView';
import {
  RefreshCw, Upload, Plus, Trash2, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, DollarSign, BarChart3, Search, X,
  Edit3, Check, ArrowUpDown, ArrowUp, ArrowDown, FileDown,
  BookOpen, Tag, Languages, Sparkles, History, Settings,
} from 'lucide-react';
import type {
  PositionWithRelations,
  PortfolioSummary,
  SummaryByDimension,
  TaxonomyItem,
  TradeWithItems,
  CompanyResearch,
  NameMapping,
  ImportHistoryItem,
  PortfolioSettings,
} from '../../aiprocess/types/portfolio';
import * as api from '../../aiprocess/api/portfolio';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, Treemap,
} from 'recharts';

type ViewTab = 'dashboard' | 'positions' | 'trades' | 'research' | 'taxonomy' | 'namemap' | 'history' | 'settings';
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
  dashboard: BarChart3, positions: BookOpen, trades: ArrowUpDown, research: Search,
  taxonomy: Tag, namemap: Languages, history: History, settings: Settings,
};
const TAB_LABELS: Record<ViewTab, string> = {
  dashboard: 'Dashboard', positions: 'Positions', trades: 'Trades', research: 'Research',
  taxonomy: 'Taxonomy', namemap: 'Name Map', history: 'Import', settings: 'Settings',
};

// ─── Summary Cards ───
function SummaryCards({ summary }: { summary: PortfolioSummary | null }) {
  if (!summary) return null;
  const cards = [
    { label: 'AUM', value: fmtMoney(summary.aum), icon: DollarSign, color: 'text-blue-600 bg-blue-50' },
    { label: 'Long', value: `${fmtPct(summary.totalLong / (summary.aum || 1))} (${summary.longCount})`, icon: TrendingUp, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Short', value: `${fmtPct(summary.totalShort / (summary.aum || 1))} (${summary.shortCount})`, icon: TrendingDown, color: 'text-red-500 bg-red-50' },
    { label: 'NMV', value: fmtPct(summary.nmv / (summary.aum || 1)), icon: BarChart3, color: 'text-violet-600 bg-violet-50' },
    { label: 'GMV', value: fmtPct(summary.gmv / (summary.aum || 1)), icon: BarChart3, color: 'text-indigo-600 bg-indigo-50' },
    { label: 'P&L', value: fmtMoney(summary.totalPnl), icon: summary.totalPnl >= 0 ? TrendingUp : TrendingDown, color: summary.totalPnl >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50' },
  ];
  return (
    <div className="grid grid-cols-6 gap-3 mb-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="bg-white rounded-lg border border-slate-200 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${c.color}`}><Icon size={13} /></div>
              <span className="text-[11px] text-slate-400 font-medium">{c.label}</span>
            </div>
            <div className="text-sm font-semibold text-slate-800">{c.value}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart Colors ───
const CHART_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#a855f7'];
const PIE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

// ─── Exposure Stacked Bar Chart ───
function ExposureChart({ data, title }: { data: SummaryByDimension[]; title: string }) {
  if (!data || data.length === 0) return null;
  const chartData = data.filter((d) => d.long > 0 || d.short > 0).map((d) => ({
    name: d.name || '未分类',
    Long: Math.round(d.long / 1000),
    Short: Math.round(-d.short / 1000),
    NMV: Math.round(d.nmv / 1000),
    PnL: Math.round(d.pnl / 1000),
  }));
  if (chartData.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-600 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 28 + 40)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}K`} />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value) => `${value}K`} contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="Long" fill="#10b981" stackId="a" radius={[0, 2, 2, 0]} />
          <Bar dataKey="Short" fill="#ef4444" stackId="a" radius={[2, 0, 0, 2]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Pie Chart for allocation ───
function AllocationPie({ data, title }: { data: SummaryByDimension[]; title: string }) {
  if (!data || data.length === 0) return null;
  const pieData = data.filter((d) => d.gmv > 0).map((d) => ({ name: d.name || '未分类', value: Math.round(d.gmv / 1000) }));
  if (pieData.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-600 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} paddingAngle={2} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }} style={{ fontSize: 10 }}>
            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => `${value}K`} contentStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Treemap for position sizes ───
function PositionTreemap({ positions }: { positions: PositionWithRelations[] }) {
  const data = positions
    .filter((p) => p.positionAmount > 0 && p.longShort !== 'watchlist')
    .map((p) => ({
      name: p.nameCn || p.nameEn || p.tickerBbg,
      size: Math.abs(p.positionAmount),
      pnl: p.pnl || 0,
      longShort: p.longShort,
    }));
  if (data.length === 0) return null;

  const CustomContent = (props: any) => {
    const { x, y, width, height, name, pnl, longShort } = props;
    if (width < 30 || height < 20) return null;
    const bg = longShort === 'short' ? '#fecaca' : pnl > 0 ? '#d1fae5' : pnl < 0 ? '#fee2e2' : '#e2e8f0';
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={bg} stroke="#fff" strokeWidth={2} rx={3} />
        {width > 40 && height > 25 && (
          <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(11, width / 6)} fill="#334155">
            {name}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-600 mb-2">持仓规模 Treemap</div>
      <ResponsiveContainer width="100%" height={260}>
        <Treemap data={data} dataKey="size" nameKey="name" content={<CustomContent />}>
          <Tooltip formatter={(value) => fmtMoney(value as number)} contentStyle={{ fontSize: 11 }} />
        </Treemap>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 inline-block" />盈利</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" />亏损</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 inline-block" />Short</span>
      </div>
    </div>
  );
}

// ─── P&L Bar Chart by position ───
function PnlChart({ positions }: { positions: PositionWithRelations[] }) {
  const data = positions
    .filter((p) => p.pnl != null && p.pnl !== 0)
    .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))
    .slice(0, 20)
    .map((p) => ({
      name: p.nameCn || p.nameEn || p.tickerBbg,
      PnL: Math.round((p.pnl || 0) / 1000),
    }));
  if (data.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-600 mb-2">Top P&L 贡献 (K USD)</div>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 22 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}K`} />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(value) => `${value}K`} contentStyle={{ fontSize: 11 }} />
          <Bar dataKey="PnL" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.PnL >= 0 ? '#10b981' : '#ef4444'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Dashboard Charts Section ───
function DashboardCharts({ summary, positions }: { summary: PortfolioSummary | null; positions: PositionWithRelations[] }) {
  if (!summary) return null;
  return (
    <div className="space-y-4 mb-4">
      {/* Row 1: Treemap + PnL */}
      <div className="grid grid-cols-2 gap-4">
        <PositionTreemap positions={positions} />
        <PnlChart positions={positions} />
      </div>
      {/* Row 2: Exposure charts */}
      <div className="grid grid-cols-2 gap-4">
        <ExposureChart data={summary.bySector} title="板块敞口 Long/Short (K USD)" />
        <AllocationPie data={summary.bySector} title="板块 GMV 分布" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ExposureChart data={summary.byTheme} title="主题敞口 Long/Short (K USD)" />
        <ExposureChart data={summary.byTopdown} title="策略敞口 Long/Short (K USD)" />
      </div>
      {(summary.byGicIndustry?.length > 0 || summary.byExchangeCountry?.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {summary.byGicIndustry?.length > 0 && <AllocationPie data={summary.byGicIndustry} title="GIC 行业分布" />}
          {summary.byExchangeCountry?.length > 0 && <AllocationPie data={summary.byExchangeCountry} title="交易所国家分布" />}
        </div>
      )}
    </div>
  );
}

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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
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
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded">取消</button>
          <button onClick={handleSave} disabled={saving || !form.tickerBbg.trim()} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
            {saving ? '保存中...' : '创建'}
          </button>
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
  const priorityColors: Record<string, string> = { core: 'bg-emerald-100 text-emerald-700', satellite: 'bg-blue-100 text-blue-700', watchlist: 'bg-slate-100 text-slate-500', trading: 'bg-amber-100 text-amber-700' };

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 text-[12px]">
      <td className="px-2 py-1.5 font-medium text-slate-800">
        {editing ? <input className="w-full border rounded px-1 py-0.5 text-[12px]" value={editData.nameCn ?? ''} onChange={(e) => setEditData((d) => ({ ...d, nameCn: e.target.value }))} />
          : <button onClick={() => onViewResearch(pos)} className="hover:text-emerald-600 hover:underline text-left">{pos.nameCn || pos.nameEn}</button>}
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
            <button onClick={saveEdit} className="p-0.5 rounded hover:bg-emerald-100 text-emerald-600"><Check size={13} /></button>
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
  const statusColors: Record<string, string> = { draft: 'bg-slate-100 text-slate-600', pending: 'bg-amber-100 text-amber-700', executed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-600' };

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>;
  return (
    <div className="space-y-3">
      {trades.length === 0 ? <div className="text-center text-slate-400 text-sm py-12">暂无交易记录</div> : trades.map((trade) => (
        <div key={trade.id} className="bg-white rounded-lg border border-slate-200 p-3">
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
      await api.aiFillResearch({ positionId: selectedId, providerId: 'gemini', model: 'gemini-2.5-flash' });
      await loadResearch(selectedId);
    } catch (e) { console.error(e); } finally { setAiLoading(false); }
  };

  return (
    <div className="flex h-full gap-4">
      {/* Position list */}
      <div className="w-56 shrink-0 bg-white rounded-lg border border-slate-200 overflow-auto">
        <div className="p-2 border-b border-slate-100 text-[11px] font-semibold text-slate-500">选择持仓查看研究</div>
        {positions.filter((p) => p.longShort !== 'watchlist').map((p) => (
          <button key={p.id} onClick={() => setSelectedId(p.id)}
            className={`w-full text-left px-3 py-1.5 text-[12px] border-b border-slate-50 hover:bg-slate-50 ${selectedId === p.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-700'}`}>
            {p.nameCn || p.nameEn}
            <span className="text-[10px] text-slate-400 ml-1">{p.tickerBbg}</span>
          </button>
        ))}
      </div>
      {/* Research form */}
      <div className="flex-1 bg-white rounded-lg border border-slate-200 overflow-auto p-4">
        {!selectedId ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">选择一个持仓查看研究</div>
        ) : loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">{selectedPos?.nameCn || selectedPos?.nameEn} - 研究</h3>
              <div className="flex gap-2">
                <button onClick={handleAiFill} disabled={aiLoading} className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-violet-200 text-violet-600 rounded-lg hover:bg-violet-50 disabled:opacity-50">
                  <Sparkles size={12} className={aiLoading ? 'animate-spin' : ''} />
                  {aiLoading ? 'AI 填充中...' : 'AI 自动填充'}
                </button>
                <button onClick={handleSave} disabled={saving} className="px-3 py-1 text-[11px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
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
  const [type, setType] = useState<'sector' | 'theme' | 'topdown'>('sector');
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

  const typeLabels = { sector: '板块', theme: '主题', topdown: '策略' };

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2 mb-4">
        {(['sector', 'theme', 'topdown'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`px-3 py-1 text-[11px] font-medium rounded-lg ${type === t ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>
            {typeLabels[t]}
          </button>
        ))}
      </div>
      {/* Add new */}
      <div className="flex gap-2 mb-3">
        <input className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder={`新增${typeLabels[type]}...`} value={newName}
          onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <button onClick={handleCreate} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"><Plus size={14} /></button>
      </div>
      {loading ? <div className="text-slate-400 text-sm">加载中...</div> : (
        <div className="bg-white rounded-lg border border-slate-200">
          {items.length === 0 ? <div className="text-center text-slate-400 text-sm py-8">暂无{typeLabels[type]}</div> : items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2 border-b border-slate-100 last:border-0">
              {editingId === item.id ? (
                <input className="flex-1 border rounded px-2 py-0.5 text-sm mr-2" value={editName} onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUpdate(item.id)} autoFocus />
              ) : <span className="text-sm text-slate-700">{item.name}</span>}
              <div className="flex items-center gap-1">
                {editingId === item.id ? <>
                  <button onClick={() => handleUpdate(item.id)} className="p-1 rounded hover:bg-emerald-100 text-emerald-600"><Check size={13} /></button>
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
function NameMapPanel() {
  const [mappings, setMappings] = useState<NameMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBbg, setNewBbg] = useState('');
  const [newCn, setNewCn] = useState('');
  const [aiTranslating, setAiTranslating] = useState(false);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try { const res = await api.getNameMappings(); setMappings(res.data?.data || []); } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { loadMappings(); }, [loadMappings]);

  const handleCreate = async () => {
    if (!newBbg.trim() || !newCn.trim()) return;
    try { await api.createNameMapping({ bbgName: newBbg.trim(), chineseName: newCn.trim() }); setNewBbg(''); setNewCn(''); loadMappings(); } catch (e) { console.error(e); }
  };
  const handleDelete = async (id: number) => {
    try { await api.deleteNameMapping(id); loadMappings(); } catch (e) { console.error(e); }
  };
  const handleAiTranslate = async () => {
    const unmapped = mappings.filter((m) => !m.chineseName).map((m) => m.bbgName);
    if (unmapped.length === 0) return;
    setAiTranslating(true);
    try { await api.aiTranslateNames({ bbgNames: unmapped, providerId: 'gemini', model: 'gemini-2.5-flash' }); await loadMappings(); } catch (e) { console.error(e); } finally { setAiTranslating(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>;
  return (
    <div className="max-w-2xl">
      <div className="flex gap-2 mb-3">
        <input className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder="BBG Name" value={newBbg} onChange={(e) => setNewBbg(e.target.value)} />
        <input className="flex-1 border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder="中文名" value={newCn} onChange={(e) => setNewCn(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <button onClick={handleCreate} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"><Plus size={14} /></button>
        <button onClick={handleAiTranslate} disabled={aiTranslating} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] border border-violet-200 text-violet-600 rounded hover:bg-violet-50 disabled:opacity-50">
          <Sparkles size={12} />{aiTranslating ? '翻译中...' : 'AI翻译'}
        </button>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-auto max-h-[60vh]">
        <table className="w-full text-[12px]">
          <thead><tr className="text-[11px] text-slate-400 border-b border-slate-200 bg-slate-50">
            <th className="text-left px-3 py-1.5">BBG Name</th><th className="text-left px-3 py-1.5">中文名</th><th className="w-10"></th>
          </tr></thead>
          <tbody>{mappings.map((m) => (
            <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="px-3 py-1.5 font-mono text-slate-600">{m.bbgName}</td>
              <td className="px-3 py-1.5 text-slate-800">{m.chineseName || <span className="text-slate-300">-</span>}</td>
              <td className="px-2 py-1.5"><button onClick={() => handleDelete(m.id)} className="p-0.5 rounded hover:bg-red-100 text-red-400"><Trash2 size={12} /></button></td>
            </tr>
          ))}</tbody>
        </table>
        {mappings.length === 0 && <div className="text-center text-slate-400 text-sm py-8">暂无名称映射</div>}
      </div>
    </div>
  );
}

// ─── Import History Panel ───
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
        <div className="bg-white rounded-lg border border-slate-200">
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
                <td className="px-3 py-1.5 text-right text-emerald-600">{h.newCount}</td>
                <td className="px-3 py-1.5 text-right text-blue-600">{h.updatedCount}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Settings Panel ───
function SettingsPanel() {
  const [settings, setSettings] = useState<Partial<PortfolioSettings>>({ aum: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    (async () => {
      try { const res = await api.getPortfolioSettings(); setSettings(res.data?.data || { aum: 0 }); } catch (e) { console.error(e); } finally { setLoading(false); }
    })();
  }, []);
  const handleSave = async () => {
    setSaving(true);
    try { await api.updatePortfolioSettings(settings); } catch (e) { console.error(e); } finally { setSaving(false); }
  };
  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>;
  return (
    <div className="max-w-md space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">AUM (USD)</label>
        <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={settings.aum || 0}
          onChange={(e) => setSettings((s) => ({ ...s, aum: Number(e.target.value) }))} />
      </div>
      <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
        {saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════
// ─── Main Portfolio View ───
// ═══════════════════════════════════════════
export const PortfolioView = memo(function PortfolioView() {
  const [activeTab, setActiveTab] = useState<ViewTab>('positions');
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [taxonomies, setTaxonomies] = useState<{ sectors: TaxonomyItem[]; themes: TaxonomyItem[]; topdowns: TaxonomyItem[] }>({ sectors: [], themes: [], topdowns: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortField, setSortField] = useState<SortField>('positionWeight');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [researchPosId, setResearchPosId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, sumRes, sectorRes, themeRes, topdownRes] = await Promise.all([
        api.getPositions(), api.getPortfolioSummary(), api.getTaxonomies('sector'), api.getTaxonomies('theme'), api.getTaxonomies('topdown'),
      ]);
      setPositions(posRes.data?.data || []);
      setSummary(sumRes.data?.data || null);
      setTaxonomies({ sectors: sectorRes.data?.data || [], themes: themeRes.data?.data || [], topdowns: topdownRes.data?.data || [] });
    } catch (e) { console.error('Failed to load portfolio data:', e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    try { await api.updatePrices(); await loadData(); } catch (e) { console.error(e); } finally { setRefreshing(false); }
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

  const handleViewResearch = (pos: PositionWithRelations) => {
    setResearchPosId(pos.id);
    setActiveTab('research');
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

  return (
    <div className="portfolio-theme w-full h-full flex bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] flex flex-col">
        <div className="p-5 flex items-center gap-3">
          <div className="h-8 w-8 bg-[var(--accent)] rounded flex items-center justify-center">
            <BarChart3 className="text-white h-5 w-5" />
          </div>
          <div>
            <h2 className="font-serif text-lg font-bold leading-tight">ACME</h2>
            <p className="small-caps text-[0.6rem] text-[var(--muted-foreground)]">Capital Management</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {(Object.keys(TAB_LABELS) as ViewTab[]).map((tab) => {
            const Icon = TAB_ICONS[tab];
            const isActive = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-all ${
                  isActive 
                  ? 'bg-[var(--accent)] text-[var(--sidebar-primary-foreground)] shadow-sm font-medium' 
                  : 'text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]'
                }`}>
                <Icon size={16} className={isActive ? 'opacity-100' : 'opacity-60'} />
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          {activeTab === 'positions' && (
            <>
              <div className="relative">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="pl-7 pr-2 py-1.5 text-xs border border-[var(--border)] rounded bg-white w-48 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] text-slate-800"
                  placeholder="Seach positions..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {search && <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>}
              </div>
              <select className="text-xs border border-[var(--border)] rounded bg-white px-2 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="none">No Grouping</option><option value="sector">Sector</option><option value="theme">Theme</option>
                <option value="topdown">Strategy</option><option value="longShort">Long/Short</option><option value="priority">Priority</option>
              </select>
              <button onClick={handleRefreshPrices} disabled={refreshing} className="flex items-center gap-1 px-3 py-1.5 text-xs border border-[var(--border)] bg-white rounded hover:bg-[var(--muted)] disabled:opacity-50 text-slate-800 transition-colors">
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
              <button onClick={() => setShowAddModal(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--accent)] text-white font-medium rounded hover:opacity-90 transition-opacity shadow-sm">
                <Plus size={13} /> Add
              </button>
            </>
          )}
          {activeTab === 'history' && (
            <button onClick={handleImport} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[var(--accent)] text-white font-medium rounded hover:opacity-90 shadow-sm">
              <Upload size={13} /> Upload File
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6 md:p-8">
          {loading && (activeTab === 'positions' || activeTab === 'dashboard') ? (
            <div className="flex h-full items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-[var(--accent)]" /></div>
          ) : activeTab === 'dashboard' ? (
            <DashboardView />
          ) : activeTab === 'positions' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Positions</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <div className="bg-white rounded-lg border border-[var(--border)] shadow-sm overflow-hidden text-slate-800">
                {Object.entries(groupedPositions).map(([group, items]) => (
                  <div key={group}>
                    {group && groupBy !== 'none' && (
                      <div className="px-4 py-2 bg-[var(--muted)] border-b border-[var(--border)] text-xs font-semibold text-[var(--foreground)]">{group} ({items.length})</div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr className="text-xs text-[var(--muted-foreground)] border-b border-[var(--border)] bg-white/50">
                          <SortHeader field="nameCn" label="Name" /><SortHeader field="tickerBbg" label="Ticker" />
                          <th className="px-2 py-2 text-left font-medium">L/S</th><SortHeader field="priority" label="Priority" />
                          <SortHeader field="positionAmount" label="Size(USD)" align="right" /><SortHeader field="positionWeight" label="Wgt%" align="right" />
                          <SortHeader field="marketCapRmb" label="Mkt Cap(RMB)" align="right" /><SortHeader field="pe2026" label="PE 26E" align="right" />
                          <SortHeader field="pnl" label="P&L" align="right" />
                          <th className="px-2 py-2 text-right font-medium">1D</th><th className="px-2 py-2 text-right font-medium">1M</th>
                          <th className="px-2 py-2 text-left font-medium">Sector</th><th className="px-2 py-2 text-left font-medium">Theme</th><th className="px-2 py-2 w-16"></th>
                        </tr></thead>
                        <tbody>{items.map((pos) => (
                          <PositionRow key={pos.id} pos={pos} taxonomies={taxonomies} onUpdate={handleUpdatePosition} onDelete={handleDeletePosition} onViewResearch={handleViewResearch} />
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {filteredPositions.length === 0 && (
                  <div className="text-center text-[var(--muted-foreground)] text-sm py-16">{search ? 'No matching positions' : 'No positions data'}</div>
                )}
              </div>
            </div>
          ) : activeTab === 'trades' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Trades</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <TradesPanel />
            </div>
          ) : activeTab === 'research' ? (
            <div className="space-y-4 h-full flex flex-col pb-4">
              <div className="mb-2 shrink-0">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Research Analysis</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <div className="flex-1 overflow-hidden">
                <ResearchPanel positions={positions} />
              </div>
            </div>
          ) : activeTab === 'taxonomy' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Taxonomy</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <TaxonomyPanel />
            </div>
          ) : activeTab === 'namemap' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Name Mapping</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <NameMapPanel />
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Import Records</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <ImportHistoryPanel />
            </div>
          ) : (
             <div className="space-y-4">
              <div className="mb-2">
                <h1 className="font-serif text-2xl font-normal tracking-tight">Settings</h1>
                <div className="h-0.5 w-12 bg-[var(--accent)] mt-1 rounded-full" />
              </div>
              <SettingsPanel />
            </div>
          )}
        </div>
      </div>
      {showAddModal && <AddPositionModal onClose={() => setShowAddModal(false)} onCreated={loadData} />}
    </div>
  );
});