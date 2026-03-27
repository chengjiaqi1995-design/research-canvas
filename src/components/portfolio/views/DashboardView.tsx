import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { PieChart as EChartsPieChart, ScatterChart as EChartsScatterChart } from "echarts/charts";
import { TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { LabelLayout } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import { Loader2, Pencil, X, RefreshCw, CalendarDays } from "lucide-react";
import { Input } from "../../ui/input";
import type { PortfolioSummary, PositionWithRelations, SummaryByDimension } from "../../../aiprocess/types/portfolio";
import * as api from "../../../aiprocess/api/portfolio";

echarts.use([EChartsPieChart, EChartsScatterChart, TooltipComponent, LegendComponent, GridComponent, LabelLayout, CanvasRenderer]);

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatAum(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatUsdK(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

type Dimension = "topdown" | "sector" | "theme" | "riskCountry" | "gicIndustry" | "exchangeCountry";

const DIM_TABS: { key: Dimension; label: string }[] = [
  { key: "topdown", label: "Topdown" },
  { key: "sector", label: "Sector" },
  { key: "theme", label: "Theme" },
  { key: "riskCountry", label: "Risk Country" },
  { key: "gicIndustry", label: "GIC Industry" },
  { key: "exchangeCountry", label: "Exchange Country" },
];

const PIE_COLORS = [
  "#10b981", "#10b981", "#6366f1", "#f59e0b", "#8b5cf6",
  "#0ea5e9", "#14b8a6", "#84cc16", "#f43f5e", "#d946ef",
  "#10b981", "#10b981", "#6366f1", "#f59e0b", "#8b5cf6",
  "#0ea5e9", "#14b8a6", "#84cc16", "#f43f5e", "#d946ef",
];

function getDimData(summary: PortfolioSummary, dim: Dimension): SummaryByDimension[] {
  if (dim === "topdown") return summary.byTopdown || [];
  if (dim === "sector") return summary.byIndustry || summary.bySector || [];
  if (dim === "theme") return summary.byTheme || [];
  if (dim === "riskCountry") return summary.byRiskCountry || [];
  if (dim === "gicIndustry") return summary.byGicIndustry || [];
  return summary.byExchangeCountry || [];
}

function getDimValue(p: PositionWithRelations, dim: Dimension): string {
  if (dim === "topdown") return p.topdown?.name || "Other";
  if (dim === "sector") return p.sector?.name || "Other";
  if (dim === "theme") return p.theme?.name || "Other";
  if (dim === "riskCountry") return p.market || "Other";
  if (dim === "gicIndustry") return p.gicIndustry || "Other";
  return p.exchangeCountry || "Other";
}

// ===== ECharts Pie — with click callback =====
function EChartsPie({ data, formatter, height = 220, selected, onSelect }: {
  data: { name: string; value: number }[];
  formatter?: (value: number) => string;
  height?: number;
  selected?: string | null;
  onSelect?: (name: string | null) => void;
}) {
  const option = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#ffffff",
      borderColor: "#e2e8f0",
      borderWidth: 1,
      textStyle: { color: "#1e293b", fontSize: 11 },
      formatter: (params: any) => {
        const pct = params.percent.toFixed(1);
        const val = formatter ? formatter(params.value) : `${params.value}%`;
        return `<b>${params.name}</b><br/>${val} (${pct}%)`;
      },
    },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 0,
      top: "middle",
      textStyle: { fontSize: 9, color: "#64748b" },
      formatter: (name: string) => name.length > 8 ? name.slice(0, 8) + "\u2026" : name,
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 6,
    },
    series: [{
      type: "pie",
      radius: ["18%", "55%"],
      center: ["35%", "50%"],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 3, borderColor: "#FAFAF8", borderWidth: 2 },
      label: {
        show: true,
        formatter: (params: any) => {
          if (params.percent < 5) return "";
          return `${params.name}\n${params.percent.toFixed(1)}%`;
        },
        fontSize: 9,
        lineHeight: 12,
        color: "#1e293b",
      },
      labelLine: { show: true, length: 4, length2: 8, lineStyle: { color: "#e2e8f0" } },
      emphasis: {
        label: { show: true, fontSize: 11, fontWeight: "bold" },
        itemStyle: { shadowBlur: 8, shadowColor: "rgba(59,130,246,0.2)" },
      },
      data: data.map((d, i) => ({
        ...d,
        itemStyle: {
          color: PIE_COLORS[i % PIE_COLORS.length],
          opacity: selected && selected !== d.name ? 0.3 : 1,
        },
      })),
    }],
  };

  const onEvents: Record<string, Function> | undefined = onSelect ? {
    click: (params: any) => {
      onSelect(params.name === selected ? null : params.name);
    },
  } : undefined;

  return (
    <ReactEChartsCore echarts={echarts} option={option} onEvents={onEvents}
      style={{ height, width: "100%", cursor: onSelect ? "pointer" : "default" }}
      opts={{ renderer: "canvas" }} notMerge={true} />
  );
}

function calcYAxisWidth(data: { name: string }[]) {
  if (data.length === 0) return 60;
  const maxLen = Math.max(...data.map(d => d.name.length));
  return Math.min(Math.max(maxLen * 7, 60), 130);
}

// ===== ECharts Scatter — GMV vs PNL =====
function EChartsScatter({ data, height = 220 }: {
  data: { name: string; gmv: number; pnl: number; isLong: boolean }[];
  height?: number;
}) {
  const option = {
    grid: { top: 20, right: 20, bottom: 35, left: 55 },
    tooltip: {
      trigger: "item",
      backgroundColor: "#ffffff",
      borderColor: "#e2e8f0",
      borderWidth: 1,
      textStyle: { color: "#1e293b", fontSize: 11 },
      formatter: (params: any) => {
        const d = params.data;
        return `<b>${d.value[2]}</b><br/>GMV: ${formatUsdK(d.value[0])}<br/>PNL: <span style="color:${d.value[1] >= 0 ? '#2D6A4F' : '#C0392B'}">${formatUsdK(d.value[1])}</span>`;
      },
    },
    xAxis: {
      type: "value",
      name: "GMV",
      nameTextStyle: { fontSize: 9, color: "#64748b" },
      axisLabel: { fontSize: 8, color: "#64748b", formatter: (v: number) => formatUsdK(v) },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    yAxis: {
      type: "value",
      name: "PNL",
      nameTextStyle: { fontSize: 9, color: "#64748b" },
      axisLabel: { fontSize: 8, color: "#64748b", formatter: (v: number) => formatUsdK(v) },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } },
    },
    series: [{
      type: "scatter",
      symbolSize: 5,
      label: {
        show: true,
        formatter: (params: any) => params.value[2],
        position: "top",
        fontSize: 7,
        color: "#64748b",
        overflow: "truncate",
        width: 60,
      },
      labelLayout: { hideOverlap: true },
      data: data.map(d => ({
        value: [d.gmv, d.pnl, d.name, d.isLong],
        itemStyle: { color: d.isLong ? "#10b981" : "#cbd5e1", opacity: 0.8 },
      })),
    }],
  };

  return (
    <ReactEChartsCore echarts={echarts} option={option}
      style={{ height, width: "100%" }}
      opts={{ renderer: "canvas" }} notMerge={true} />
  );
}

export function DashboardView() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<Dimension>("riskCountry");

  // Single unified selected category — shared across all 6 charts
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [editingAum, setEditingAum] = useState(false);
  const [aumInput, setAumInput] = useState("");
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [earningsEvents, setEarningsEvents] = useState<{ tickerBbg: string; nameEn: string; longShort: string; earningsDate: string; timing: string; positionAmount: number }[]>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('earningsEvents') || '[]'); } catch { return []; }
    }
    return [];
  });

  // Fetch earnings on mount, cache in localStorage
  useEffect(() => {
    api.getEarnings().then(r => r.data).then(data => {
      if (data?.data?.events) {
        setEarningsEvents(data.data.events);
        localStorage.setItem('earningsEvents', JSON.stringify(data.data.events));
      }
    }).catch(() => { });
  }, []);

  // Set of tickers with upcoming earnings for gold highlighting
  const earningsTickers = useMemo(() => new Set(earningsEvents.map(e => e.tickerBbg)), [earningsEvents]);

  async function refreshPrices() {
    setPriceRefreshing(true);
    try {
      await api.updatePrices();
      refreshData();
    } finally {
      setPriceRefreshing(false);
    }
  }

  function refreshData() {
    Promise.all([
      api.getPortfolioSummary().then((r) => r.data?.data),
      api.getPositions().then((r) => r.data?.data),
    ]).then(([sum, pos]) => {
      setSummary(sum || null);
      setPositions(pos || []);
    });
  }

  useEffect(() => { refreshData(); setLoading(false); }, []);

  async function saveAum() {
    const val = parseFloat(aumInput);
    if (!val || val <= 0) { setEditingAum(false); return; }
    await api.updatePortfolioSettings({ aum: val });
    setEditingAum(false);
    refreshData();
  }

  // Reset selection on dimension change
  useEffect(() => { setSelectedCategory(null); }, [dim]);

  const toggleCategory = useCallback((name: string | null) => {
    setSelectedCategory(prev => prev === name ? null : name);
  }, []);

  const dimData = useMemo(() => {
    if (!summary) return [];
    return getDimData(summary, dim);
  }, [summary, dim]);

  const netData = useMemo(() =>
    dimData.filter(d => Math.abs(d.nmv) > 0.001).sort((a, b) => b.nmv - a.nmv)
      .map(d => ({ name: d.name, nmv: +(d.nmv * 100).toFixed(1), long: +(d.long * 100).toFixed(1), short: +(d.short * 100).toFixed(1) })),
    [dimData]);

  const gmvData = useMemo(() =>
    dimData.filter(d => d.gmv > 0.001).sort((a, b) => b.gmv - a.gmv)
      .map(d => ({ name: d.name, gmv: +(d.gmv * 100).toFixed(1), long: +(d.long * 100).toFixed(1), short: +(d.short * 100).toFixed(1) })),
    [dimData]);

  const pnlData = useMemo(() =>
    dimData.filter(d => Math.abs(d.pnl) > 0.01).sort((a, b) => b.pnl - a.pnl)
      .map(d => ({ name: d.name, pnl: Math.round(d.pnl) })),
    [dimData]);

  const netPieData = useMemo(() =>
    dimData.filter(d => d.gmv > 0.001).sort((a, b) => b.gmv - a.gmv)
      .map(d => ({ name: d.name, value: +(Math.abs(d.nmv) * 100).toFixed(1) })),
    [dimData]);

  const gmvPieData = useMemo(() =>
    dimData.filter(d => d.gmv > 0.001).sort((a, b) => b.gmv - a.gmv)
      .map(d => ({ name: d.name, value: +(d.gmv * 100).toFixed(1) })),
    [dimData]);

  const pnlPieData = useMemo(() =>
    dimData.filter(d => Math.abs(d.pnl) > 0.01).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .map(d => ({ name: d.name, value: Math.round(Math.abs(d.pnl)) })),
    [dimData]);

  const longGmvPieData = useMemo(() =>
    dimData.filter(d => d.long > 0.001).sort((a, b) => b.long - a.long)
      .map(d => ({ name: d.name, value: +(d.long * 100).toFixed(1) })),
    [dimData]);

  const shortGmvPieData = useMemo(() =>
    dimData.filter(d => Math.abs(d.short) > 0.001).sort((a, b) => Math.abs(b.short) - Math.abs(a.short))
      .map(d => ({ name: d.name, value: +(Math.abs(d.short) * 100).toFixed(1) })),
    [dimData]);

  // Linked positions table — filtered by selected category
  const activePositions = useMemo(() => {
    return positions.filter(p =>
      // Active positions with NMV, or closed positions with PNL (NMV=0 but has direction from Avg NMV)
      ((p.longShort === "long" || p.longShort === "short") && (p.positionAmount > 0 || Math.abs(p.pnl || 0) > 0)) ||
      // Fallback: remaining "/" positions with PNL (no Avg NMV to determine direction)
      (p.longShort === "/" && Math.abs(p.pnl || 0) > 0)
    );
  }, [positions]);

  // Scatter plot data: all positions
  const scatterAllData = useMemo(() =>
    activePositions.map(p => ({
      name: p.nameEn,
      gmv: p.positionAmount,
      pnl: p.pnl || 0,
      isLong: p.longShort === "long",
    })),
    [activePositions]);

  // Scatter plot data: dimension aggregates (each dot = one category)
  const scatterDimData = useMemo(() => {
    if (!summary) return [];
    return dimData
      .filter(d => d.gmv > 0.001)
      .map(d => ({
        name: d.name,
        gmv: d.gmv * summary.aum,
        pnl: d.pnl,
        isLong: d.nmv >= 0,
      }));
  }, [dimData, summary]);

  const filteredPositions = useMemo(() => {
    if (!selectedCategory) return activePositions;
    return activePositions.filter(p => getDimValue(p, dim) === selectedCategory);
  }, [activePositions, selectedCategory, dim]);

  const longPositions = useMemo(() =>
    filteredPositions
      .filter(p => p.longShort === "long" || (p.longShort === "/" && (p.pnl || 0) > 0))
      .sort((a, b) => b.positionAmount - a.positionAmount),
    [filteredPositions]);

  const shortPositions = useMemo(() =>
    filteredPositions
      .filter(p => p.longShort === "short" || (p.longShort === "/" && (p.pnl || 0) < 0))
      .sort((a, b) => b.positionAmount - a.positionAmount),
    [filteredPositions]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }
  if (!summary) {
    return <div className="flex h-full items-center justify-center text-slate-500">Failed to load portfolio summary.</div>;
  }

  const statCards = [
    { label: "AUM", value: formatAum(summary.aum), sub: `${summary.longCount}L / ${summary.shortCount}S / ${summary.watchlistCount}W` },
    { label: "NMV%", value: formatPct(summary.nmv), color: summary.nmv >= 0 ? "text-emerald-700" : "text-rose-700" },
    { label: "GMV%", value: formatPct(summary.gmv), color: "text-emerald-600" },
    { label: "Long%", value: formatPct(summary.totalLong), color: "text-emerald-700" },
    { label: "Short%", value: formatPct(summary.totalShort), color: "text-rose-700" },
    { label: "PNL", value: formatUsdK(summary.totalPnl || 0), color: (summary.totalPnl || 0) >= 0 ? "text-emerald-700" : "text-rose-700" },
  ];

  const barHeight = (data: any[]) => Math.max(80, data.length * 22);
  const tooltipBox = "rounded-md border border-slate-200 bg-white p-2 text-xs shadow-md";

  function ReturnCell({ value }: { value: number | null | undefined }) {
    if (value == null) return <TableCell className="px-0.5 py-0.5 text-[10px] font-mono text-right text-slate-500">—</TableCell>;
    const pct = Math.round(value * 100);
    const color = value >= 0 ? "text-emerald-700" : "text-rose-700";
    return <TableCell className={`px-0.5 py-0.5 text-[10px] font-mono text-right ${color}`}>{value > 0 ? "+" : ""}{pct}%</TableCell>;
  }

  function PositionRow({ pos, idx }: { pos: PositionWithRelations; idx: number }) {
    const isLong = pos.longShort === "long";
    const hasEarnings = earningsTickers.has(pos.tickerBbg);
    return (
      <TableRow className="h-6">
        <TableCell className="px-1 py-0.5 text-[11px] text-slate-500 w-4">{idx + 1}</TableCell>
        <TableCell className={`px-1 py-0.5 text-[11px] font-medium truncate max-w-[80px] ${hasEarnings ? 'text-amber-600 font-semibold' : ''}`}>{pos.nameEn}</TableCell>
        <TableCell className="px-1 py-0.5 text-[9px] font-mono text-slate-500 truncate max-w-[70px]">{pos.tickerBbg.split(' / ')[0]}</TableCell>
        <TableCell className={`px-1 py-0.5 text-[11px] font-mono text-right font-medium ${isLong ? "text-emerald-700" : "text-rose-700"}`}>
          {formatPct(pos.positionAmount / (summary?.aum || 1))}
        </TableCell>
        <TableCell className={`px-1 py-0.5 text-[11px] font-mono text-right ${(pos.pnl || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {formatUsdK(pos.pnl || 0)}
        </TableCell>
        <ReturnCell value={pos.return1d} />
        <ReturnCell value={pos.return1m} />
        <ReturnCell value={pos.return1y} />
      </TableRow>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + Global Dimension Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl font-normal tracking-tight">Dashboard</h1>
          <div className="h-0.5 w-12 bg-emerald-600 mt-1 rounded-full" />
        </div>
        <div className="flex items-center gap-0.5 border border-slate-200 rounded-lg px-1 py-0.5">
          {DIM_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setDim(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-all duration-200 ${dim === tab.key
                ? "bg-emerald-600 text-white font-medium shadow-sm"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                }`}
              style={{ letterSpacing: "0.03em" }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
        {statCards.map(card => (
          <Card key={card.label} className="py-3 shadow-sm">
            <CardContent className="px-4 py-0">
              <p className="uppercase tracking-wider font-semibold text-[0.5625rem] mb-1">{card.label}</p>
              {card.label === "AUM" && editingAum ? (
                <Input autoFocus type="number" className="h-7 text-sm font-bold px-1 w-full"
                  value={aumInput} onChange={e => setAumInput(e.target.value)}
                  onBlur={saveAum} onKeyDown={e => { if (e.key === "Enter") saveAum(); if (e.key === "Escape") setEditingAum(false); }} />
              ) : (
                <p className={`font-semibold text-xl font-semibold ${card.color ?? ""} ${card.label === "AUM" ? "cursor-pointer hover:text-emerald-600 group inline-flex items-center gap-1 transition-colors" : ""}`}
                  onClick={card.label === "AUM" ? () => { setAumInput(String(summary.aum)); setEditingAum(true); } : undefined}>
                  {card.value}
                  {card.label === "AUM" && <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40" />}
                </p>
              )}
              {card.sub && <p className="text-[10px] text-slate-500 mt-0.5">{card.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Earnings alert banner — only shown when there are upcoming earnings */}
      {earningsEvents.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-900">
          <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
          <span className="text-[11px] font-medium">Earnings:</span>
          <span className="text-[11px] truncate">
            {earningsEvents.map((e, i) => {
              const d = new Date(e.earningsDate);
              const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const isLong = e.longShort === 'long';
              return (
                <span key={i}>
                  {i > 0 && <span className="text-amber-400 mx-1">·</span>}
                  <span className={isLong ? 'text-emerald-700' : 'text-rose-700'}>{e.nameEn}</span>
                  <span className="text-amber-600 ml-0.5">({dateStr}{e.timing ? ` ${e.timing}` : ''})</span>
                </span>
              );
            })}
          </span>
        </div>
      )}

      {/* Main area: Charts (left) + Positions (right) */}
      <div className="flex flex-col md:flex-row gap-3" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* LEFT: Charts (compact) */}
        <div className="w-full md:w-[48%] flex-shrink-0 min-w-0 space-y-3">
          {/* NET row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">Net Exposure</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {netData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> : (
                  <ResponsiveContainer width="100%" height={barHeight(netData)}>
                    <BarChart data={netData} layout="vertical" margin={{ top: 2, right: 30, left: 2, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8E4DF" />
                      <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize: 8, fill: "#6B6B6B" }} />
                      <YAxis type="category" dataKey="name" width={calcYAxisWidth(netData)} tick={{ fontSize: 8, fill: "#1A1A1A" }} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (<div className={tooltipBox}>
                          <p className="font-medium mb-1">{label}</p>
                          <p>Net: <span className={d.nmv >= 0 ? "text-emerald-700" : "text-rose-700"}>{d.nmv}%</span></p>
                          <p className="text-emerald-700">Long: {d.long}%</p>
                          <p className="text-rose-700">Short: {d.short}%</p>
                        </div>);
                      }} />
                      <Bar dataKey="nmv" barSize={10} radius={[0, 3, 3, 0]} cursor="pointer"
                        onClick={(data: any) => toggleCategory(data.name)} isAnimationActive={false}>
                        {netData.map((entry, i) => (
                          <Cell key={i} fill={entry.nmv >= 0 ? "#10b981" : "#f43f5e"} opacity={selectedCategory && selectedCategory !== entry.name ? 0.25 : 1} />
                        ))}
                        <LabelList dataKey="nmv" position="right" formatter={(v: any) => `${v}%`} style={{ fontSize: 8, fill: "#6B6B6B" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">NET Distribution</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {netPieData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsPie data={netPieData} height={barHeight(netData)} selected={selectedCategory} onSelect={toggleCategory} />}
              </CardContent>
            </Card>
          </div>

          {/* GMV row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">Gross Exposure</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {gmvData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> : (
                  <ResponsiveContainer width="100%" height={barHeight(gmvData)}>
                    <BarChart data={gmvData} layout="vertical" margin={{ top: 2, right: 30, left: 2, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8E4DF" />
                      <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize: 8, fill: "#6B6B6B" }} />
                      <YAxis type="category" dataKey="name" width={calcYAxisWidth(gmvData)} tick={{ fontSize: 8, fill: "#1A1A1A" }} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (<div className={tooltipBox}>
                          <p className="font-medium mb-1">{label}</p>
                          <p>Gross: <span className="text-emerald-600">{d.gmv}%</span></p>
                          <p className="text-emerald-700">Long: {d.long}%</p>
                          <p className="text-rose-700">Short: {d.short}%</p>
                        </div>);
                      }} />
                      <Bar dataKey="gmv" barSize={10} radius={[0, 3, 3, 0]} cursor="pointer"
                        onClick={(data: any) => toggleCategory(data.name)} isAnimationActive={false}>
                        {gmvData.map((entry, i) => (
                          <Cell key={i} fill="#10b981" opacity={selectedCategory && selectedCategory !== entry.name ? 0.25 : 1} />
                        ))}
                        <LabelList dataKey="gmv" position="right" formatter={(v: any) => `${v}%`} style={{ fontSize: 8, fill: "#6B6B6B" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">GMV Distribution</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {gmvPieData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsPie data={gmvPieData} height={barHeight(gmvData)} selected={selectedCategory} onSelect={toggleCategory} />}
              </CardContent>
            </Card>
          </div>

          {/* Long/Short GMV Distribution row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">Long GMV Distribution</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {longGmvPieData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsPie data={longGmvPieData} height={barHeight(gmvData)} selected={selectedCategory} onSelect={toggleCategory} />}
              </CardContent>
            </Card>
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">Short GMV Distribution</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {shortGmvPieData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsPie data={shortGmvPieData} height={barHeight(gmvData)} selected={selectedCategory} onSelect={toggleCategory} />}
              </CardContent>
            </Card>
          </div>

          {/* PNL row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">PNL Breakdown</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {pnlData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No PNL data</p> : (
                  <ResponsiveContainer width="100%" height={barHeight(pnlData)}>
                    <BarChart data={pnlData} layout="vertical" margin={{ top: 2, right: 40, left: 2, bottom: 2 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8E4DF" />
                      <XAxis type="number" tickFormatter={v => formatUsdK(v)} tick={{ fontSize: 8, fill: "#6B6B6B" }} />
                      <YAxis type="category" dataKey="name" width={calcYAxisWidth(pnlData)} tick={{ fontSize: 8, fill: "#1A1A1A" }} />
                      <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (<div className={tooltipBox}>
                          <p className="font-medium mb-1">{label}</p>
                          <p>PNL: <span className={d.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}>{formatUsdK(d.pnl)}</span></p>
                        </div>);
                      }} />
                      <Bar dataKey="pnl" barSize={10} radius={[0, 3, 3, 0]} cursor="pointer"
                        onClick={(data: any) => toggleCategory(data.name)} isAnimationActive={false}>
                        {pnlData.map((entry, i) => (
                          <Cell key={i} fill={entry.pnl >= 0 ? "#2D6A4F" : "#C0392B"} opacity={selectedCategory && selectedCategory !== entry.name ? 0.25 : 1} />
                        ))}
                        <LabelList dataKey="pnl" position="right" formatter={(v: any) => formatUsdK(v)} style={{ fontSize: 8, fill: "#6B6B6B" }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">PNL Distribution</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {pnlPieData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No PNL data</p> :
                  <EChartsPie data={pnlPieData} formatter={formatUsdK} height={barHeight(pnlData)} selected={selectedCategory} onSelect={toggleCategory} />}
              </CardContent>
            </Card>
          </div>

          {/* Scatter plots row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1"><CardTitle className="font-semibold text-sm font-semibold">GMV vs PNL — All</CardTitle></CardHeader>
              <CardContent className="px-1 py-0">
                {scatterAllData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsScatter data={scatterAllData} height={400} />}
              </CardContent>
            </Card>
            <Card className="py-1.5">
              <CardHeader className="px-3 py-1">
                <CardTitle className="font-semibold text-sm font-semibold">
                  GMV vs PNL — by {DIM_TABS.find(d => d.key === dim)?.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-1 py-0">
                {scatterDimData.length === 0 ? <p className="text-xs text-slate-500 py-4 text-center">No data</p> :
                  <EChartsScatter data={scatterDimData} height={400} />}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* RIGHT: Linked Positions Table */}
        <div className="flex-1 min-w-0">
          <Card className="md:sticky md:top-0 flex flex-col py-1.5 h-[500px] md:h-[calc(100vh-80px)]">
            {/* Compact header — same height as chart card titles */}
            <CardHeader className="px-3 py-1 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="font-semibold text-sm font-semibold">
                  {selectedCategory ? selectedCategory : "All Positions"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className={`uppercase tracking-wider font-semibold text-[0.5625rem] ${selectedCategory ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {longPositions.length}L / {shortPositions.length}S
                  </span>
                  <button
                    onClick={refreshPrices}
                    disabled={priceRefreshing}
                    className="text-slate-500 hover:text-emerald-600 transition-colors p-0.5 rounded hover:bg-slate-100 disabled:opacity-40"
                    title="Refresh stock prices"
                  >
                    <RefreshCw className={`h-3 w-3 ${priceRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                  {selectedCategory && (
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className="text-slate-500 hover:text-slate-800 transition-colors p-0.5 rounded hover:bg-slate-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            {/* Two columns */}
            <CardContent className="px-0 py-0 flex-1 overflow-hidden">
              <div className="grid grid-cols-2 h-full">
                {/* Long column */}
                <div className="border-r border-slate-200 flex flex-col overflow-hidden">
                  <div className="px-3 py-1 border-b border-slate-200 flex-shrink-0">
                    <span className="uppercase tracking-wider font-semibold text-[0.5rem] text-slate-500">Long · {longPositions.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {longPositions.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">No longs</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead className="w-4 px-1 text-[10px]">#</TableHead>
                          <TableHead className="px-1 text-[10px]">Company</TableHead>
                          <TableHead className="px-1 text-[10px]">Ticker</TableHead>
                          <TableHead className="px-1 text-[10px] text-right">Wgt</TableHead>
                          <TableHead className="px-1 text-[10px] text-right">PNL</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1D</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1M</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1Y</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {longPositions.map((pos, idx) => <PositionRow key={pos.id} pos={pos} idx={idx} />)}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
                {/* Short column */}
                <div className="flex flex-col overflow-hidden">
                  <div className="px-3 py-1 border-b border-slate-200 flex-shrink-0">
                    <span className="uppercase tracking-wider font-semibold text-[0.5rem] text-slate-500">Short · {shortPositions.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {shortPositions.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">No shorts</p>
                    ) : (
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead className="w-4 px-1 text-[10px]">#</TableHead>
                          <TableHead className="px-1 text-[10px]">Company</TableHead>
                          <TableHead className="px-1 text-[10px]">Ticker</TableHead>
                          <TableHead className="px-1 text-[10px] text-right">Wgt</TableHead>
                          <TableHead className="px-1 text-[10px] text-right">PNL</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1D</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1M</TableHead>
                          <TableHead className="px-0.5 text-[10px] text-right">1Y</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {shortPositions.map((pos, idx) => <PositionRow key={pos.id} pos={pos} idx={idx} />)}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
