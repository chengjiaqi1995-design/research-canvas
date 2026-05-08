import { useCallback, useEffect, useMemo, useState } from "react";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import { IconButton, PrimaryButton } from "../../ui/index";
import type {
  PortfolioTechnicalAnalysisItem,
  PortfolioTechnicalAnalysisResponse,
  PortfolioMovingAverageTouchAlert,
  PortfolioTechnicalSignal,
  PortfolioTechnicalWindowAnalysis,
} from "../../../aiprocess/types/portfolio";
import * as api from "../../../aiprocess/api/portfolio";

type Scope = "active" | "watchlist" | "all";
type HistoryRange = "1y" | "3y" | "5y" | "max";
const TECHNICAL_CACHE_VERSION = 6;
const TECHNICAL_CACHE_KEY = "research-canvas.portfolio.technical.lastResult.v6";
const LEGACY_TECHNICAL_CACHE_KEYS = [
  "research-canvas.portfolio.technical.lastResult.v1",
  "research-canvas.portfolio.technical.lastResult.v2",
  "research-canvas.portfolio.technical.lastResult.v3",
  "research-canvas.portfolio.technical.lastResult.v4",
  "research-canvas.portfolio.technical.lastResult.v5",
];
const DEFAULT_HISTORY_RANGE: HistoryRange = "3y";
const TECHNICAL_HISTORY_RANGE_CONFIG: Record<HistoryRange, { label: string; days: number; cachePoints: number; minExpectedPoints: number }> = {
  "1y": { label: "1年", days: 365, cachePoints: 360, minExpectedPoints: 180 },
  "3y": { label: "3年", days: 1095, cachePoints: 900, minExpectedPoints: 540 },
  "5y": { label: "5年", days: 1825, cachePoints: 1500, minExpectedPoints: 900 },
  max: { label: "历史最长", days: 10000, cachePoints: 3000, minExpectedPoints: 900 },
};
const TECHNICAL_LOCAL_CACHE_HISTORY_POINTS = 90;

const SIGNAL_LABELS: Record<PortfolioTechnicalSignal, string> = {
  bullish: "偏强",
  neutral: "中性",
  bearish: "偏弱",
};

interface TechnicalCache {
  version: number;
  scope: Scope;
  range: HistoryRange;
  data: PortfolioTechnicalAnalysisResponse;
  savedAt: string;
}

let technicalMemoryCache: TechnicalCache | null = null;

function normalizeHistoryRange(value: unknown): HistoryRange {
  return value === "1y" || value === "3y" || value === "5y" || value === "max" ? value : DEFAULT_HISTORY_RANGE;
}

function historyRangeLabel(range: HistoryRange): string {
  return TECHNICAL_HISTORY_RANGE_CONFIG[range].label;
}

function historyRangeDays(range: HistoryRange): number {
  return TECHNICAL_HISTORY_RANGE_CONFIG[range].days;
}

function historyRangeCachePoints(range: HistoryRange): number {
  return TECHNICAL_HISTORY_RANGE_CONFIG[range].cachePoints;
}

function compactTechnicalData(data: PortfolioTechnicalAnalysisResponse, historyPoints = historyRangeCachePoints(DEFAULT_HISTORY_RANGE)): PortfolioTechnicalAnalysisResponse {
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      history: item.history.slice(-historyPoints),
    })),
  };
}

function normalizeTechnicalCache(parsed: Partial<TechnicalCache> | null | undefined): TechnicalCache | null {
  if (!parsed?.data?.items) return null;
  return {
    version: Number(parsed.version) || 1,
    scope: parsed.scope || "active",
    range: normalizeHistoryRange(parsed.range),
    data: parsed.data,
    savedAt: parsed.savedAt || parsed.data.generatedAt || new Date().toISOString(),
  };
}

function readTechnicalCacheFromLocalStorage(): TechnicalCache | null {
  if (typeof window === "undefined") return null;
  const keys = [TECHNICAL_CACHE_KEY, ...LEGACY_TECHNICAL_CACHE_KEYS];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const restored = normalizeTechnicalCache(JSON.parse(raw) as Partial<TechnicalCache>);
      if (restored) return restored;
    } catch (error) {
      console.warn("Failed to restore technical cache", error);
    }
  }
  return null;
}

function readTechnicalCache(): TechnicalCache | null {
  if (typeof window === "undefined") return null;
  if (technicalMemoryCache) return technicalMemoryCache;
  const restored = readTechnicalCacheFromLocalStorage();
  if (restored) technicalMemoryCache = restored;
  return restored;
}

async function readTechnicalCacheAsync(): Promise<TechnicalCache | null> {
  if (typeof window === "undefined") return null;
  for (const key of [TECHNICAL_CACHE_KEY, ...LEGACY_TECHNICAL_CACHE_KEYS]) {
    try {
      const restored = normalizeTechnicalCache(await idbGet<Partial<TechnicalCache>>(key));
      if (restored) {
        technicalMemoryCache = restored;
        return restored;
      }
    } catch (error) {
      console.warn("Failed to restore technical cache from IndexedDB", error);
    }
  }
  return readTechnicalCache();
}

function writeTechnicalCache(scope: Scope, range: HistoryRange, data: PortfolioTechnicalAnalysisResponse) {
  if (typeof window === "undefined") return null;
  const entry: TechnicalCache = {
    version: TECHNICAL_CACHE_VERSION,
    scope,
    range,
    data: compactTechnicalData(data, historyRangeCachePoints(range)),
    savedAt: data.generatedAt || new Date().toISOString(),
  };
  technicalMemoryCache = entry;

  void idbSet(TECHNICAL_CACHE_KEY, entry).catch((error) => {
    console.warn("Failed to persist technical cache to IndexedDB", error);
  });
  for (const legacyKey of LEGACY_TECHNICAL_CACHE_KEYS) {
    void idbDel(legacyKey).catch(() => undefined);
  }

  try {
    const localEntry = {
      ...entry,
      data: compactTechnicalData(data, TECHNICAL_LOCAL_CACHE_HISTORY_POINTS),
    };
    window.localStorage.setItem(TECHNICAL_CACHE_KEY, JSON.stringify(localEntry));
    for (const legacyKey of LEGACY_TECHNICAL_CACHE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
    return entry;
  } catch (error) {
    console.warn("Failed to persist technical cache", error);
    return null;
  }
}

function fmtPct(value: number | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMoney(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function pctColor(value: number | undefined): string {
  if (value == null || Math.abs(value) < 0.01) return "text-slate-500";
  return value > 0 ? "text-emerald-600" : "text-red-500";
}

function signalClass(signal?: PortfolioTechnicalSignal): string {
  if (signal === "bullish") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (signal === "bearish") return "border-red-200 bg-red-50 text-red-600";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function signalIcon(signal?: PortfolioTechnicalSignal) {
  if (signal === "bullish") return <ArrowUp size={12} />;
  if (signal === "bearish") return <ArrowDown size={12} />;
  return <Activity size={12} />;
}

function windowFor(item: PortfolioTechnicalAnalysisItem, window: number) {
  return item.windows.find((analysis) => analysis.window === window);
}

function marketDataLabel(item: PortfolioTechnicalAnalysisItem): string {
  const provider = item.marketDataProvider?.toUpperCase();
  const symbol = item.marketDataSymbol || item.eodhdSymbol;
  if (provider && symbol) return `${provider} · ${symbol}`;
  return symbol || "";
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1">
      <div className="text-[10px] font-medium text-slate-400">{label}</div>
      <div className={`text-xs font-semibold text-slate-700 ${className}`}>{value}</div>
    </div>
  );
}

function SignalBadge({ signal, score }: { signal?: PortfolioTechnicalSignal; score?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${signalClass(signal)}`}>
      {signalIcon(signal)}
      {signal ? SIGNAL_LABELS[signal] : "-"}
      {score != null && <span className="font-mono">{score}</span>}
    </span>
  );
}

function maTouchClass(alert: PortfolioMovingAverageTouchAlert): string {
  if (alert.status === "crossed") {
    return alert.direction === "above"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-red-200 bg-red-50 text-red-600";
  }
  if (alert.status === "touched") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function MaTouchBadges({ alerts, compact = false }: { alerts?: PortfolioMovingAverageTouchAlert[]; compact?: boolean }) {
  if (!alerts?.length) {
    return <span className="text-[11px] text-slate-400">-</span>;
  }
  return (
    <div className={`flex flex-wrap ${compact ? "gap-1" : "gap-1.5"}`}>
      {alerts.map((alert) => (
        <span
          key={`${alert.period}-${alert.status}`}
          title={alert.message}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${maTouchClass(alert)}`}
        >
          <Crosshair size={10} />
          MA{alert.period}
          <span className="font-mono font-medium">{fmtPct(alert.distancePct, 1)}</span>
        </span>
      ))}
    </div>
  );
}

function formatChartDate(date: string): string {
  return date || "-";
}

function formatAxisNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function chartClose(point: PortfolioTechnicalAnalysisItem["history"][number]): number | undefined {
  return point.adjustedClose ?? point.close;
}

function normalizeChartPoint(point: PortfolioTechnicalAnalysisItem["history"][number]) {
  const rawClose = point.close ?? point.adjustedClose;
  const close = chartClose(point);
  if (rawClose == null || close == null) return null;
  const adjustmentRatio = point.adjustedClose != null && point.close ? point.adjustedClose / point.close : 1;
  const adjust = (value: number | undefined) => (value == null ? undefined : value * adjustmentRatio);
  const open = adjust(point.open) ?? close;
  const high = Math.max(adjust(point.high) ?? close, open, close);
  const low = Math.min(adjust(point.low) ?? close, open, close);
  return {
    date: point.date,
    open,
    high,
    low,
    close,
    ma10: point.ma10,
    ma25: point.ma25,
    ma50: point.ma50,
    ma100: point.ma100,
  };
}

function chartCoverageText(data: Array<NonNullable<ReturnType<typeof normalizeChartPoint>>>, range: HistoryRange): string {
  if (!data.length) return "暂无历史数据";
  return `目标${historyRangeLabel(range)}；实际 ${data[0].date} 至 ${data[data.length - 1].date} · ${data.length}点`;
}

function formatPriceZone(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function channelColor(strategy: string): string {
  if (strategy === "bollinger_20_2") return "#2563eb";
  if (strategy === "keltner_20_2atr") return "#7c3aed";
  if (strategy === "atr_envelope_50") return "#ea580c";
  if (strategy === "rolling_percentile_252") return "#0f766e";
  return "#64748b";
}

function channelShortLabel(strategy: string): string {
  if (strategy === "bollinger_20_2") return "BB";
  if (strategy === "keltner_20_2atr") return "KC";
  if (strategy === "atr_envelope_50") return "ATR";
  if (strategy === "rolling_percentile_252") return "PCT";
  return "CH";
}

function channelSignalLabel(signal: string | undefined): string {
  if (signal === "upper_breakout") return "上沿突破";
  if (signal === "lower_breakdown") return "下沿跌破";
  if (signal === "near_upper") return "靠近上沿";
  if (signal === "near_lower") return "靠近下沿";
  return "区间内";
}

function channelSignalClass(signal: string | undefined): string {
  if (signal === "upper_breakout") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (signal === "lower_breakdown") return "border-red-200 bg-red-50 text-red-600";
  if (signal === "near_upper") return "border-amber-200 bg-amber-50 text-amber-700";
  if (signal === "near_lower") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function PositionChart({ item, range }: { item: PortfolioTechnicalAnalysisItem; range: HistoryRange }) {
  const data = useMemo(() => {
    return item.history.map(normalizeChartPoint).filter((point): point is NonNullable<ReturnType<typeof normalizeChartPoint>> => Boolean(point));
  }, [item.history]);
  const zones = useMemo(() => [
    ...(item.priceRange?.supportZones || []),
    ...(item.priceRange?.resistanceZones || []),
  ].slice(0, 6), [item.priceRange]);
  const donchianLines = useMemo(() => (
    item.priceRange?.donchian.filter((range) => [20, 55, 120].includes(range.window)) || []
  ), [item.priceRange]);
  const channels = useMemo(() => item.priceRange?.channels || [], [item.priceRange]);
  const consensus = item.priceRange?.consensus;

  if (!data.length) {
    return <div className="flex h-[560px] items-center justify-center rounded border border-slate-200 bg-white text-xs text-slate-400">暂无价格数据</div>;
  }

  const width = 1240;
  const height = 560;
  const margin = { top: 56, right: 30, bottom: 54, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yValues = data.flatMap((point) => [
    point.high,
    point.low,
    point.ma10,
    point.ma25,
    point.ma50,
    point.ma100,
  ])
    .concat(zones.flatMap((zone) => [zone.lower, zone.upper]))
    .concat(donchianLines.flatMap((range) => [range.low, range.high]))
    .concat(channels.flatMap((channel) => [channel.lower, channel.upper, channel.middle]))
    .concat(consensus ? [consensus.lower, consensus.upper, consensus.midpoint] : [])
    .filter((value): value is number => value != null && Number.isFinite(value));
  const yMinRaw = Math.min(...yValues);
  const yMaxRaw = Math.max(...yValues);
  const yPadding = Math.max((yMaxRaw - yMinRaw) * 0.08, Math.abs(yMaxRaw || 1) * 0.01);
  const yMin = yMinRaw - yPadding;
  const yMax = yMaxRaw + yPadding;
  const xFor = (index: number) => margin.left + (data.length <= 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const yFor = (value: number) => margin.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;
  const candleWidth = Math.max(1, Math.min(7, (plotWidth / Math.max(data.length, 1)) * 0.62));
  const linePath = (key: "ma10" | "ma25" | "ma50" | "ma100") => {
    let path = "";
    data.forEach((point, index) => {
      const value = point[key];
      if (value == null || !Number.isFinite(value)) return;
      path += `${path ? " L" : "M"} ${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)}`;
    });
    return path;
  };
  const xTickIndexes = Array.from(new Set(Array.from({ length: Math.min(7, data.length) }, (_, index) =>
    Math.round((index / Math.max(Math.min(7, data.length) - 1, 1)) * (data.length - 1)),
  )));
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4).reverse();
  const coverageText = chartCoverageText(data, range);
  const shortHistory = data.length < TECHNICAL_HISTORY_RANGE_CONFIG[range].minExpectedPoints;

  return (
    <div className="h-[560px] rounded border border-slate-200 bg-white p-3 md:h-[640px]">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={`${item.nameEn} ${historyRangeLabel(range)}日线蜡烛图`}>
        <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={yFor(tick)} y2={yFor(tick)} stroke="#eef2f7" strokeWidth={1} />
            <text x={margin.left - 8} y={yFor(tick) + 4} textAnchor="end" className="fill-slate-500 text-[10px]">
              {formatAxisNumber(tick)}
            </text>
          </g>
        ))}
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#94a3b8" strokeWidth={1} />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} stroke="#94a3b8" strokeWidth={1} />
        {consensus && (
          <g>
            <rect
              x={margin.left}
              y={Math.min(yFor(consensus.upper), yFor(consensus.lower))}
              width={plotWidth}
              height={Math.max(4, Math.abs(yFor(consensus.lower) - yFor(consensus.upper)))}
              fill="#2563eb"
              opacity={0.055}
            />
            <line x1={margin.left} x2={width - margin.right} y1={yFor(consensus.upper)} y2={yFor(consensus.upper)} stroke="#1d4ed8" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.72} />
            <line x1={margin.left} x2={width - margin.right} y1={yFor(consensus.lower)} y2={yFor(consensus.lower)} stroke="#1d4ed8" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.72} />
            <text x={width - margin.right - 4} y={Math.min(yFor(consensus.upper), yFor(consensus.lower)) + 13} textAnchor="end" fill="#1d4ed8" className="text-[10px] font-semibold">
              共识区间 {formatPriceZone(consensus.lower)}-{formatPriceZone(consensus.upper)}
            </text>
          </g>
        )}
        {channels.map((channel, index) => {
          const color = channelColor(channel.strategy);
          const upperY = yFor(channel.upper);
          const lowerY = yFor(channel.lower);
          const top = Math.min(upperY, lowerY);
          const bottom = Math.max(upperY, lowerY);
          return (
            <g key={`${channel.strategy}-${channel.lower}-${channel.upper}`}>
              <rect
                x={margin.left}
                y={top}
                width={plotWidth}
                height={Math.max(3, bottom - top)}
                fill={color}
                opacity={0.025 + index * 0.004}
              />
              <line x1={margin.left} x2={width - margin.right} y1={upperY} y2={upperY} stroke={color} strokeWidth={0.9} strokeDasharray="4 4" opacity={0.42} />
              <line x1={margin.left} x2={width - margin.right} y1={lowerY} y2={lowerY} stroke={color} strokeWidth={0.9} strokeDasharray="4 4" opacity={0.42} />
              <text x={margin.left + 4} y={top + 11 + index * 11} fill={color} className="text-[9px] font-medium">
                {channelShortLabel(channel.strategy)} {formatPriceZone(channel.lower)}-{formatPriceZone(channel.upper)}
              </text>
            </g>
          );
        })}
        {zones.map((zone) => {
          const yUpper = yFor(zone.upper);
          const yLower = yFor(zone.lower);
          const top = Math.min(yUpper, yLower);
          const bottom = Math.max(yUpper, yLower);
          const fill = zone.type === "support" ? "#10b981" : "#ef4444";
          const stroke = zone.type === "support" ? "#059669" : "#991b1b";
          return (
            <g key={`${zone.type}-${zone.lower}-${zone.upper}`}>
              <rect
                x={margin.left}
                y={top}
                width={plotWidth}
                height={Math.max(3, bottom - top)}
                fill={fill}
                opacity={0.08}
              />
              <line x1={margin.left} x2={width - margin.right} y1={(top + bottom) / 2} y2={(top + bottom) / 2} stroke={stroke} strokeWidth={1} strokeDasharray="4 3" opacity={0.55} />
              <text x={width - margin.right - 4} y={(top + bottom) / 2 - 3} textAnchor="end" fill={stroke} className="text-[9px] font-medium">
                {zone.type === "support" ? "支撑" : "压力"} {formatPriceZone(zone.lower)}-{formatPriceZone(zone.upper)}
              </text>
            </g>
          );
        })}
        {donchianLines.flatMap((range) => ([
          { key: `${range.window}-high`, value: range.high, label: `D${range.window}H`, color: "#b91c1c" },
          { key: `${range.window}-low`, value: range.low, label: `D${range.window}L`, color: "#047857" },
        ])).map((line) => (
          <g key={line.key}>
            <line x1={margin.left} x2={width - margin.right} y1={yFor(line.value)} y2={yFor(line.value)} stroke={line.color} strokeWidth={0.8} strokeDasharray="2 5" opacity={0.38} />
            <text x={margin.left + 4} y={yFor(line.value) - 3} fill={line.color} className="text-[9px]">
              {line.label}
            </text>
          </g>
        ))}
        {data.map((point, index) => {
          const x = xFor(index);
          const up = point.close >= point.open;
          const color = up ? "#059669" : "#7f1d1d";
          const bodyTop = yFor(Math.max(point.open, point.close));
          const bodyBottom = yFor(Math.min(point.open, point.close));
          const bodyHeight = Math.max(1, bodyBottom - bodyTop);
          return (
            <g key={`${point.date}-${index}`}>
              <title>{`${formatChartDate(point.date)}\nOpen ${fmtNum(point.open, 2)}\nHigh ${fmtNum(point.high, 2)}\nLow ${fmtNum(point.low, 2)}\nClose ${fmtNum(point.close, 2)}`}</title>
              <line x1={x} x2={x} y1={yFor(point.high)} y2={yFor(point.low)} stroke={color} strokeWidth={1} />
              <rect
                x={x - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={up ? "#ecfdf5" : color}
                stroke={color}
                strokeWidth={1}
              />
            </g>
          );
        })}
        <path d={linePath("ma10")} fill="none" stroke="#10b981" strokeWidth={1.3} />
        <path d={linePath("ma25")} fill="none" stroke="#f59e0b" strokeWidth={1.2} />
        <path d={linePath("ma50")} fill="none" stroke="#64748b" strokeWidth={1.1} />
        <path d={linePath("ma100")} fill="none" stroke="#a855f7" strokeWidth={1.1} />
        {xTickIndexes.map((index) => (
          <g key={index}>
            <line x1={xFor(index)} x2={xFor(index)} y1={height - margin.bottom} y2={height - margin.bottom + 4} stroke="#94a3b8" />
            <text x={xFor(index)} y={height - 18} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {formatChartDate(data[index]?.date || "")}
            </text>
          </g>
        ))}
        <g transform={`translate(${margin.left}, 12)`} className="text-[10px]">
          <text x={0} y={0} fill={shortHistory ? "#b45309" : "#64748b"}>{coverageText}</text>
          <text x={0} y={15} className="fill-slate-400">支撑/压力=Swing+ATR聚类；D=Donchian；BB=Bollinger；KC=Keltner；PCT=分位区间</text>
          <text x={520} y={15} className="fill-emerald-600">MA10</text>
          <text x={562} y={15} className="fill-amber-500">MA25</text>
          <text x={608} y={15} className="fill-slate-500">MA50</text>
          <text x={654} y={15} className="fill-purple-500">MA100</text>
        </g>
      </svg>
    </div>
  );
}

function PriceRangePanel({ item }: { item: PortfolioTechnicalAnalysisItem }) {
  const priceRange = item.priceRange;
  if (!priceRange) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
        当前缓存不含 Donchian / ATR 区间分析；点击 Refresh 后会生成新版区间。
      </div>
    );
  }

  const primaryDonchian = priceRange.donchian.filter((range) => [20, 55, 120, 252].includes(range.window));
  const channels = priceRange.channels || [];
  const consensus = priceRange.consensus;
  const zoneBadge = (zone: NonNullable<PortfolioTechnicalAnalysisItem["priceRange"]>["supportZones"][number]) => (
    <span
      key={`${zone.type}-${zone.lower}-${zone.upper}`}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium ${
        zone.type === "support"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
      title={`score ${zone.score}${zone.lastTouchDate ? ` · last ${zone.lastTouchDate}` : ""}`}
    >
      {zone.label}
      {zone.distancePct != null && <span className="font-mono">距 {fmtPct(Math.max(zone.distancePct, 0), 1)}</span>}
    </span>
  );

  return (
    <div className="space-y-2 rounded border border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-700">价格区间</div>
        <div className="text-[11px] text-slate-400">
          {priceRange.startDate} 至 {priceRange.endDate} · {priceRange.pointCount}点
          {priceRange.atr14 != null ? ` · ATR14 ${formatPriceZone(priceRange.atr14)}` : ""}
        </div>
      </div>
      <div className="rounded border border-blue-100 bg-blue-50 px-2 py-1.5 text-xs leading-5 text-blue-800">
        {priceRange.summary}
      </div>
      {consensus && (
        <div className="grid gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div>
            <div className="font-semibold">共识运行区间</div>
            <div className="font-mono text-sm">{formatPriceZone(consensus.lower)} - {formatPriceZone(consensus.upper)}</div>
          </div>
          <div className="text-slate-600">
            当前位置 <span className="font-mono font-semibold text-blue-800">{fmtPct(consensus.positionPct, 0)}</span>
          </div>
          <div className="text-slate-600">
            置信度 <span className="font-mono font-semibold text-blue-800">{consensus.confidence}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {primaryDonchian.map((range) => (
          <div key={range.window} className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
            <div className="text-[10px] font-semibold text-slate-400">{range.window}D Donchian</div>
            <div className="font-mono text-xs text-slate-700">{formatPriceZone(range.low)} - {formatPriceZone(range.high)}</div>
            <div className="text-[10px] text-slate-400">
              下沿距 {fmtPct(range.distanceToLowPct, 1)} · 上沿距 {fmtPct(range.distanceToHighPct, 1)}
            </div>
          </div>
        ))}
      </div>
      {channels.length ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {channels.map((channel) => (
            <div key={channel.strategy} className="rounded border border-slate-200 bg-white px-2 py-2">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-slate-700">{channel.label}</div>
                  <div className="font-mono text-xs text-slate-700">
                    {formatPriceZone(channel.lower)} - {formatPriceZone(channel.upper)}
                  </div>
                </div>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${channelSignalClass(channel.signal)}`}>
                  {channelSignalLabel(channel.signal)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                <span>位置 <span className="font-mono text-slate-600">{fmtPct(channel.positionPct, 0)}</span></span>
                <span>带宽 <span className="font-mono text-slate-600">{fmtPct(channel.widthPct, 1)}</span></span>
              </div>
              <div className="mt-1 text-[10px] leading-4 text-slate-500">{channel.description}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          当前缓存不含 Bollinger / Keltner / ATR / 分位区间策略；点击 Refresh 会生成新版区间。
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {priceRange.supportZones.map(zoneBadge)}
        {priceRange.resistanceZones.map(zoneBadge)}
      </div>
    </div>
  );
}

function WindowBlock({ analysis }: { analysis: PortfolioTechnicalWindowAnalysis }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">{analysis.window}日窗口</div>
        <SignalBadge signal={analysis.signal} score={analysis.score} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Return" value={fmtPct(analysis.returnPct)} className={pctColor(analysis.returnPct)} />
        <Metric label="Max DD" value={fmtPct(analysis.maxDrawdownPct)} className={pctColor(analysis.maxDrawdownPct)} />
        <Metric label="RSI14" value={fmtNum(analysis.rsi14, 1)} />
        <Metric label="MACD Hist" value={fmtNum(analysis.macdHistogram, 3)} className={pctColor(analysis.macdHistogram)} />
        <Metric label="Close vs MA10" value={fmtPct(analysis.closeVsMa10Pct)} className={pctColor(analysis.closeVsMa10Pct)} />
        <Metric label="Vol Ratio" value={analysis.volumeRatio == null ? "-" : `${analysis.volumeRatio.toFixed(2)}x`} />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{analysis.summary}</p>
    </div>
  );
}

function DetailSheet({
  item,
  range,
  dataRange,
  loading,
  pinned,
  onRangeChange,
  onRefresh,
  onPinnedChange,
  onOpenChange,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: {
  item: PortfolioTechnicalAnalysisItem | null;
  range: HistoryRange;
  dataRange: HistoryRange;
  loading: boolean;
  pinned: boolean;
  onRangeChange: (range: HistoryRange) => void;
  onRefresh: () => void;
  onPinnedChange: (pinned: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}) {
  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[98vw] overflow-y-auto sm:max-w-[1180px] 2xl:max-w-[1360px]"
        onEscapeKeyDown={(event) => pinned && event.preventDefault()}
        onInteractOutside={(event) => pinned && event.preventDefault()}
      >
        {item && (
          <>
            <SheetHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">{item.nameCn || item.nameEn}</SheetTitle>
                  <SheetDescription className="font-mono text-xs">
                    {item.tickerBbg}{marketDataLabel(item) ? ` · ${marketDataLabel(item)}` : ""}
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    type="button"
                    title={pinned ? "取消固定" : "固定弹窗"}
                    aria-label={pinned ? "取消固定弹窗" : "固定弹窗"}
                    active={pinned}
                    variant="blue"
                    onClick={() => onPinnedChange(!pinned)}
                  >
                    {pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </IconButton>
                  <IconButton
                    type="button"
                    title="上一只"
                    aria-label="上一只"
                    disabled={!hasPrevious}
                    onClick={onPrevious}
                  >
                    <ChevronLeft size={15} />
                  </IconButton>
                  <IconButton
                    type="button"
                    title="下一只"
                    aria-label="下一只"
                    disabled={!hasNext}
                    onClick={onNext}
                  >
                    <ChevronRight size={15} />
                  </IconButton>
                </div>
              </div>
            </SheetHeader>
            <div className="space-y-5 px-5 pb-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Latest" value={fmtNum(item.latestClose, 2)} />
                <Metric label="Position" value={fmtMoney(item.positionAmount)} />
                <Metric label="Overall" value={item.overallSignal ? SIGNAL_LABELS[item.overallSignal] : "-"} />
                <Metric label="Score" value={item.overallScore == null ? "-" : String(item.overallScore)} />
              </div>
              {item.combinedSummary && (
                <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                  {item.combinedSummary}
                </div>
              )}
              {item.maTouchAlerts?.length ? (
                <div className="rounded border border-slate-200 bg-white px-3 py-2">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <Crosshair size={13} className="text-blue-500" />
                    关键均线触碰
                  </div>
                  <MaTouchBadges alerts={item.maTouchAlerts} />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                <div>
                  <div className="text-xs font-semibold text-slate-700">图表时间范围</div>
                  <div className="text-[11px] text-slate-400">
                    {dataRange === range
                      ? `当前数据：${historyRangeLabel(dataRange)}`
                      : `当前数据来自 ${historyRangeLabel(dataRange)}，Refresh 后切换到 ${historyRangeLabel(range)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={range} onValueChange={(value) => onRangeChange(value as HistoryRange)}>
                    <SelectTrigger className="h-7 w-[112px] text-xs" title="选择价格图和区间分析的历史请求范围。切换后需点击 Refresh。">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1y" className="text-xs">1年</SelectItem>
                      <SelectItem value="3y" className="text-xs">3年</SelectItem>
                      <SelectItem value="5y" className="text-xs">5年</SelectItem>
                      <SelectItem value="max" className="text-xs">历史最长</SelectItem>
                    </SelectContent>
                  </Select>
                  <PrimaryButton
                    onClick={onRefresh}
                    disabled={loading}
                    icon={loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  >
                    Refresh
                  </PrimaryButton>
                </div>
              </div>
              <PositionChart item={item} range={range} />
              <PriceRangePanel item={item} />
              {item.error ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {item.error}
                </div>
              ) : (
                <>
                  {item.keyObservations?.length ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {item.keyObservations.map((observation) => (
                        <div key={observation} className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          {observation}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                    {item.windows.map((analysis) => <WindowBlock key={analysis.window} analysis={analysis} />)}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function TechnicalAnalysisView() {
  const [cachedResult] = useState(() => readTechnicalCache());
  const [scope, setScope] = useState<Scope>(() => cachedResult?.scope || "active");
  const [historyRange, setHistoryRange] = useState<HistoryRange>(() => cachedResult?.range || DEFAULT_HISTORY_RANGE);
  const [dataRange, setDataRange] = useState<HistoryRange>(() => cachedResult?.range || DEFAULT_HISTORY_RANGE);
  const [data, setData] = useState<PortfolioTechnicalAnalysisResponse | null>(() => cachedResult?.data || null);
  const [savedAt, setSavedAt] = useState<string | null>(() => cachedResult?.savedAt || null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PortfolioTechnicalAnalysisItem | null>(null);
  const [detailPinned, setDetailPinned] = useState(false);

  const load = useCallback(async (nextScope = scope, nextRange = historyRange) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.analyzePortfolioTechnicals({
        scope: nextScope,
        windows: "5,10,30",
        days: historyRangeDays(nextRange),
        limit: 220,
      });
      const nextData = res.data.data;
      setData(nextData);
      setDataRange(nextRange);
      const cache = writeTechnicalCache(nextScope, nextRange, nextData);
      setSavedAt(cache?.savedAt || new Date().toISOString());
    } catch (error) {
      console.error(error);
      const status = (error as any)?.response?.status;
      const detail = (error as any)?.response?.data?.error || (error as Error)?.message || "请求失败";
      const message = status === 401
        ? "Refresh 请求没有通过认证：请重新登录后再运行技术面分析。"
        : `技术面分析失败：${detail}`;
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [scope, historyRange]);

  useEffect(() => {
    let cancelled = false;
    void readTechnicalCacheAsync().then((cache) => {
      if (cancelled || !cache) return;
      setScope(cache.scope);
      setHistoryRange(cache.range);
      setDataRange(cache.range);
      setData(cache.data);
      setSavedAt(cache.savedAt);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const items = data?.items || [];
    return {
      total: items.length,
      bullish: items.filter((item) => item.overallSignal === "bullish").length,
      neutral: items.filter((item) => item.overallSignal === "neutral").length,
      bearish: items.filter((item) => item.overallSignal === "bearish").length,
      skipped: items.filter((item) => item.error).length,
    };
  }, [data]);

  const sortedItems = useMemo(() => {
    const items = [...(data?.items || [])];
    return items.sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      return (b.overallScore ?? -999) - (a.overallScore ?? -999);
    });
  }, [data]);

  const needsRangeRefresh = useMemo(() => (
    Boolean(data?.items.some((item) => (
      !item.error &&
      item.history.length >= 20 &&
      (!item.priceRange || !(item.priceRange.channels?.length) || !item.priceRange.consensus)
    )))
  ), [data]);

  const selectedIndex = useMemo(() => {
    if (!selectedItem) return -1;
    return sortedItems.findIndex((item) => item.positionId === selectedItem.positionId);
  }, [selectedItem, sortedItems]);

  const activeSelectedItem = useMemo(() => {
    if (!selectedItem) return null;
    return sortedItems.find((item) => item.positionId === selectedItem.positionId) || selectedItem;
  }, [selectedItem, sortedItems]);

  const selectRelativeItem = useCallback((direction: -1 | 1) => {
    if (selectedIndex < 0) return;
    const nextItem = sortedItems[selectedIndex + direction];
    if (nextItem) setSelectedItem(nextItem);
  }, [selectedIndex, sortedItems]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs font-semibold text-slate-700">Technical</h2>
          <span className="text-[11px] text-slate-400">
            {data ? `${data.analyzedCount} analyzed · ${data.skippedCount} skipped` : "Portfolio technical analysis"}
            {savedAt ? ` · Last saved ${new Date(savedAt).toLocaleString()}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active" className="text-xs">实盘持仓</SelectItem>
              <SelectItem value="watchlist" className="text-xs">观察池</SelectItem>
              <SelectItem value="all" className="text-xs">全部</SelectItem>
            </SelectContent>
          </Select>
          <PrimaryButton onClick={() => load(scope, historyRange)} disabled={loading} icon={loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}>
            Refresh
          </PrimaryButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Metric label="Total" value={String(stats.total)} />
        <Metric label="Bullish" value={String(stats.bullish)} className="text-emerald-600" />
        <Metric label="Neutral" value={String(stats.neutral)} />
        <Metric label="Bearish" value={String(stats.bearish)} className="text-red-500" />
        <Metric label="Skipped" value={String(stats.skipped)} className={stats.skipped ? "text-amber-600" : ""} />
      </div>

      <div className="rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <Activity size={14} className="text-slate-400" />
            综合技术面信号
            {data && <Badge variant="secondary">{data.generatedAt.slice(0, 10)}</Badge>}
          </div>
          {loading && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <RefreshCw size={12} className="animate-spin" />
              loading
            </span>
          )}
        </div>

        {errorMessage && (
          <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
            {errorMessage}
          </div>
        )}
        {needsRangeRefresh && (
          <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            当前显示的是旧缓存或旧版分析结果，尚未包含 Bollinger / Keltner / ATR / 分位数共识区间；点击 Refresh 会保存新版结果。
          </div>
        )}
        {data && dataRange !== historyRange && (
          <div className="border-b border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            当前结果来自 {historyRangeLabel(dataRange)} 缓存；已选择 {historyRangeLabel(historyRange)}，点击 Refresh 后更新。
          </div>
        )}

        {loading && !data ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            {data ? "当前账号和范围下没有可分析持仓" : "点击 Refresh 开始分析"}
          </div>
        ) : (
          <Table className="min-w-[1380px] table-fixed text-xs">
            <colgroup>
              <col className="w-[190px]" />
              <col className="w-[76px]" />
              <col className="w-[70px]" />
              <col className="w-[54px]" />
              <col className="w-[54px]" />
              <col className="w-[58px]" />
              <col className="w-[64px]" />
              <col className="w-[56px]" />
              <col className="w-[64px]" />
              <col className="w-[76px]" />
              <col className="w-[56px]" />
              <col className="w-[172px]" />
              <col />
            </colgroup>
            <TableHeader>
              <TableRow className="border-b border-slate-200 bg-slate-50">
                <TableHead className="h-8 px-1.5">Company</TableHead>
                <TableHead className="h-8 px-1.5">Signal</TableHead>
                <TableHead className="h-8 px-1.5 text-right">Close</TableHead>
                <TableHead className="h-8 px-1.5 text-right">5D</TableHead>
                <TableHead className="h-8 px-1.5 text-right">10D</TableHead>
                <TableHead className="h-8 px-1.5 text-right">30D</TableHead>
                <TableHead className="h-8 px-1.5 text-right">DD</TableHead>
                <TableHead className="h-8 px-1.5 text-right">RSI</TableHead>
                <TableHead className="h-8 px-1.5 text-right">MA10</TableHead>
                <TableHead className="h-8 px-1.5 text-right">MACD</TableHead>
                <TableHead className="h-8 px-1.5 text-right">Vol</TableHead>
                <TableHead className="h-8 px-1.5">MA touch</TableHead>
                <TableHead className="h-8 px-2">Analysis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => {
                const w5 = windowFor(item, 5);
                const w10 = windowFor(item, 10);
                const w30 = windowFor(item, 30);
                const analysis = w10 || w30 || w5;
                const worstDrawdown = item.windows.length
                  ? Math.min(...item.windows.map((window) => window.maxDrawdownPct))
                  : undefined;
                return (
                  <TableRow key={item.positionId} className="border-b border-slate-100 align-top">
                    <TableCell className="cursor-pointer px-1.5 py-1.5" onClick={() => setSelectedItem(item)}>
                      <div className="flex items-center gap-1">
                        {item.error ? <AlertCircle size={12} className="text-amber-500" /> : <CheckCircle2 size={12} className="text-emerald-500" />}
                        <span className="truncate font-medium text-slate-800">{item.nameCn || item.nameEn}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {item.tickerBbg}{marketDataLabel(item) ? ` · ${marketDataLabel(item)}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5">
                      <SignalBadge signal={item.overallSignal} score={item.overallScore} />
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right font-mono">{fmtNum(item.latestClose, 2)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(w5?.returnPct)}`}>{fmtPct(w5?.returnPct)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(w10?.returnPct)}`}>{fmtPct(w10?.returnPct)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(w30?.returnPct)}`}>{fmtPct(w30?.returnPct)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(worstDrawdown)}`}>{fmtPct(worstDrawdown)}</TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right font-mono">{fmtNum(analysis?.rsi14, 1)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(analysis?.closeVsMa10Pct)}`}>{fmtPct(analysis?.closeVsMa10Pct)}</TableCell>
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(analysis?.macdHistogram)}`}>{fmtNum(analysis?.macdHistogram, 3)}</TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right font-mono">{analysis?.volumeRatio == null ? "-" : `${analysis.volumeRatio.toFixed(2)}x`}</TableCell>
                    <TableCell className="px-1.5 py-1.5 whitespace-normal">
                      <MaTouchBadges alerts={item.maTouchAlerts} compact />
                    </TableCell>
                    <TableCell className="cursor-pointer px-2 py-1.5 whitespace-normal text-slate-600" onClick={() => setSelectedItem(item)}>
                      <div className="break-words text-[11px] leading-5">{item.error || item.combinedSummary || "-"}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <DetailSheet
        item={activeSelectedItem}
        range={historyRange}
        dataRange={dataRange}
        loading={loading}
        pinned={detailPinned}
        onRangeChange={setHistoryRange}
        onRefresh={() => load(scope, historyRange)}
        onPinnedChange={setDetailPinned}
        onOpenChange={(open) => !open && setSelectedItem(null)}
        onPrevious={() => selectRelativeItem(-1)}
        onNext={() => selectRelativeItem(1)}
        hasPrevious={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < sortedItems.length - 1}
      />
    </div>
  );
}
