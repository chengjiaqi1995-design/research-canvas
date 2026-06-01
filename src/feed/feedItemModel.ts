import type { FeedItem } from '../db/apiClient.ts';
import { getDisplayReportLabel, normalizeSummaryReportLabel } from '../utils/feedLabels.ts';

export function formatFeedTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = diffMs / 3600000;

  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}分钟前`;
  if (diffH < 24) return `${Math.floor(diffH)}小时前`;
  if (diffH < 48) return '昨天';

  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isHtmlReportFeedItem(item: FeedItem) {
  return item.contentFormat === 'html' || Boolean(item.htmlUrl);
}

export function isReportFeedItem(item: FeedItem) {
  return item.type === 'report' || isHtmlReportFeedItem(item);
}

export function isCanvasSendableFeedItem(item: FeedItem) {
  return isHtmlReportFeedItem(item) || item.contentFormat === 'markdown' || !item.contentFormat;
}

export function getFeedReportLabel(item: FeedItem) {
  if (!isReportFeedItem(item)) return undefined;
  return getDisplayReportLabel(item);
}

export function getFeedCategoryLabel(item: FeedItem) {
  return normalizeSummaryReportLabel(
    item.category,
    item.type,
    item.reportType,
    item.reportTypeLabel,
    item.title,
  );
}

export function getFeedReportTypeOption(item: FeedItem) {
  if (!isReportFeedItem(item)) return null;
  return {
    value: item.reportType || 'custom_report',
    label: getDisplayReportLabel(item),
  };
}

export function getFeedPreview(item: FeedItem) {
  if (isHtmlReportFeedItem(item)) {
    return [item.originalName || item.reportKey, item.source, item.reportVersion].filter(Boolean).join(' · ')
      || getFeedReportLabel(item)
      || '交互报告';
  }

  const content = item.contentFormat === 'html' ? stripHtml(item.content) : item.content;
  return content.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 140);
}

export function getFeedAttachmentTitle(item: FeedItem) {
  return item.originalName?.replace(/\.(md|markdown|html?)$/i, '') || item.title || '信息流附件';
}

export function getFeedAttachmentMetadata(item: FeedItem): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      sourceId: `feed:${item.id}`,
      feedItemId: item.id,
      来源: '信息流',
      类型: item.type,
      分类: getFeedCategoryLabel(item) || item.category || '',
      来源名称: item.source || '',
      reportKey: item.reportKey || '',
      reportVersion: item.reportVersion || '',
      originalName: item.originalName || '',
      publishedAt: item.publishedAt || '',
      pushedAt: item.pushedAt || '',
    })
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}
