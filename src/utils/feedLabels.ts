export const SUMMARY_REPORT_LABEL = '总结报告';

const SUMMARY_REPORT_PATTERN = /周报|日报|月报|季报|年报|总结报告|weekly|daily|monthly|quarterly|annual|summary|recap/i;

export function isSummaryReportText(...values: unknown[]) {
  return SUMMARY_REPORT_PATTERN.test(values.filter(Boolean).map(String).join(' '));
}

export function normalizeSummaryReportLabel(label: string | undefined, ...context: unknown[]) {
  const raw = (label || '').trim();
  if (isSummaryReportText(raw, ...context)) return SUMMARY_REPORT_LABEL;
  return raw;
}

export function getDisplayReportLabel(item: {
  type?: string;
  title?: string;
  category?: string;
  reportType?: string;
  reportTypeLabel?: string;
}) {
  const rawLabel = item.reportTypeLabel || item.category || '';
  return normalizeSummaryReportLabel(rawLabel, item.type, item.reportType, item.title) || '交互报告';
}
