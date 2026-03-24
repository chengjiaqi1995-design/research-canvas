import { useState, useEffect, useCallback } from "react";
import { Input } from "../../components/portfolio-ui/input";
import { Button } from "../../components/portfolio-ui/button";
import { Badge } from "../../components/portfolio-ui/badge";
import { Label } from "../../components/portfolio-ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/portfolio-ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/portfolio-ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/portfolio-ui/table";
import {
  Loader2,
  Plus,
  Trash2,
  ArrowRight,
  Download,
  Check,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import type { PositionWithRelations, TradeItemInput, PortfolioSummary } from "../../lib/portfolio-types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
});

interface TradeRow {
  tickerBbg: string;
  name: string;
  transactionType: "buy" | "sell";
  gmvUsdK: string;
  unwind: boolean;
  reason: string;
}

const STEPS = [
  { num: 1, label: "调仓表格" },
  { num: 2, label: "仓位变动" },
  { num: 3, label: "输出Excel" },
  { num: 4, label: "仓位更新" },
];

function emptyRow(): TradeRow {
  return {
    tickerBbg: "",
    name: "",
    transactionType: "buy",
    gmvUsdK: "",
    unwind: false,
    reason: "",
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function TradePage() {
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<TradeRow[]>([emptyRow()]);
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tradeId, setTradeId] = useState<number | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [afterSummary, setAfterSummary] = useState<
    { metric: string; before: string; after: string; change: string }[]
  >([]);
  const [confirming, setConfirming] = useState(false);
  const [executed, setExecuted] = useState(false);

  // Autocomplete state
  const [activeTickerIndex, setActiveTickerIndex] = useState<number | null>(null);
  const [tickerSuggestions, setTickerSuggestions] = useState<PositionWithRelations[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/portfolio/positions`, { headers: getHeaders() }).then((r) => r.json()),
      fetch(`${API_BASE}/portfolio/summary`, { headers: getHeaders() }).then((r) => r.json()),
    ])
      .then(([posRaw, sumRaw]) => {
        setPositions(posRaw?.data || posRaw || []);
        setSummary(sumRaw?.data || sumRaw || null);
      })
      .catch(() => toast.error("加载数据失败"))
      .finally(() => setLoading(false));
  }, []);

  function updateRow(index: number, field: keyof TradeRow, value: string | boolean) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleTickerChange(index: number, value: string) {
    updateRow(index, "tickerBbg", value);
    setActiveTickerIndex(index);
    if (value.length > 0) {
      const q = value.toLowerCase();
      const matches = positions.filter(
        (p) =>
          p.tickerBbg.toLowerCase().includes(q) ||
          p.nameCn.toLowerCase().includes(q) ||
          p.nameEn.toLowerCase().includes(q)
      );
      setTickerSuggestions(matches.slice(0, 8));
    } else {
      setTickerSuggestions([]);
    }
  }

  function selectTicker(index: number, pos: PositionWithRelations) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        tickerBbg: pos.tickerBbg,
        name: pos.nameCn || pos.nameEn,
      };
      return next;
    });
    setActiveTickerIndex(null);
    setTickerSuggestions([]);
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  // Step 1 -> Step 2
  async function handleSubmitTrades() {
    const validRows = rows.filter((r) => r.tickerBbg.trim());
    if (validRows.length === 0) {
      toast.error("请至少添加一条交易");
      return;
    }
    setSubmitting(true);
    try {
      const items: TradeItemInput[] = validRows.map((r) => ({
        tickerBbg: r.tickerBbg,
        name: r.name,
        transactionType: r.transactionType,
        gmvUsdK: r.gmvUsdK.toLowerCase() === "all" ? -1 : Number(r.gmvUsdK) || 0,
        unwind: r.unwind,
        reason: r.reason,
      }));

      const res = await fetch(`${API_BASE}/portfolio/trades`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Failed");
      const tradeRaw = await res.json();
      const trade = tradeRaw?.data || tradeRaw;
      setTradeId(trade.id);

      // Compute before/after preview
      if (summary) {
        const totalTradeAmount = items.reduce((acc, item) => {
          const mult = item.transactionType === "buy" ? 1 : -1;
          const amount = item.gmvUsdK === -1 ? 0 : item.gmvUsdK * 1000;
          return acc + mult * amount;
        }, 0);

        const newLong = summary.totalLong + (totalTradeAmount > 0 ? totalTradeAmount / summary.aum : 0);
        const newShort = summary.totalShort + (totalTradeAmount < 0 ? Math.abs(totalTradeAmount) / summary.aum : 0);

        setAfterSummary([
          {
            metric: "总Long%",
            before: formatPct(summary.totalLong),
            after: formatPct(newLong),
            change: formatPct(newLong - summary.totalLong),
          },
          {
            metric: "总Short%",
            before: formatPct(summary.totalShort),
            after: formatPct(newShort),
            change: formatPct(newShort - summary.totalShort),
          },
          {
            metric: "NMV%",
            before: formatPct(summary.nmv),
            after: formatPct(newLong - newShort),
            change: formatPct(newLong - newShort - summary.nmv),
          },
          {
            metric: "GMV%",
            before: formatPct(summary.gmv),
            after: formatPct(newLong + newShort),
            change: formatPct(newLong + newShort - summary.gmv),
          },
          {
            metric: "交易笔数",
            before: "-",
            after: String(items.length),
            change: `+${items.length}`,
          },
        ]);
      }

      setStep(2);
      toast.success("交易已保存");
    } catch {
      toast.error("提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 2 -> Step 3
  function goToStep3() {
    setStep(3);
  }

  // Step 3: Download excel
  async function handleDownloadExcel() {
    if (!tradeId) return;
    try {
      const res = await fetch(`${API_BASE}/portfolio/trades/${tradeId}/export`, { headers: getHeaders() });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trade_${tradeId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Excel已下载");
    } catch {
      toast.error("下载失败");
    }
  }

  // Step 3 -> Step 4
  function goToStep4() {
    setStep(4);
  }

  // Step 4: Execute
  async function handleExecute() {
    if (!tradeId) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/portfolio/trades/${tradeId}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ status: "executed" }),
      });
      if (!res.ok) throw new Error("Execute failed");
      setExecuted(true);
      toast.success("仓位已更新!");
    } catch {
      toast.error("执行失败");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">调仓</h1>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step >= s.num
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s.num ? (
                <Check className="h-4 w-4" />
              ) : (
                s.num
              )}
            </div>
            <span
              className={`text-sm ${
                step >= s.num
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-8 ${
                  step > s.num ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Trade Input Table */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>调仓表格</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">BBG Ticker</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[120px]">GMV USD k</TableHead>
                  <TableHead className="w-[70px]">Unwind</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="relative">
                      <Input
                        value={row.tickerBbg}
                        onChange={(e) => handleTickerChange(idx, e.target.value)}
                        onBlur={() =>
                          setTimeout(() => {
                            if (activeTickerIndex === idx) {
                              setActiveTickerIndex(null);
                              setTickerSuggestions([]);
                            }
                          }, 200)
                        }
                        placeholder="e.g. 669 HK Equity"
                        className="text-sm"
                      />
                      {activeTickerIndex === idx && tickerSuggestions.length > 0 && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md max-h-[200px] overflow-y-auto">
                          {tickerSuggestions.map((pos) => (
                            <div
                              key={pos.id}
                              className="px-3 py-2 text-sm cursor-pointer hover:bg-accent"
                              onMouseDown={() => selectTicker(idx, pos)}
                            >
                              <div className="font-medium">{pos.tickerBbg}</div>
                              <div className="text-xs text-muted-foreground">
                                {pos.nameCn || pos.nameEn}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.name}
                        onChange={(e) => updateRow(idx, "name", e.target.value)}
                        placeholder="公司名"
                        className="text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.transactionType}
                        onValueChange={(v) => updateRow(idx, "transactionType", v)}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buy">
                            <span className="text-emerald-600">Buy</span>
                          </SelectItem>
                          <SelectItem value="sell">
                            <span className="text-rose-600">Sell</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.gmvUsdK}
                        onChange={(e) => updateRow(idx, "gmvUsdK", e.target.value)}
                        placeholder='数字或"all"'
                        className="text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={row.unwind}
                        onChange={(e) => updateRow(idx, "unwind", e.target.checked)}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.reason}
                        onChange={(e) => updateRow(idx, "reason", e.target.value)}
                        placeholder="原因"
                        className="text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      {rows.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRow(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-1 h-4 w-4" />
                添加行
              </Button>
              <Button onClick={handleSubmitTrades} disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                下一步
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Preview Changes */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>仓位变动预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>指标</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {afterSummary.map((row) => (
                  <TableRow key={row.metric}>
                    <TableCell className="font-medium">{row.metric}</TableCell>
                    <TableCell className="text-right font-mono">
                      {row.before}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.after}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.change}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                返回修改
              </Button>
              <Button onClick={goToStep3}>
                下一步
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Export Excel */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>输出Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-6 text-center space-y-4">
              <Download className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                交易ID: {tradeId} | 共{" "}
                {rows.filter((r) => r.tickerBbg.trim()).length} 笔交易
              </p>
              <Button onClick={handleDownloadExcel} size="lg">
                <Download className="mr-2 h-4 w-4" />
                下载Excel
              </Button>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                返回
              </Button>
              <Button onClick={goToStep4}>
                下一步
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Confirm Execution */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>仓位更新</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {executed ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
                <h3 className="text-lg font-semibold">仓位更新成功!</h3>
                <p className="text-sm text-muted-foreground">
                  交易 #{tradeId} 已执行，持仓数据已更新。
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep(1);
                    setRows([emptyRow()]);
                    setTradeId(null);
                    setExecuted(false);
                    setAfterSummary([]);
                  }}
                >
                  新建交易
                </Button>
              </div>
            ) : (
              <>
                <div className="rounded-lg border p-6 space-y-3">
                  <h3 className="font-medium">确认执行以下交易?</h3>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {rows
                      .filter((r) => r.tickerBbg.trim())
                      .map((r, i) => (
                        <li key={i}>
                          <Badge
                            variant={
                              r.transactionType === "buy"
                                ? "default"
                                : "destructive"
                            }
                            className="mr-2"
                          >
                            {r.transactionType.toUpperCase()}
                          </Badge>
                          {r.tickerBbg} - {r.name}{" "}
                          {r.gmvUsdK.toLowerCase() === "all"
                            ? "(ALL)"
                            : `${r.gmvUsdK}K USD`}
                        </li>
                      ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">
                    执行后将更新实际持仓数据，此操作不可撤销。
                  </p>
                </div>

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(3)}>
                    返回
                  </Button>
                  <Button
                    onClick={handleExecute}
                    disabled={confirming}
                    variant="destructive"
                  >
                    {confirming && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    确认执行
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
