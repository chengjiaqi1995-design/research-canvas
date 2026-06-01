import { BarChart3, FileCode2, FileText, Mic, Newspaper, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FeedItem } from '../../db/apiClient.ts';
import { SUMMARY_REPORT_LABEL } from '../../utils/feedLabels.ts';
import { getFeedReportLabel, isHtmlReportFeedItem } from '../../feed/feedItemModel.ts';

interface FeedTypeConfig {
  label: string;
  color: string;
  bg: string;
  icon: LucideIcon;
}

const TYPE_CONFIG: Record<string, FeedTypeConfig> = {
  news: { label: '财经快讯', color: 'text-red-700', bg: 'bg-red-50', icon: Newspaper },
  industry: { label: '行业报告', color: 'text-blue-700', bg: 'bg-blue-50', icon: BarChart3 },
  podcast: { label: '播客', color: 'text-violet-700', bg: 'bg-violet-50', icon: Mic },
  weekly: { label: SUMMARY_REPORT_LABEL, color: 'text-emerald-700', bg: 'bg-emerald-50', icon: FileText },
  macro: { label: '宏观数据', color: 'text-amber-700', bg: 'bg-amber-50', icon: TrendingUp },
  report: { label: '交互报告', color: 'text-cyan-700', bg: 'bg-cyan-50', icon: FileCode2 },
};

export function getFeedTypeConfig(item: FeedItem) {
  const base = TYPE_CONFIG[item.type] || TYPE_CONFIG.news;
  if (item.type === 'report' || isHtmlReportFeedItem(item)) {
    return { ...base, label: getFeedReportLabel(item) || base.label };
  }
  return base;
}
