import { useState, useEffect, useCallback } from "react";
import { Input } from "../../components/portfolio-ui/input";
import { Button } from "../../components/portfolio-ui/button";
import { Badge } from "../../components/portfolio-ui/badge";
import { Label } from "../../components/portfolio-ui/label";
import { Textarea } from "../../components/portfolio-ui/textarea";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/portfolio-ui/dialog";
import { ScrollArea } from "../../components/portfolio-ui/scroll-area";
import { Separator } from "../../components/portfolio-ui/separator";
import { Loader2, Plus, Search, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { PositionWithRelations } from "../../lib/portfolio-types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
});

interface CompanyResearch {
  id: number;
  positionId: number;
  position: PositionWithRelations;
  strategy: string;
  tam: string;
  competition: string;
  valueProposition: string;
  longTermFactors: string;
  outlook3to5y: string;
  businessQuality: string;
  trackingData: string;
  valuation: string;
  revenueDownstream: string;
  revenueProduct: string;
  revenueCustomer: string;
  profitSplit: string;
  leverage: string;
  peerComparison: string;
  costStructure: string;
  equipment: string;
  notes: string;
}

const RESEARCH_FIELDS: { key: keyof CompanyResearch; label: string }[] = [
  { key: "strategy", label: "公司策略" },
  { key: "tam", label: "空间 (TAM)" },
  { key: "competition", label: "格局" },
  { key: "valueProposition", label: "生意本质（产品价值）" },
  { key: "longTermFactors", label: "改变长期价值的东西" },
  { key: "outlook3to5y", label: "3-5年以后的东西" },
  { key: "businessQuality", label: "生意本质评估" },
  { key: "trackingData", label: "跟踪的数据" },
  { key: "valuation", label: "Valuation" },
  { key: "revenueDownstream", label: "收入拆分 - 按下游" },
  { key: "revenueProduct", label: "收入拆分 - 按产品" },
  { key: "revenueCustomer", label: "收入拆分 - 按客户" },
  { key: "profitSplit", label: "利润拆分" },
  { key: "leverage", label: "Leverage" },
  { key: "peerComparison", label: "同行差距" },
  { key: "costStructure", label: "成本结构" },
  { key: "equipment", label: "设备" },
  { key: "notes", label: "额外笔记" },
];

export default function ResearchPage() {
  const [researchList, setResearchList] = useState<CompanyResearch[]>([]);
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CompanyResearch | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  // New research dialog
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newPositionId, setNewPositionId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // AI Fill
  const [aiFilling, setAiFilling] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [resRes, posRes] = await Promise.all([
        fetch(`${API_BASE}/portfolio/research`, { headers: getHeaders() }),
        fetch(`${API_BASE}/portfolio/positions`, { headers: getHeaders() }),
      ]);
      const resRaw = await resRes.json();
      const posRaw = await posRes.json();
      const resList: CompanyResearch[] = resRaw?.data || resRaw || [];
      const posList: PositionWithRelations[] = posRaw?.data || posRaw || [];
      setResearchList(resList);
      setPositions(posList);
      // Re-select current if updated
      if (selected) {
        const updated = resList.find((r) => r.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredList = researchList.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.position.tickerBbg.toLowerCase().includes(q) ||
      r.position.nameCn.toLowerCase().includes(q) ||
      r.position.nameEn.toLowerCase().includes(q)
    );
  });

  // Positions without research
  const positionsWithoutResearch = positions.filter(
    (p) => !researchList.some((r) => r.positionId === p.id)
  );

  async function handleFieldBlur(field: string, value: string) {
    if (!selected) return;
    setSaving(field);
    try {
      const res = await fetch(`${API_BASE}/portfolio/research/${selected.id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Save failed");
      // Update local state
      setSelected((prev) =>
        prev ? { ...prev, [field]: value } : null
      );
      setResearchList((prev) =>
        prev.map((r) => (r.id === selected.id ? { ...r, [field]: value } : r))
      );
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(null);
    }
  }

  async function handleCreateResearch() {
    if (!newPositionId) {
      toast.error("请选择一个持仓");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/portfolio/research`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ positionId: Number(newPositionId) }),
      });
      if (!res.ok) throw new Error("Create failed");
      const newResearchRaw = await res.json();
      const newResearch = newResearchRaw?.data || newResearchRaw;
      toast.success("研究已创建");
      setShowNewDialog(false);
      setNewPositionId("");
      await fetchData();
      setSelected(newResearch);
    } catch {
      toast.error("创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function handleAiFill() {
    if (!selected) return;
    setAiFilling(true);
    const toastId = toast.loading("AI 正在分析公司基本面，请稍候...");
    try {
      const res = await fetch(`${API_BASE}/portfolio/ai/fill`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          positionId: selected.positionId,
          researchId: selected.id,
        }),
      });
      const raw = await res.json();
      const data = raw?.data || raw;
      if (!res.ok) throw new Error(data.error || raw.error || "请求失败");

      toast.success("AI 填表完成", { id: toastId });

      // Update local state with the newly generated parsed data
      const newFields = data.parsed;
      setSelected((prev) => prev ? { ...prev, ...newFields } : null);
      setResearchList((prev) =>
        prev.map((r) => (r.id === selected.id ? { ...r, ...newFields } : r))
      );

    } catch (err: any) {
      toast.error(err.message, { id: toastId });
    } finally {
      setAiFilling(false);
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
    <div className="flex h-[calc(100vh-theme(spacing.12)-theme(spacing.6)*2)] gap-4">
      {/* Left Panel - Company List */}
      <div className="flex w-[280px] flex-col rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-semibold">公司研究</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNewDialog(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            新建研究
          </Button>
        </div>
        <div className="p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-1">
            {filteredList.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                暂无研究记录
              </div>
            ) : (
              filteredList.map((r) => (
                <div
                  key={r.id}
                  className={`cursor-pointer rounded-md px-3 py-2 transition-colors ${selected?.id === r.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted"
                    }`}
                  onClick={() => setSelected(r)}
                >
                  <div className="text-sm font-medium">
                    {r.position.nameCn || r.position.nameEn}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{r.position.tickerBbg}</span>
                    <Badge
                      variant={
                        r.position.longShort === "long"
                          ? "default"
                          : r.position.longShort === "short"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px] h-4"
                    >
                      {r.position.longShort === "long"
                        ? "L"
                        : r.position.longShort === "short"
                          ? "S"
                          : "/"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Panel - Research Form */}
      <div className="flex-1 overflow-hidden rounded-lg border bg-background">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <FileText className="mx-auto h-12 w-12 opacity-20" />
              <p className="text-sm">选择一个公司查看研究笔记</p>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {/* Position info header */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">
                    {selected.position.nameCn || selected.position.nameEn}
                  </h2>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAiFill}
                    disabled={aiFilling}
                    className="bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200"
                  >
                    {aiFilling ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    AI 自动填表
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="font-mono">
                    {selected.position.tickerBbg}
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>
                    市值: {selected.position.marketCapRmb.toFixed(1)}亿
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>
                    持仓:{" "}
                    {(selected.position.positionWeight * 100).toFixed(1)}%
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <Badge
                    variant={
                      selected.position.longShort === "long"
                        ? "default"
                        : selected.position.longShort === "short"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {selected.position.longShort.toUpperCase()}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Research fields */}
              <div className="grid gap-5">
                {RESEARCH_FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        {field.label}
                      </Label>
                      {saving === field.key && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <Textarea
                      value={
                        (selected[field.key] as string) ?? ""
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        setSelected((prev) =>
                          prev ? { ...prev, [field.key]: value } : null
                        );
                      }}
                      onBlur={(e) =>
                        handleFieldBlur(field.key, e.target.value)
                      }
                      placeholder={`输入${field.label}...`}
                      className="min-h-[80px] text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </div>

      {/* New Research Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建研究</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>选择持仓</Label>
              <Select value={newPositionId} onValueChange={setNewPositionId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个持仓..." />
                </SelectTrigger>
                <SelectContent>
                  {positionsWithoutResearch.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nameCn || p.nameEn} ({p.tickerBbg})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
            >
              取消
            </Button>
            <Button onClick={handleCreateResearch} disabled={creating}>
              {creating && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
