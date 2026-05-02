import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Database,
  Filter,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
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
import { Input } from "../../ui/input";
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
  MarketExchange,
  MarketMa5Filter,
  MarketPricePoint,
  MarketScreenerFilters,
  MarketScreenerResponse,
  MarketScreenerRow,
  MarketSymbolDetail,
} from "../../../aiprocess/types/portfolio";
import * as api from "../../../aiprocess/api/portfolio";

type SortOption =
  | "market_capitalization.desc"
  | "market_capitalization.asc"
  | "refund_5d_p.desc"
  | "refund_5d_p.asc"
  | "refund_1d_p.desc"
  | "refund_1d_p.asc"
  | "price_vs_ma5.desc"
  | "price_vs_ma5.asc"
  | "avgvol_1d.desc"
  | "avgvol_1d.asc";

const SECTOR_OPTIONS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
];

const DEFAULT_FILTERS: MarketScreenerFilters = {
  country: "US",
  exchange: "US",
  priceVsMa5: "above",
  marketCapMin: "1",
  sort: "market_capitalization.desc",
  limit: 50,
};

function asDisplayNumber(value: number | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function asCompact(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function asBillions(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `$${(value / 1e9).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}bn`;
}

function asPct(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function pctColor(value: number | undefined): string {
  if (value == null || Math.abs(value) < 0.0001) return "text-slate-500";
  return value > 0 ? "text-emerald-600" : "text-red-500";
}

function valueForInput(value: MarketScreenerFilters[keyof MarketScreenerFilters]) {
  if (value == null) return "";
  return String(value);
}

function marketCapBillionsToDollars(value: MarketScreenerFilters["marketCapMin"]) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n * 1e9 : undefined;
}

function volumeMillionsToShares(value: MarketScreenerFilters["volumeMin"]) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n * 1e6 : undefined;
}

function toScreenerApiFilters(filters: MarketScreenerFilters): MarketScreenerFilters {
  return {
    ...filters,
    marketCapMin: marketCapBillionsToDollars(filters.marketCapMin),
    marketCapMax: marketCapBillionsToDollars(filters.marketCapMax),
    volumeMin: volumeMillionsToShares(filters.volumeMin),
    volumeMax: volumeMillionsToShares(filters.volumeMax),
  };
}

function CountryLabel({ exchange }: { exchange: MarketExchange }) {
  return (
    <span className="flex items-center gap-1 truncate">
      <span className="truncate">{exchange.name}</span>
      <span className="shrink-0 text-slate-400">{exchange.code}</span>
    </span>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1">
      <div className="text-[10px] font-medium text-slate-400">{label}</div>
      <div className="text-xs font-semibold text-slate-700">{value}</div>
    </div>
  );
}

function FilterField({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function ScreenerStat({
  icon,
  label,
  value,
  tone = "slate",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: "slate" | "blue" | "green" | "amber";
}) {
  const toneClass = tone === "blue"
    ? "bg-blue-50 text-blue-700 ring-blue-100"
    : tone === "green"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-slate-50 text-slate-700 ring-slate-100";
  return (
    <div className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ring-1 ${toneClass}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-800">{value}</div>
      </div>
    </div>
  );
}

function normalizeCreatePayload(row: MarketScreenerRow) {
  return {
    tickerBbg: `${row.code} ${row.exchange} Equity`,
    nameEn: row.name || row.code,
    nameCn: "",
    market: row.exchange,
    priority: "watchlist",
    longShort: "/",
    marketCapLocal: row.marketCap || 0,
    marketCapRmb: 0,
    profit2025: 0,
    pe2026: 0,
    pe2027: 0,
    priceTag: row.close ? `Close ${row.close}` : "",
    positionAmount: 0,
    positionWeight: 0,
    sectorName: row.sector || "",
    gicIndustry: row.industry || "",
    exchangeCountry: row.country || "",
    return1d: row.return1dPct == null ? null : row.return1dPct / 100,
  };
}

function DetailChart({ detail }: { detail: MarketSymbolDetail | null }) {
  const data = useMemo(() => {
    if (!detail?.history) return [];
    return detail.history.slice(-160).map((point) => ({
      date: point.date.slice(5),
      close: point.adjustedClose ?? point.close,
      ma5: point.ma5,
      ma20: point.ma20,
      ma50: point.ma50,
    }));
  }, [detail]);

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
            formatter={(value) => asDisplayNumber(Number(value), 2)}
          />
          <Line type="monotone" dataKey="close" stroke="#2563eb" strokeWidth={1.6} dot={false} name="Close" />
          <Line type="monotone" dataKey="ma5" stroke="#10b981" strokeWidth={1.2} dot={false} name="MA5" />
          <Line type="monotone" dataKey="ma20" stroke="#f59e0b" strokeWidth={1.2} dot={false} name="MA20" />
          <Line type="monotone" dataKey="ma50" stroke="#64748b" strokeWidth={1.1} dot={false} name="MA50" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function DetailSheet({
  row,
  detail,
  loading,
  onOpenChange,
  onAdd,
  adding,
}: {
  row: MarketScreenerRow | null;
  detail: MarketSymbolDetail | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (row: MarketScreenerRow) => void;
  adding: boolean;
}) {
  const latest = detail?.latest;
  const close = latest?.adjustedClose ?? latest?.close ?? row?.close;
  const priceVsMa5 = latest?.ma5 && close ? (close / latest.ma5 - 1) * 100 : row?.priceVsMa5Pct;

  return (
    <Sheet open={Boolean(row)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-[680px]">
        {row && (
          <>
            <SheetHeader className="border-b border-slate-200 px-4 py-3">
              <SheetTitle className="pr-8 text-sm">{row.name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{row.symbol}</SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricPill label="Close" value={asDisplayNumber(close, 2)} />
                <MetricPill label="MA5" value={asDisplayNumber(latest?.ma5 ?? row.ma5, 2)} />
                <MetricPill label="vs MA5" value={asPct(priceVsMa5)} />
                <MetricPill label="Mkt Cap" value={asBillions(row.marketCap)} />
              </div>

              {loading ? (
                <div className="flex h-[260px] items-center justify-center rounded border border-slate-200 bg-white">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : (
                <DetailChart detail={detail} />
              )}

              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div className="rounded border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-[11px] font-semibold text-slate-500">分类</div>
                  <div className="space-y-1 text-slate-600">
                    <div>Sector: {row.sector || "-"}</div>
                    <div>Industry: {row.industry || "-"}</div>
                    <div>Country: {row.country || "-"}</div>
                  </div>
                </div>
                <div className="rounded border border-slate-200 bg-white p-3">
                  <div className="mb-2 text-[11px] font-semibold text-slate-500">动量</div>
                  <div className="space-y-1 text-slate-600">
                    <div className={pctColor(row.return1dPct)}>1D: {asPct(row.return1dPct)}</div>
                    <div className={pctColor(row.return5dPct)}>5D: {asPct(row.return5dPct)}</div>
                    <div>Volume: {asCompact(row.volume1d)}</div>
                  </div>
                </div>
              </div>

              <PrimaryButton
                onClick={() => onAdd(row)}
                disabled={adding || row.inPortfolio}
                icon={row.inPortfolio ? <Check size={13} /> : <Plus size={13} />}
              >
                {row.inPortfolio ? "已在 Portfolio" : adding ? "加入中..." : "加入观察池"}
              </PrimaryButton>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ScreenerView() {
  const [exchanges, setExchanges] = useState<MarketExchange[]>([]);
  const [filters, setFilters] = useState<MarketScreenerFilters>(DEFAULT_FILTERS);
  const [result, setResult] = useState<MarketScreenerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exchangesLoading, setExchangesLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<MarketScreenerRow | null>(null);
  const [detail, setDetail] = useState<MarketSymbolDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);

  const countryOptions = useMemo(() => {
    const map = new Map<string, { code: string; label: string; count: number }>();
    exchanges.forEach((exchange) => {
      const code = (exchange.countryIso2 || exchange.countryIso3 || exchange.country || "").toUpperCase();
      if (!code) return;
      const existing = map.get(code);
      if (existing) existing.count += 1;
      else map.set(code, { code, label: exchange.country || code, count: 1 });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [exchanges]);

  const exchangeOptions = useMemo(() => {
    const country = String(filters.country || "").toUpperCase();
    const filtered = exchanges.filter((exchange) => {
      if (!country || country === "ALL") return true;
      return [exchange.countryIso2, exchange.countryIso3, exchange.country]
        .filter(Boolean)
        .some((value) => String(value).toUpperCase() === country);
    });
    return filtered.sort((a, b) => a.code.localeCompare(b.code));
  }, [exchanges, filters.country]);
  const selectedCountry = String(filters.country || "US").toUpperCase();
  const selectedExchange = String(filters.exchange || "all").toUpperCase();
  const hasSelectedCountry = countryOptions.some((country) => country.code.toUpperCase() === selectedCountry);
  const hasSelectedExchange = selectedExchange === "ALL" || exchangeOptions.some((exchange) => exchange.code.toUpperCase() === selectedExchange);

  const setFilter = useCallback((key: keyof MarketScreenerFilters, value: string | number) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const runScreener = useCallback(async (nextFilters: MarketScreenerFilters) => {
    setLoading(true);
    try {
      const res = await api.screenMarket(toScreenerApiFilters(nextFilters));
      setResult(res.data.data);
    } catch (error) {
      console.error(error);
      toast.error("筛选失败，请检查 EODHD 配置或稍后重试");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setExchangesLoading(true);
    api.getMarketExchanges()
      .then((res) => setExchanges(res.data.data || []))
      .catch((error) => {
        console.error(error);
        toast.error("交易所列表加载失败");
      })
      .finally(() => setExchangesLoading(false));
  }, []);

  useEffect(() => {
    runScreener(DEFAULT_FILTERS);
  }, [runScreener]);

  useEffect(() => {
    if (!selectedRow) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api.getMarketSymbolDetail(selectedRow.symbol, 260)
      .then((res) => setDetail(res.data.data))
      .catch((error) => {
        console.error(error);
        setDetail(null);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedRow]);

  const handleCountryChange = (country: string) => {
    const nextExchange = exchanges
      .filter((exchange) => [exchange.countryIso2, exchange.countryIso3, exchange.country]
        .filter(Boolean)
        .some((value) => String(value).toUpperCase() === country.toUpperCase()))
      .sort((a, b) => a.code.localeCompare(b.code))[0]?.code || "all";
    setFilters((prev) => ({ ...prev, country, exchange: nextExchange }));
  };

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    runScreener(DEFAULT_FILTERS);
  };

  const handleAddToWatchlist = async (row: MarketScreenerRow) => {
    setAddingSymbol(row.symbol);
    try {
      await api.createPosition(normalizeCreatePayload(row));
      toast.success("已加入观察池");
      setResult((prev) => prev ? {
        ...prev,
        items: prev.items.map((item) => item.symbol === row.symbol ? { ...item, inPortfolio: true, portfolioLongShort: "/" } : item),
      } : prev);
      setSelectedRow((prev) => prev?.symbol === row.symbol ? { ...prev, inPortfolio: true, portfolioLongShort: "/" } : prev);
    } catch (error) {
      console.error(error);
      toast.error("加入失败，可能已存在同名 ticker");
    } finally {
      setAddingSymbol(null);
    }
  };

  const rows = result?.items || [];
  const activeFilterCount = useMemo(() => {
    const keys: (keyof MarketScreenerFilters)[] = [
      "query",
      "sector",
      "industry",
      "marketCapMin",
      "marketCapMax",
      "return1dMin",
      "return5dMin",
      "ma5DistanceMin",
      "ma5DistanceMax",
      "volumeMin",
      "volumeMax",
      "priceVsMa5",
    ];
    return keys.filter((key) => {
      const value = filters[key];
      if (value == null || value === "" || value === "all" || value === "any") return false;
      if (key === "marketCapMin" && String(value) === "1") return false;
      return true;
    }).length;
  }, [filters]);
  const exchangeLabel = result?.meta.exchanges.length ? result.meta.exchanges.join(", ") : String(filters.exchange || filters.country || "-");
  const filterChips = [
    filters.marketCapMin && String(filters.marketCapMin) !== "1" ? `Mkt Cap >= $${filters.marketCapMin}bn` : null,
    filters.marketCapMax ? `Mkt Cap <= $${filters.marketCapMax}bn` : null,
    filters.return1dMin ? `1D >= ${filters.return1dMin}%` : null,
    filters.return5dMin ? `5D >= ${filters.return5dMin}%` : null,
    filters.ma5DistanceMin ? `vs MA5 >= ${filters.ma5DistanceMin}%` : null,
    filters.ma5DistanceMax ? `vs MA5 <= ${filters.ma5DistanceMax}%` : null,
    filters.volumeMin ? `Vol >= ${filters.volumeMin}M` : null,
    filters.volumeMax ? `Vol <= ${filters.volumeMax}M` : null,
  ].filter((chip): chip is string => Boolean(chip));

  return (
    <div className="space-y-3">
      <div className="rounded border border-slate-200 bg-white px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <Search size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Market Screener</h2>
                {result && <Badge variant="secondary">{result.total}</Badge>}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">EODHD · {exchangeLabel}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <PrimaryButton variant="secondary" size="sm" onClick={handleReset}>
              Reset
            </PrimaryButton>
            <PrimaryButton onClick={() => runScreener(filters)} disabled={loading} icon={loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}>
              Run
            </PrimaryButton>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <ScreenerStat icon={<Database size={14} />} label="Results" value={result?.total ?? "-"} tone="blue" />
          <ScreenerStat icon={<Globe2 size={14} />} label="Universe" value={exchangeLabel} />
          <ScreenerStat icon={<Filter size={14} />} label="Filters" value={activeFilterCount} tone={activeFilterCount ? "amber" : "slate"} />
          <ScreenerStat icon={<TrendingUp size={14} />} label="MA5" value={filters.priceVsMa5 === "above" ? "Close > MA5" : filters.priceVsMa5 === "below" ? "Close < MA5" : "Any"} tone="green" />
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-8 rounded border-slate-200 bg-slate-50/60 pl-8 text-xs shadow-none focus:bg-white"
              placeholder="Ticker / Company"
              value={valueForInput(filters.query)}
              onChange={(e) => setFilter("query", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runScreener(filters)}
            />
          </div>

          <Select value={String(filters.country || "US")} onValueChange={handleCountryChange} disabled={exchangesLoading}>
            <SelectTrigger className="h-8 w-[116px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              {!hasSelectedCountry && (
                <SelectItem value={selectedCountry} className="text-xs">{selectedCountry}</SelectItem>
              )}
              {countryOptions.map((country) => (
                <SelectItem key={country.code} value={country.code} className="text-xs">
                  {country.label} · {country.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(filters.exchange || "all")} onValueChange={(value) => setFilter("exchange", value)}>
            <SelectTrigger className="h-8 w-[116px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Exchange" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部交易所</SelectItem>
              {!hasSelectedExchange && (
                <SelectItem value={selectedExchange} className="text-xs">{selectedExchange}</SelectItem>
              )}
              {exchangeOptions.map((exchange) => (
                <SelectItem key={exchange.code} value={exchange.code} className="text-xs">
                  <CountryLabel exchange={exchange} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(filters.sector || "all")} onValueChange={(value) => setFilter("sector", value === "all" ? "" : value)}>
            <SelectTrigger className="h-8 w-[150px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">全部 Sector</SelectItem>
              {SECTOR_OPTIONS.map((sector) => (
                <SelectItem key={sector} value={sector} className="text-xs">{sector}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="h-8 w-[190px] rounded border-slate-200 bg-white text-xs shadow-none"
            placeholder="Industry"
            value={valueForInput(filters.industry)}
            onChange={(e) => setFilter("industry", e.target.value)}
          />

          <Select value={String(filters.priceVsMa5 || "any")} onValueChange={(value) => setFilter("priceVsMa5", value as MarketMa5Filter)}>
            <SelectTrigger className="h-8 w-[132px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="MA5" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any" className="text-xs">MA5 任意</SelectItem>
              <SelectItem value="above" className="text-xs">Close &gt; MA5</SelectItem>
              <SelectItem value="below" className="text-xs">Close &lt; MA5</SelectItem>
            </SelectContent>
          </Select>

          <Select value={String(filters.sort || "market_capitalization.desc")} onValueChange={(value) => setFilter("sort", value as SortOption)}>
            <SelectTrigger className="h-8 w-[150px] rounded border-slate-200 bg-white text-xs shadow-none">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="market_capitalization.desc" className="text-xs">市值从高到低</SelectItem>
              <SelectItem value="market_capitalization.asc" className="text-xs">市值从低到高</SelectItem>
              <SelectItem value="refund_5d_p.desc" className="text-xs">5D 涨幅优先</SelectItem>
              <SelectItem value="refund_5d_p.asc" className="text-xs">5D 跌幅优先</SelectItem>
              <SelectItem value="refund_1d_p.desc" className="text-xs">1D 涨幅优先</SelectItem>
              <SelectItem value="refund_1d_p.asc" className="text-xs">1D 跌幅优先</SelectItem>
              <SelectItem value="price_vs_ma5.desc" className="text-xs">高于 MA5 最多</SelectItem>
              <SelectItem value="price_vs_ma5.asc" className="text-xs">低于 MA5 最多</SelectItem>
              <SelectItem value="avgvol_1d.desc" className="text-xs">成交量从高到低</SelectItem>
              <SelectItem value="avgvol_1d.asc" className="text-xs">成交量从低到高</SelectItem>
            </SelectContent>
          </Select>

          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors ${
              advancedOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <SlidersHorizontal size={13} />
            More
            {activeFilterCount > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{activeFilterCount}</span>}
          </button>
        </div>

        {advancedOpen ? (
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 md:grid-cols-5 xl:grid-cols-9">
            <FilterField label="Mkt Cap Min">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="$bn" value={valueForInput(filters.marketCapMin)} onChange={(e) => setFilter("marketCapMin", e.target.value)} />
            </FilterField>
            <FilterField label="Mkt Cap Max">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="$bn" value={valueForInput(filters.marketCapMax)} onChange={(e) => setFilter("marketCapMax", e.target.value)} />
            </FilterField>
            <FilterField label="1D Min">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="%" value={valueForInput(filters.return1dMin)} onChange={(e) => setFilter("return1dMin", e.target.value)} />
            </FilterField>
            <FilterField label="5D Min">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="%" value={valueForInput(filters.return5dMin)} onChange={(e) => setFilter("return5dMin", e.target.value)} />
            </FilterField>
            <FilterField label="vs MA5 Min">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="%" value={valueForInput(filters.ma5DistanceMin)} onChange={(e) => setFilter("ma5DistanceMin", e.target.value)} />
            </FilterField>
            <FilterField label="vs MA5 Max">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="%" value={valueForInput(filters.ma5DistanceMax)} onChange={(e) => setFilter("ma5DistanceMax", e.target.value)} />
            </FilterField>
            <FilterField label="Volume Min">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="M" value={valueForInput(filters.volumeMin)} onChange={(e) => setFilter("volumeMin", e.target.value)} />
            </FilterField>
            <FilterField label="Volume Max">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="M" value={valueForInput(filters.volumeMax)} onChange={(e) => setFilter("volumeMax", e.target.value)} />
            </FilterField>
            <FilterField label="Limit">
              <Input className="h-8 rounded bg-white text-xs shadow-none" placeholder="50" value={valueForInput(filters.limit)} onChange={(e) => setFilter("limit", e.target.value)} />
            </FilterField>
          </div>
        ) : (
          <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-400">Units: $bn / M</span>
            {filterChips.map((chip) => (
              <span key={chip} className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{chip}</span>
            ))}
          </div>
        )}
      </div>

      {result?.meta.warnings?.length ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {result.meta.warnings.join(" ")}
        </div>
      ) : null}

      <div className="overflow-hidden rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <BarChart3 size={14} className="text-blue-600" />
            Results
            {result && <Badge variant="secondary">{rows.length}/{result.total}</Badge>}
          </div>
          {loading && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <RefreshCw size={12} className="animate-spin" />
              loading
            </span>
          )}
        </div>

        {loading && !rows.length ? (
          <div className="flex h-72 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">暂无筛选结果</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1100px] text-xs">
              <TableHeader>
                <TableRow className="border-b border-slate-200 bg-white">
                  <TableHead className="h-8 px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">Company</TableHead>
                  <TableHead className="h-8 px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">Market</TableHead>
                  <TableHead className="h-8 px-2 text-[10px] uppercase tracking-[0.08em] text-slate-400">Classification</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">Close</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">MA5</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">vs MA5</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">1D</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">5D</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">Mkt Cap</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">Volume</TableHead>
                  <TableHead className="h-8 px-2 text-right text-[10px] uppercase tracking-[0.08em] text-slate-400">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.symbol} className="border-b border-slate-100 hover:bg-blue-50/30">
                    <TableCell className="max-w-[260px] cursor-pointer px-2 py-2" onClick={() => setSelectedRow(row)}>
                      <div className="truncate font-semibold text-slate-900">{row.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{row.symbol}</span>
                        {row.inPortfolio && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Portfolio</span>}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2 text-slate-500">
                      <div className="font-medium text-slate-700">{row.exchange}</div>
                      <div className="text-[11px] text-slate-400">{row.country || "-"}</div>
                    </TableCell>
                    <TableCell className="max-w-[260px] px-2 py-2">
                      <div className="truncate font-medium text-slate-700">{row.sector || "-"}</div>
                      <div className="truncate text-[11px] text-slate-400">{row.industry || "-"}</div>
                    </TableCell>
                    <TableCell className="px-2 py-2 text-right font-mono text-slate-800">{asDisplayNumber(row.close, 2)}</TableCell>
                    <TableCell className="px-2 py-2 text-right font-mono text-slate-500">{asDisplayNumber(row.ma5, 2)}</TableCell>
                    <TableCell className={`px-2 py-2 text-right font-mono ${pctColor(row.priceVsMa5Pct)}`}>
                      <span className="inline-flex min-w-[72px] items-center justify-end gap-0.5 rounded bg-slate-50 px-1.5 py-0.5">
                        {(row.priceVsMa5Pct || 0) >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                        {asPct(row.priceVsMa5Pct)}
                      </span>
                    </TableCell>
                    <TableCell className={`px-2 py-2 text-right font-mono ${pctColor(row.return1dPct)}`}>{asPct(row.return1dPct)}</TableCell>
                    <TableCell className={`px-2 py-2 text-right font-mono ${pctColor(row.return5dPct)}`}>{asPct(row.return5dPct)}</TableCell>
                    <TableCell className="px-2 py-2 text-right font-mono text-slate-700">{asBillions(row.marketCap)}</TableCell>
                    <TableCell className="px-2 py-2 text-right font-mono text-slate-700">{asCompact(row.volume1d)}</TableCell>
                    <TableCell className="px-2 py-2 text-right">
                      <PrimaryButton
                        size="sm"
                        variant={row.inPortfolio ? "secondary" : "primary"}
                        disabled={row.inPortfolio || addingSymbol === row.symbol}
                        onClick={() => handleAddToWatchlist(row)}
                        icon={row.inPortfolio ? <Check size={12} /> : <Plus size={12} />}
                      >
                        {row.inPortfolio ? "Added" : "Watch"}
                      </PrimaryButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DetailSheet
        row={selectedRow}
        detail={detail}
        loading={detailLoading}
        onOpenChange={(open) => !open && setSelectedRow(null)}
        onAdd={handleAddToWatchlist}
        adding={Boolean(selectedRow && addingSymbol === selectedRow.symbol)}
      />
    </div>
  );
}
