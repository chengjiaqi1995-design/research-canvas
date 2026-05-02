import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import * as api from '../../../aiprocess/api/portfolio';
import type {
  PortfolioFeedImpact,
  PortfolioImpactAlert,
  PortfolioImpactAlertSeverity,
  PortfolioImpactDirection,
  PortfolioImpactSummary,
} from '../../../aiprocess/types/portfolio';
import { PrimaryButton, SegmentedToggle } from '../../ui/index';

const DAY_OPTIONS = [
  { value: '1', label: 'Today' },
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
];

const DIRECTION_LABELS: Record<PortfolioImpactDirection, string> = {
  positive: '正面',
  negative: '负面',
  neutral: '中性',
  mixed: '混合',
};

const CHANNEL_LABELS: Record<string, string> = {
  revenue: '收入',
  margin: '利润率',
  valuation: '估值',
  policy: '政策',
  competition: '竞争',
  supply_chain: '供应链',
  macro: '宏观',
  liquidity: '流动性',
};

function fmtPct(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '0.0';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

function fmtTime(value: string) {
  try {
    return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  } catch {
    return '';
  }
}

function directionClass(direction: PortfolioImpactDirection) {
  if (direction === 'positive') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (direction === 'negative') return 'bg-red-50 text-red-700 border-red-100';
  if (direction === 'mixed') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function severityClass(severity: PortfolioImpactAlertSeverity) {
  if (severity === 'critical') return 'bg-red-50 text-red-700 border-red-200';
  if (severity === 'warning') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

function severityLabel(severity: PortfolioImpactAlertSeverity) {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Watch';
}

function directionBadge(direction: PortfolioImpactDirection, score?: number) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${directionClass(direction)}`}>
      {DIRECTION_LABELS[direction]} {score != null && <span className="ml-1 font-mono">{fmtScore(score)}</span>}
    </span>
  );
}

function getOpenAlerts(impact: PortfolioFeedImpact) {
  return (impact.alerts || []).filter((alert) => alert.status === 'open');
}

interface AlertRow {
  impact: PortfolioFeedImpact;
  alert: PortfolioImpactAlert;
}

function ImpactMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'red' | 'amber' | 'blue' | 'green' }) {
  const toneClass = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-emerald-700' : 'text-slate-900';
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function AlertCard({ row, onAlertStatus, onImpactStatus }: {
  row: AlertRow;
  onAlertStatus: (id: string, status: 'acknowledged' | 'dismissed') => void;
  onImpactStatus: (id: string, status: 'confirmed' | 'dismissed') => void;
}) {
  const { impact, alert } = row;
  const position = impact.position;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold ${severityClass(alert.severity)}`}>
              <ShieldAlert size={11} />
              {severityLabel(alert.severity)}
            </span>
            <span className="text-[11px] text-slate-500">{position.tickerBbg}</span>
            <span className="text-[11px] text-slate-400">{fmtPct(position.positionWeight)} · {position.longShort}</span>
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-900">{position.nameCn || position.nameEn}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => onAlertStatus(alert.id, 'acknowledged')} className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700" title="确认已知">
            <Check size={14} />
          </button>
          <button onClick={() => onAlertStatus(alert.id, 'dismissed')} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="忽略警示">
            <X size={14} />
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-700">{alert.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {directionBadge(impact.fundamentalDirection, impact.fundamentalScore)}
        {directionBadge(impact.portfolioDirection, impact.portfolioScore)}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{CHANNEL_LABELS[impact.channel] || impact.channel}</span>
        <span className="text-[11px] text-slate-400">置信度 {fmtPct(impact.confidence)}</span>
      </div>
      <div className="mt-2 rounded bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-600">
        {impact.evidence?.snippet || impact.thesis}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="truncate text-[11px] text-slate-400">{impact.feedItem.title}</div>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => onImpactStatus(impact.id, 'confirmed')} className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
            确认影响
          </button>
          <button onClick={() => onImpactStatus(impact.id, 'dismissed')} className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
            忽略影响
          </button>
        </div>
      </div>
    </div>
  );
}

function ImpactRow({ impact, onImpactStatus }: {
  impact: PortfolioFeedImpact;
  onImpactStatus: (id: string, status: 'confirmed' | 'dismissed') => void;
}) {
  const alerts = getOpenAlerts(impact);
  const position = impact.position;
  return (
    <tr className="border-b border-slate-100 align-top text-[12px] hover:bg-slate-50">
      <td className="px-2 py-2">
        <div className="font-medium text-slate-900">{position.nameCn || position.nameEn}</div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">{position.tickerBbg}</div>
      </td>
      <td className="px-2 py-2 text-slate-500">
        <div>{position.longShort}</div>
        <div className="text-[11px] text-slate-400">{fmtPct(position.positionWeight)}</div>
      </td>
      <td className="px-2 py-2">{directionBadge(impact.fundamentalDirection, impact.fundamentalScore)}</td>
      <td className="px-2 py-2">{directionBadge(impact.portfolioDirection, impact.portfolioScore)}</td>
      <td className="px-2 py-2 text-slate-500">
        <div>{CHANNEL_LABELS[impact.channel] || impact.channel}</div>
        <div className="text-[11px] text-slate-400">{impact.horizon} · {fmtPct(impact.confidence)}</div>
      </td>
      <td className="px-2 py-2">
        <div className="line-clamp-2 max-w-md text-slate-700">{impact.thesis}</div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
          <Clock size={10} />
          {fmtTime(impact.feedItem.publishedAt)}
          <span className="truncate">{impact.feedItem.title}</span>
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {alerts.length ? alerts.map((alert) => (
            <span key={alert.id} className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${severityClass(alert.severity)}`}>
              {severityLabel(alert.severity)}
            </span>
          )) : <span className="text-[11px] text-slate-400">-</span>}
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <button onClick={() => onImpactStatus(impact.id, 'confirmed')} className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700" title="确认影响">
            <Check size={13} />
          </button>
          <button onClick={() => onImpactStatus(impact.id, 'dismissed')} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="忽略影响">
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function PositionImpactTable({ impacts }: { impacts: PortfolioFeedImpact[] }) {
  const rows = useMemo(() => {
    const map = new Map<number, {
      position: PortfolioFeedImpact['position'];
      netPortfolioScore: number;
      alertCount: number;
      latest: PortfolioFeedImpact;
      count: number;
    }>();
    for (const impact of impacts) {
      const existing = map.get(impact.positionId);
      const alertCount = getOpenAlerts(impact).length;
      if (!existing) {
        map.set(impact.positionId, {
          position: impact.position,
          netPortfolioScore: Number(impact.portfolioScore || 0),
          alertCount,
          latest: impact,
          count: 1,
        });
      } else {
        existing.netPortfolioScore += Number(impact.portfolioScore || 0);
        existing.alertCount += alertCount;
        existing.count += 1;
        if (new Date(impact.createdAt).getTime() > new Date(existing.latest.createdAt).getTime()) existing.latest = impact;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.alertCount - a.alertCount || Math.abs(b.netPortfolioScore) - Math.abs(a.netPortfolioScore));
  }, [impacts]);

  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">By Position</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-[11px] text-slate-500">
              <th className="px-2 py-1.5 text-left">Position</th>
              <th className="px-2 py-1.5 text-left">Side</th>
              <th className="px-2 py-1.5 text-right">Net Impact</th>
              <th className="px-2 py-1.5 text-right">Signals</th>
              <th className="px-2 py-1.5 text-right">Alerts</th>
              <th className="px-2 py-1.5 text-left">Latest Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.position.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-2 py-1.5">
                  <div className="font-medium text-slate-800">{row.position.nameCn || row.position.nameEn}</div>
                  <div className="font-mono text-[11px] text-slate-400">{row.position.tickerBbg}</div>
                </td>
                <td className="px-2 py-1.5 text-slate-500">{row.position.longShort} · {fmtPct(row.position.positionWeight)}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${row.netPortfolioScore < 0 ? 'text-red-600' : row.netPortfolioScore > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {fmtScore(row.netPortfolioScore)}
                </td>
                <td className="px-2 py-1.5 text-right text-slate-500">{row.count}</td>
                <td className="px-2 py-1.5 text-right text-slate-500">{row.alertCount}</td>
                <td className="max-w-lg truncate px-2 py-1.5 text-slate-500">{row.latest.feedItem.title}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">暂无影响记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImpactView() {
  const [days, setDays] = useState('7');
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [impacts, setImpacts] = useState<PortfolioFeedImpact[]>([]);
  const [summary, setSummary] = useState<PortfolioImpactSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadImpacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPortfolioImpacts({ days: Number(days), onlyAlerts, limit: 300 });
      setImpacts(res.data.data.impacts || []);
      setSummary(res.data.data.summary || null);
    } catch {
      toast.error('影响列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [days, onlyAlerts]);

  useEffect(() => { void loadImpacts(); }, [loadImpacts]);

  const alertRows = useMemo<AlertRow[]>(() => impacts.flatMap((impact) => getOpenAlerts(impact).map((alert) => ({ impact, alert }))), [impacts]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await api.runPortfolioImpactAnalysis({ days: Number(days), limit: 100 });
      const result = res.data.data;
      toast.success(`完成：${result.processedFeedCount} 条信息，${result.candidateCount || 0} 个候选，${result.impactCount} 个影响，${result.alertCount} 个警示`);
      await loadImpacts();
    } catch {
      toast.error('影响分析失败');
    } finally {
      setRunning(false);
    }
  };

  const handleImpactStatus = async (id: string, status: 'confirmed' | 'dismissed') => {
    try {
      await api.updatePortfolioImpact(id, status);
      await loadImpacts();
    } catch {
      toast.error('更新影响状态失败');
    }
  };

  const handleAlertStatus = async (id: string, status: 'acknowledged' | 'dismissed') => {
    try {
      await api.updatePortfolioImpactAlert(id, status);
      await loadImpacts();
    } catch {
      toast.error('更新警示状态失败');
    }
  };

  const metrics = summary || {
    netPortfolioScore: 0,
    alertCount: 0,
    criticalCount: 0,
    warningCount: 0,
    impactedPositions: 0,
    unreviewed: 0,
    positiveCount: 0,
    negativeCount: 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Portfolio Impact</h2>
          <div className="mt-1 text-[11px] text-slate-400">信息流对应持仓影响与仓位一致性警示</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedToggle value={days} onChange={setDays} options={DAY_OPTIONS} />
          <button
            onClick={() => setOnlyAlerts((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs ${
              onlyAlerts ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle size={13} />
            Only Alerts
          </button>
          <PrimaryButton onClick={handleRun} disabled={running} icon={running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}>
            {running ? 'Running' : 'Run Analysis'}
          </PrimaryButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <ImpactMetric label="Net Impact" value={fmtScore(metrics.netPortfolioScore)} tone={metrics.netPortfolioScore < 0 ? 'red' : metrics.netPortfolioScore > 0 ? 'green' : undefined} />
        <ImpactMetric label="Alerts" value={metrics.alertCount} tone={metrics.alertCount ? 'red' : undefined} />
        <ImpactMetric label="Critical" value={metrics.criticalCount} tone={metrics.criticalCount ? 'red' : undefined} />
        <ImpactMetric label="Warning" value={metrics.warningCount} tone={metrics.warningCount ? 'amber' : undefined} />
        <ImpactMetric label="Positions" value={metrics.impactedPositions} />
        <ImpactMetric label="Unreviewed" value={metrics.unreviewed} />
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded border border-slate-200 bg-white text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载中...
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">Alerts</div>
                <div className="text-[11px] text-slate-400">{alertRows.length}</div>
              </div>
              {alertRows.length ? (
                <div className="space-y-2">
                  {alertRows.slice(0, 8).map((row) => (
                    <AlertCard
                      key={`${row.impact.id}:${row.alert.id}`}
                      row={row}
                      onAlertStatus={handleAlertStatus}
                      onImpactStatus={handleImpactStatus}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
                  当前范围暂无开放警示
                </div>
              )}
            </div>

            <div className="rounded border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="text-xs font-semibold text-slate-700">Impact Feed</div>
                <div className="text-[11px] text-slate-400">{impacts.length}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] text-slate-500">
                      <th className="px-2 py-1.5 text-left">Position</th>
                      <th className="px-2 py-1.5 text-left">Side</th>
                      <th className="px-2 py-1.5 text-left">Fundamental</th>
                      <th className="px-2 py-1.5 text-left">Portfolio</th>
                      <th className="px-2 py-1.5 text-left">Channel</th>
                      <th className="px-2 py-1.5 text-left">Signal</th>
                      <th className="px-2 py-1.5 text-left">Alerts</th>
                      <th className="px-2 py-1.5 text-left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {impacts.map((impact) => (
                      <ImpactRow key={impact.id} impact={impact} onImpactStatus={handleImpactStatus} />
                    ))}
                    {!impacts.length && (
                      <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-400">暂无影响记录</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <PositionImpactTable impacts={impacts} />

          <div className="rounded border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
            <ExternalLink size={12} className="mr-1 inline" />
            当前分析器：llm-gemini-v1。规则只做候选召回，最终影响与警示由 LLM 结构化判读。
          </div>
        </>
      )}
    </div>
  );
}
