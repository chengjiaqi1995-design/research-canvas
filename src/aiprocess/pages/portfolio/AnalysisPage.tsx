import { useState, useEffect, useCallback } from "react";
// AI analysis uses generateObject (non-streaming JSON) for reliability
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/portfolio-ui/card";
import { Button } from "../../components/portfolio-ui/button";
import { Badge } from "../../components/portfolio-ui/badge";
import { Textarea } from "../../components/portfolio-ui/textarea";
import { Label } from "../../components/portfolio-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/portfolio-ui/select";
import {
  Loader2,
  BrainCircuit,
  TrendingUp,
  AlertTriangle,
  Target,
  Shield,
  Lightbulb,
  BarChart3,
  ArrowUpDown,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import type { PortfolioAnalysis, PositionAnalysis } from "../../lib/portfolio-ai-schemas";
import { PROVIDER_DEFINITIONS } from "../../lib/portfolio-ai-config";
import type { AIProvidersSettings } from "../../lib/portfolio-ai-config";

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
});

interface PositionOption {
  id: number;
  nameCn: string;
  nameEn: string;
  tickerBbg: string;
  longShort: string;
}

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  elevated: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const RISK_LABELS: Record<string, string> = {
  low: "低风险",
  moderate: "中等风险",
  elevated: "偏高风险",
  high: "高风险",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const ACTION_LABELS: Record<string, string> = {
  increase: "加仓",
  maintain: "维持",
  reduce: "减仓",
  exit: "清仓",
};

const ACTION_COLORS: Record<string, string> = {
  increase: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  maintain: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  reduce: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  exit: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

// --- Portfolio Report ---

function PortfolioReportView({ data }: { data: Partial<PortfolioAnalysis> }) {
  return (
    <div className="space-y-4">
      {data.executiveSummary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{data.executiveSummary}</p>
          </CardContent>
        </Card>
      )}

      {data.riskAssessment && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Risk Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.riskAssessment.overallRiskLevel && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Overall:</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    RISK_COLORS[data.riskAssessment.overallRiskLevel] || ""
                  }`}
                >
                  {RISK_LABELS[data.riskAssessment.overallRiskLevel] ||
                    data.riskAssessment.overallRiskLevel}
                </span>
              </div>
            )}
            {data.riskAssessment.concentrationRisk && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  集中度风险
                </p>
                <p className="text-sm">{data.riskAssessment.concentrationRisk}</p>
              </div>
            )}
            {data.riskAssessment.marketExposure && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  市场敞口
                </p>
                <p className="text-sm">{data.riskAssessment.marketExposure}</p>
              </div>
            )}
            {data.riskAssessment.correlationRisk && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  相关性风险
                </p>
                <p className="text-sm">{data.riskAssessment.correlationRisk}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.sectorAllocation && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Sector Allocation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.sectorAllocation.analysis && (
              <p className="text-sm">{data.sectorAllocation.analysis}</p>
            )}
            {data.sectorAllocation.overweights &&
              data.sectorAllocation.overweights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    超配
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {data.sectorAllocation.overweights.map((s, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            {data.sectorAllocation.underweights &&
              data.sectorAllocation.underweights.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    低配
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {data.sectorAllocation.underweights.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            {data.sectorAllocation.recommendations &&
              data.sectorAllocation.recommendations.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    建议
                  </p>
                  <ul className="text-sm space-y-1">
                    {data.sectorAllocation.recommendations.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-muted-foreground mt-1">•</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {data.topPositions && data.topPositions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topPositions.map((p, i) => (
                <div key={i} className="border-b last:border-0 pb-2 last:pb-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.observation}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.hedgingSuggestions && data.hedgingSuggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Hedging Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.hedgingSuggestions.map((h, i) => (
                <div key={i} className="border-b last:border-0 pb-2 last:pb-0">
                  <p className="text-sm font-medium">{h.suggestion}</p>
                  <p className="text-sm text-muted-foreground">{h.rationale}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.keyRisks && data.keyRisks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Key Risks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.keyRisks.map((r, i) => (
                <div key={i} className="border-b last:border-0 pb-2 last:pb-0">
                  <p className="text-sm font-medium">{r.risk}</p>
                  <p className="text-sm text-muted-foreground">
                    Mitigation: {r.mitigation}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.actionItems && data.actionItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Action Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {data.actionItems.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="bg-[var(--accent)] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {a}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Position Report ---

function PositionReportView({ data }: { data: Partial<PositionAnalysis> }) {
  return (
    <div className="space-y-4">
      {data.summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{data.summary}</p>
          </CardContent>
        </Card>
      )}

      {data.fundamentalAssessment && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Fundamental Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.fundamentalAssessment.businessQuality && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  业务质量
                </p>
                <p className="text-sm">
                  {data.fundamentalAssessment.businessQuality}
                </p>
              </div>
            )}
            {data.fundamentalAssessment.competitivePosition && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  竞争格局
                </p>
                <p className="text-sm">
                  {data.fundamentalAssessment.competitivePosition}
                </p>
              </div>
            )}
            {data.fundamentalAssessment.growthOutlook && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  增长前景
                </p>
                <p className="text-sm">
                  {data.fundamentalAssessment.growthOutlook}
                </p>
              </div>
            )}
            {data.fundamentalAssessment.managementQuality && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  管理层评估
                </p>
                <p className="text-sm">
                  {data.fundamentalAssessment.managementQuality}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.valuationOpinion && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Valuation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.valuationOpinion.currentValuation && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  当前估值
                </p>
                <p className="text-sm">
                  {data.valuationOpinion.currentValuation}
                </p>
              </div>
            )}
            {data.valuationOpinion.historicalContext && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  历史估值
                </p>
                <p className="text-sm">
                  {data.valuationOpinion.historicalContext}
                </p>
              </div>
            )}
            {data.valuationOpinion.relativeValue && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  相对估值
                </p>
                <p className="text-sm">{data.valuationOpinion.relativeValue}</p>
              </div>
            )}
            {data.valuationOpinion.fairValueRange && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  合理估值
                </p>
                <p className="text-sm">
                  {data.valuationOpinion.fairValueRange}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.riskFactors && data.riskFactors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Risk Factors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.riskFactors.map((r, i) => (
                <div key={i} className="border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium">{r.factor}</p>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        SEVERITY_COLORS[r.severity] || ""
                      }`}
                    >
                      {r.severity}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {r.description}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.catalysts && data.catalysts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Catalysts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.catalysts.map((c, i) => (
                <div key={i} className="border-b last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium">{c.catalyst}</p>
                    <Badge
                      variant={
                        c.impact === "positive" ? "default" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {c.impact === "positive" ? "+" : "-"} {c.timeframe}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.positionSizing && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4" />
              Position Sizing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.positionSizing.currentWeight && (
              <p className="text-sm">{data.positionSizing.currentWeight}</p>
            )}
            {data.positionSizing.recommendedAction && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">建议:</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    ACTION_COLORS[data.positionSizing.recommendedAction] || ""
                  }`}
                >
                  {ACTION_LABELS[data.positionSizing.recommendedAction] ||
                    data.positionSizing.recommendedAction}
                </span>
              </div>
            )}
            {data.positionSizing.rationale && (
              <p className="text-sm text-muted-foreground">
                {data.positionSizing.rationale}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Main Page ---

export default function AnalysisPage() {
  const [mode, setMode] = useState<"portfolio" | "position">("portfolio");
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

  // Provider/model selection
  const [providers, setProviders] = useState<AIProvidersSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  // Analysis results
  const [portfolioResult, setPortfolioResult] =
    useState<Partial<PortfolioAnalysis> | null>(null);
  const [positionResult, setPositionResult] =
    useState<Partial<PositionAnalysis> | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load settings and positions
  useEffect(() => {
    async function load() {
      try {
        const [settingsRes, positionsRes] = await Promise.all([
          fetch(`${API_BASE}/portfolio/settings`, { headers: getHeaders() }),
          fetch(`${API_BASE}/portfolio/positions`, { headers: getHeaders() }),
        ]);
        const settingsRaw = await settingsRes.json();
        const posRaw = await positionsRes.json();
        const settings = settingsRaw?.data || settingsRaw || {};
        const posData = posRaw?.data || posRaw || [];

        if (settings.ai_providers) {
          setProviders(settings.ai_providers);
          const enabled = settings.ai_providers.providers.filter(
            (p: any) => p.enabled && p.apiKey
          );
          if (enabled.length > 0) {
            setSelectedProvider(
              settings.ai_providers.selectedProviderId || enabled[0].id
            );
            setSelectedModel(
              settings.ai_providers.selectedModel || enabled[0].defaultModel
            );
          }
        }

        setPositions(
          posData
            .filter((p: any) => p.longShort !== "/")
            .map((p: any) => ({
              id: p.id,
              nameCn: p.nameCn,
              nameEn: p.nameEn,
              tickerBbg: p.tickerBbg,
              longShort: p.longShort,
            }))
        );
      } catch {
        toast.error("加载设置失败");
      }
    }
    load();
  }, []);

  const enabledProviders =
    providers?.providers.filter((p) => p.enabled && p.apiKey) || [];

  const currentProviderDef = PROVIDER_DEFINITIONS.find(
    (d) => d.id === selectedProvider
  );

  // Handle analysis
  async function handleAnalyze() {
    if (!selectedProvider || !selectedModel) {
      toast.error("请先在设置页面配置 AI 模型提供商");
      return;
    }
    if (mode === "position" && !selectedPositionId) {
      toast.error("请选择要分析的持仓");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setPortfolioResult(null);
    setPositionResult(null);

    try {
      const res = await fetch(`${API_BASE}/portfolio/ai/analyze`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          mode,
          positionId: mode === "position" ? Number(selectedPositionId) : undefined,
          providerId: selectedProvider,
          model: selectedModel,
          customPrompt: customPrompt.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `请求失败: ${res.status}`);
      }

      const raw = await res.json();
      const data = raw?.data || raw;

      if (mode === "portfolio") {
        setPortfolioResult(data);
      } else {
        setPositionResult(data);
      }
    } catch (e: any) {
      setError(e.message || "分析失败");
      toast.error(e.message || "分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BrainCircuit className="h-6 w-6" />
          AI Analysis
        </h1>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          {/* Row 1: Provider + Model + Mode */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select
                value={selectedProvider}
                onValueChange={(v) => {
                  setSelectedProvider(v);
                  const def = PROVIDER_DEFINITIONS.find((d) => d.id === v);
                  if (def) setSelectedModel(def.defaultModel);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {enabledProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  {enabledProviders.length === 0 && (
                    <SelectItem value="_none" disabled>
                      请先在设置页配置 Provider
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {(currentProviderDef?.models || []).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Analysis Mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as "portfolio" | "position")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portfolio">
                    Portfolio Analysis (组合分析)
                  </SelectItem>
                  <SelectItem value="position">
                    Position Analysis (个股分析)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Position selector (when in position mode) */}
          {mode === "position" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Select Position</Label>
              <Select
                value={selectedPositionId}
                onValueChange={setSelectedPositionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择持仓..." />
                </SelectTrigger>
                <SelectContent>
                  {positions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nameCn || p.nameEn} ({p.tickerBbg}) -{" "}
                      {p.longShort === "long" ? "Long" : "Short"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Row 3: Custom prompt (collapsible) */}
          <div>
            <button
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPrompt ? "- 隐藏" : "+ 添加"} 自定义提示词
            </button>
            {showPrompt && (
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="例如：重点关注中国科技股的政策风险... 或者：分析该公司在AI领域的竞争优势..."
                className="mt-2 text-sm"
                rows={3}
              />
            )}
          </div>

          {/* Run button */}
          <Button
            onClick={handleAnalyze}
            disabled={
              isAnalyzing || !selectedProvider || !selectedModel
            }
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                分析中...
              </>
            ) : (
              <>
                <BrainCircuit className="mr-2 h-4 w-4" />
                {mode === "portfolio" ? "分析整体组合" : "分析个股"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="pt-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {mode === "portfolio" && portfolioResult && (
        <PortfolioReportView data={portfolioResult} />
      )}
      {mode === "position" && positionResult && (
        <PositionReportView data={positionResult} />
      )}

      {/* Empty state */}
      {!isAnalyzing &&
        !error &&
        !portfolioResult &&
        !positionResult && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BrainCircuit className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">选择模型和分析模式，点击运行分析</p>
          </div>
        )}
    </div>
  );
}
