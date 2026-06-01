import { ShieldAlert } from 'lucide-react';
import type { PortfolioFeedImpact, PortfolioImpactDirection } from '../../aiprocess/types/portfolio.ts';

const IMPACT_DIRECTION_LABELS: Record<PortfolioImpactDirection, string> = {
  positive: '正面',
  negative: '负面',
  neutral: '中性',
  mixed: '混合',
};

function impactDirectionClass(direction: PortfolioImpactDirection) {
  if (direction === 'positive') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (direction === 'negative') return 'bg-red-50 text-red-700 border-red-100';
  if (direction === 'mixed') return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

export function FeedImpactStrip({ impacts, loading }: { impacts: PortfolioFeedImpact[]; loading: boolean }) {
  const openAlertCount = impacts.reduce(
    (count, impact) => count + (impact.alerts || []).filter((alert) => alert.status === 'open').length,
    0,
  );
  if (!loading && impacts.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <ShieldAlert size={13} className={openAlertCount ? 'text-red-600' : 'text-slate-400'} />
          Portfolio Impact
        </div>
        <div className="text-[11px] text-slate-400">
          {loading ? '加载中...' : `${impacts.length} impacts · ${openAlertCount} alerts`}
        </div>
      </div>
      {!loading && (
        <div className="flex flex-wrap gap-1.5">
          {impacts.slice(0, 5).map((impact) => {
            const hasAlert = (impact.alerts || []).some((alert) => alert.status === 'open');
            return (
              <span
                key={impact.id}
                className={`inline-flex max-w-[260px] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${hasAlert ? 'border-red-200 bg-red-50 text-red-700' : impactDirectionClass(impact.portfolioDirection)}`}
              >
                <span className="truncate">{impact.position.nameCn || impact.position.nameEn || impact.position.tickerBbg}</span>
                <span className="shrink-0">{IMPACT_DIRECTION_LABELS[impact.portfolioDirection]}</span>
              </span>
            );
          })}
          {impacts.length > 5 && <span className="text-[11px] text-slate-400">+{impacts.length - 5}</span>}
        </div>
      )}
    </div>
  );
}
