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
import { Loader2, Pencil, X, RefreshCw } from "lucide-react";
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
  "#B8860B", "#2D6A4F", "#4A6FA5", "#C77D4F", "#7B6D8D",
  "#D4A84B", "#3D8B6E", "#6B8FC2", "#D9976A", "#9B8DAA",
];

function getDimData(summary: PortfolioSummary, dim: Dimension): SummaryByDimension[] {
  if (dim === "topdown") return summary.byTopdown || [];
  if (dim === "sector") return summary.bySector || [];
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
  if (dim === "gicIndustry") return p.market || "Other";
  return p.market || "Other";
}

function EChartsPie({ data, formatter, height = 220, selected, onSelect }: any) {
  const option = {
    tooltip: { trigger: "item" },
    series: [{
      type: "pie",
      radius: ["30%", "60%"],
      data: data.map((d: any, i: number) => ({
        ...d,
        itemStyle: {
          color: PIE_COLORS[i % PIE_COLORS.length],
          opacity: selected && selected !== d.name ? 0.3 : 1,
        },
      })),
    }],
  };
  const onEvents = onSelect ? { click: (params: any) => onSelect(params.name === selected ? null : params.name) } : undefined;
  return <ReactEChartsCore echarts={echarts} option={option} onEvents={onEvents} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} notMerge={true} />;
}

export function DashboardView() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [positions, setPositions] = useState<PositionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getPortfolioSummary().then((r) => r.data?.data),
      api.getPositions().then((r) => r.data?.data)
    ]).then(([sum, pos]) => {
      setSummary(sum);
      setPositions(pos || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      <h1 className="font-serif text-2xl">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="card-accent-top">
          <CardHeader><CardTitle>AUM</CardTitle></CardHeader>
          <CardContent><p className="text-xl font-bold">{summary ? formatAum(summary.aum) : "-"}</p></CardContent>
        </Card>
      </div>
    </div>
  );
}
