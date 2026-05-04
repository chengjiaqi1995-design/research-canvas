import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Crosshair,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { PrimaryButton } from "../../ui/index";
import type {
  PortfolioTechnicalAnalysisItem,
  PortfolioTechnicalAnalysisResponse,
  PortfolioMovingAverageTouchAlert,
  PortfolioTechnicalSignal,
  PortfolioTechnicalWindowAnalysis,
} from "../../../aiprocess/types/portfolio";
import * as api from "../../../aiprocess/api/portfolio";

type Scope = "active" | "watchlist" | "all";
const TECHNICAL_CACHE_KEY = "research-canvas.portfolio.technical.lastResult.v1";

const SIGNAL_LABELS: Record<PortfolioTechnicalSignal, string> = {
  bullish: "偏强",
  neutral: "中性",
  bearish: "偏弱",
};

interface TechnicalCache {
  scope: Scope;
  data: PortfolioTechnicalAnalysisResponse;
  savedAt: string;
}

function readTechnicalCache(): TechnicalCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TECHNICAL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TechnicalCache>;
    if (!parsed.data?.items) return null;
    return {
      scope: parsed.scope || "active",
      data: parsed.data,
      savedAt: parsed.savedAt || parsed.data.generatedAt || new Date().toISOString(),
    };
  } catch (error) {
    console.warn("Failed to restore technical cache", error);
    return null;
  }
}

function writeTechnicalCache(scope: Scope, data: PortfolioTechnicalAnalysisResponse) {
  if (typeof window === "undefined") return null;
  const entry: TechnicalCache = {
    scope,
    data,
    savedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(TECHNICAL_CACHE_KEY, JSON.stringify(entry));
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

function PositionChart({ item }: { item: PortfolioTechnicalAnalysisItem }) {
  const data = useMemo(() => {
    return item.history.slice(-70).map((point) => ({
      date: point.date.slice(5),
      close: point.adjustedClose ?? point.close,
      ma5: point.ma5,
      ma25: point.ma25,
      ma50: point.ma50,
      ma100: point.ma100,
    }));
  }, [item.history]);

  if (!data.length) {
    return <div className="flex h-[260px] items-center justify-center text-xs text-slate-400">暂无价格数据</div>;
  }

  return (
    <div className="h-[260px] rounded border border-slate-200 bg-white p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={18} />
          <YAxis tick={{ fontSize: 10 }} width={46} domain={["dataMin", "dataMax"]} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 4, borderColor: "#e2e8f0" }}
            formatter={(value) => fmtNum(Number(value), 2)}
          />
          <Line type="monotone" dataKey="close" stroke="#2563eb" strokeWidth={1.6} dot={false} name="Close" />
          <Line type="monotone" dataKey="ma5" stroke="#10b981" strokeWidth={1.1} dot={false} name="MA5" />
          <Line type="monotone" dataKey="ma25" stroke="#f59e0b" strokeWidth={1.1} dot={false} name="MA25" />
          <Line type="monotone" dataKey="ma50" stroke="#64748b" strokeWidth={1} dot={false} name="MA50" />
          <Line type="monotone" dataKey="ma100" stroke="#a855f7" strokeWidth={1} dot={false} name="MA100" />
        </LineChart>
      </ResponsiveContainer>
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
        <Metric label="Close vs MA5" value={fmtPct(analysis.closeVsMa5Pct)} className={pctColor(analysis.closeVsMa5Pct)} />
        <Metric label="Vol Ratio" value={analysis.volumeRatio == null ? "-" : `${analysis.volumeRatio.toFixed(2)}x`} />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{analysis.summary}</p>
    </div>
  );
}

function DetailSheet({
  item,
  onOpenChange,
}: {
  item: PortfolioTechnicalAnalysisItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-[760px]">
        {item && (
          <>
            <SheetHeader className="border-b border-slate-200 px-4 py-3">
              <SheetTitle className="pr-8 text-sm">{item.nameCn || item.nameEn}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {item.tickerBbg}{marketDataLabel(item) ? ` · ${marketDataLabel(item)}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              <PositionChart item={item} />
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
  const [data, setData] = useState<PortfolioTechnicalAnalysisResponse | null>(() => cachedResult?.data || null);
  const [savedAt, setSavedAt] = useState<string | null>(() => cachedResult?.savedAt || null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PortfolioTechnicalAnalysisItem | null>(null);

  const load = useCallback(async (nextScope = scope) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.analyzePortfolioTechnicals({
        scope: nextScope,
        windows: "5,10,30",
        limit: 220,
      });
      const nextData = res.data.data;
      setData(nextData);
      const cache = writeTechnicalCache(nextScope, nextData);
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
  }, [scope]);

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
          <PrimaryButton onClick={() => load()} disabled={loading} icon={loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}>
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
                <TableHead className="h-8 px-1.5 text-right">MA5</TableHead>
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
                    <TableCell className={`px-1.5 py-1.5 text-right font-mono ${pctColor(analysis?.closeVsMa5Pct)}`}>{fmtPct(analysis?.closeVsMa5Pct)}</TableCell>
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

      <DetailSheet item={selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)} />
    </div>
  );
}
