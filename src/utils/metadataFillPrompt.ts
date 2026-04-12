/**
 * Shared metadata fill prompt utilities.
 * Single source of truth for both MetadataHeader (aiprocess) and CanvasMetadataEditor (canvas).
 */
import { aiApi } from '../db/apiClient';
import { INDUSTRY_COMPANIES } from '../constants/industryCategories';

// ── Default prompt ──────────────────────────────────────────────
export const DEFAULT_METADATA_FILL_PROMPT = `你是一个金融研究助手。根据会议/通话的转录文本，提取以下元数据字段。

要求：
- topic: 会议主题，简洁描述（20字以内）
- organization: ⚠️ 只填一个公司！填会议讨论的最核心的那一家公司。如果会议泛泛谈论了多个公司而没有明确的核心公司，则留空。使用规范命名格式：
  - 美股: [TICKER US] Company Full Name，如 [DE US] Deere & Company
  - 港股: [代码 HK] 公司全称，如 [0669 HK] 创科实业有限公司
  - A股: [6位代码 CH] 公司全称，如 [600031 CH] 三一重工
  - 非上市: 不用写
  现有命名参考：
  {sampleCompanies}
- speaker: 演讲人/嘉宾的姓名，如果有多位用逗号分隔
- participants: 演讲人类型，只能是 management / expert / sellside 之一
- intermediary: 中介机构（券商、咨询公司等），没有则留空
- industry: 行业细分分类，必须从以下选项中选择最匹配的一个（只输出选项名称，不要输出其他内容）：
  {industryOptions}
- country: 国家/地区（中国/美国/日本/韩国/欧洲/印度/其他），只能有一个
- eventDate: 会议发生的大致日期，格式如 2024/3/15，如果无法判断则等于创建时间

严格按 JSON 格式输出，不要任何解释：
{"topic":"","organization":"","speaker":"","participants":"","intermediary":"","industry":"","country":"","eventDate":""}`;

// ── Sample company names for prompt context ─────────────────────
export const SAMPLE_COMPANIES: string[] = [];
for (const companies of Object.values(INDUSTRY_COMPANIES)) {
  for (const c of companies) {
    if (c.startsWith('[') && SAMPLE_COMPANIES.length < 20) {
      SAMPLE_COMPANIES.push(c);
    }
  }
}

// ── Get / Save prompt (localStorage + cloud) ────────────────────
export function getMetadataFillPrompt(): string {
  try {
    const saved = localStorage.getItem('metadataFillPrompt');
    if (saved && saved.trim()) return saved;
  } catch {}
  return DEFAULT_METADATA_FILL_PROMPT;
}

export async function saveMetadataFillPrompt(prompt: string) {
  localStorage.setItem('metadataFillPrompt', prompt);
  try {
    await aiApi.saveSettings({ metadataFillPrompt: prompt });
  } catch (e) {
    console.warn('云端同步 metadataFillPrompt 失败:', e);
  }
}

// ── Bidirectional cloud sync ────────────────────────────────────
export async function syncMetadataFillPrompt(): Promise<void> {
  try {
    const res = await aiApi.getSettings();
    if (res?.metadataFillPrompt) {
      localStorage.setItem('metadataFillPrompt', res.metadataFillPrompt);
    } else {
      const local = localStorage.getItem('metadataFillPrompt');
      if (local && local !== DEFAULT_METADATA_FILL_PROMPT) {
        await aiApi.saveSettings({ metadataFillPrompt: local });
      }
    }
  } catch {}
}

// ── Sample text chunks for AI input ─────────────────────────────
export function sampleTextChunks(text: string, chunkCount = 6, chunkSize = 500): string {
  if (!text) return '';
  if (text.length <= chunkCount * chunkSize) return text;
  const gap = Math.floor(text.length / chunkCount);
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * gap;
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks.join('\n...\n');
}

// ── Guard: keep only the first company if AI returns multiple ───
export function guardSingleOrg(org: string): string {
  if (!org) return '';
  const firstOrg = org.split(/[,，、;；]/)[0].trim();
  if (firstOrg !== org.trim()) {
    console.log(`⚠️ AI returned multiple orgs, keeping first: "${firstOrg}" (was: "${org}")`);
  }
  return firstOrg;
}
