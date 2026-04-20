import { aiApi, wikiIngestToolsApi } from '../db/apiClient.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';
import { DEFAULT_MULTI_SCOPE_RULES, DEFAULT_LINT_DIMENSIONS } from '../aiprocess/components/ApiConfigModal.tsx';

/** Fallback page types used only when the user hasn't configured any */
const DEFAULT_PAGE_TYPES = `当 Wiki scope 是行业级别时 (industryCategory 不含 "::")，使用以下页面类型：
- [趋势] 行业性的趋势和主题
- [对比] 多个实体之间的横向比较
- [拆分] 行业细分环节的深度拆解

当 Wiki scope 是公司级别时 (industryCategory 含 "::")，使用以下页面类型：
- [经营] 公司经营数据
- [战略] 公司战略与规划
- [市场] 公司的市场地位与竞争
- [拆分] 公司各业务条线的拆解`;

/**
 * System-hardcoded rules shown read-only in the UI so users understand the
 * protocol. These are baked into the server-side tool-use system prompt
 * (see buildToolIngestSystemPrompt + server.js /api/wiki-ingest-tools).
 */
export const WIKI_SYSTEM_RULES = `INSTRUCTIONS (tool-use protocol):
1. Read the source carefully and completely. Extract ALL substantive information — numbers, forecasts, opinions, strategic plans, market data, competitive dynamics, personnel changes, policy impacts, timelines.
2. Verify that every key data point ends up in the appropriate Wiki article. If a data point does not fit any existing article, create a new one. No information should be silently dropped.
3. Pay attention to the DATE and METADATA of the source. Always prioritize the newest information. If newer facts contradict older ones, update the wiki to reflect the latest state while noting the change.

4. ARTICLE STRUCTURE — ADAPTIVE BY PAGE TYPE:
- You MUST use the page types defined above. Do NOT invent new types.
- Always mark temporal context (when was this data/opinion from).
- Prioritize non-standard metrics (orders, pipeline, pricing, capacity utilization, customer concentration). Standard financials (revenue, profit) only on significant change.
- Use horizontal time-series tables (time as columns, metrics as rows) for quantitative tracking; add new time columns on the right, never delete old ones.
- Each article has clear \`## section\` headings. For multi-entity comparison articles use markdown tables (entities as rows, dimensions as columns). For sub-segment breakdowns give each sub-segment its own \`## section\`.

5. TOOL ROUTING (choose the cheapest tool that fits):
- NEW TOPIC not covered by any existing article → create_article(scope, title, content, summary).
- PURE ADDITION (adding a section, bullet, or data point without touching existing text) → append_to_article(id, content). This is the safest choice and your default for additive work. No string matching required.
- INLINE CHANGE to existing text (updating a number, rewriting a sentence, replacing a section body) → read_article first, then edit_article(id, old_string, new_string). read_article returns content line-numbered in \`  N\\tline\` format; strip the \`  N\\t\` prefix when constructing old_string. Match is byte-for-byte.
- RESTRUCTURE most of the article → write_article(id, content).
- If edit_article fails once with "old_string not found", switch strategy (use append_to_article or write_article) — do NOT re-read the same article in a loop.

6. VISUAL CITATIONS WITH HOVER TOOLTIPS (CRITICAL REQUIREMENT):
Whenever you assert a fact or write a paragraph based on the Source Material, append an inline HTML visual citation capsule at the end of the sentence or block. The color scheme must match the source type in its metadata.
CRITICAL: Include the EXACT 'Title' of the source note in the \`title\` attribute; use \`align-super\` and \`cursor-help\` classes.

- For "Management" or "管理层": <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Expert" or "专家": <span class="bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Sellside" or "卖方研报": <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For Unknown/News/Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>

Example (source note titled '中国重汽3月交流纪要'):
- 预计2024下半年产能利用率将从70%提升至85% <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='中国重汽3月交流纪要'>'24/07</span>。

7. End every run by calling finish({note}) — even if you made no changes.`;

/**
 * The user-editable portion of the default prompt (context header for the run).
 * The tool-use runtime takes this as the user-visible intent; the server
 * injects article index, scope guidance, and routing rules automatically.
 */
export const DEFAULT_WIKI_USER_PROMPT = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "{{industryCategory}}".
Your task is to thoroughly extract and integrate ALL intelligence from the source material into the Wiki via the provided tools. Your goal is **comprehensive coverage** — every meaningful data point, claim, trend, and opinion in the source must be captured. Do not summarize away specifics.

CURRENT DATE: {{currentDate}}

PAGE TYPES — each article must be one of the following types. Use the type tag in the title prefix (e.g. "[公司] 三一重工"):
{{pageTypes}}

{{customInstructions}}`;


// ─── Tool-use ingest ───────────────────────────────────────────────────────
// The server runs a multi-round LLM tool-use loop and persists every
// create_article / edit_article / append_to_article / write_article directly
// into the per-industry bundle in GCS.
// The client's only job here is:
//   1. Drive one SSE stream per source text.
//   2. Surface progress (tool calls + created/updated article titles) to the UI.
//   3. After each source, reload the store from cloud so local state reflects
//      what was persisted server-side.
//
// Returned `applied` entries are for the UI's generation-log / undo display —
// they are NOT re-applied by the caller (the bundle is already persisted).

export interface WikiToolIngestApplied {
  title: string;
  action: 'create' | 'update';
  scope: string;
  id?: string;
}

export interface WikiToolIngestProgress {
  sourceIndex: number;       // 0-based
  totalSources: number;
  round?: number;
  toolName?: string;
  phase: 'start' | 'tool_call' | 'tool_result' | 'article_created' | 'article_updated' | 'done' | 'error';
  message: string;           // Human-readable status for ingest progress line
}

export interface WikiToolIngestResult {
  applied: WikiToolIngestApplied[];
  aborted: boolean;
  errors: string[];          // Per-source error messages (empty on success)
}

function buildToolIngestSystemPrompt(opts: {
  industryCategory: string;
  entityNames?: string[];
  customInstructions?: string;
  pageTypes?: string;
  multiScopeRules?: string;
  recentLog: string;
  currentDate: string;
}): string {
  const {
    industryCategory, entityNames, customInstructions,
    pageTypes, multiScopeRules, recentLog, currentDate,
  } = opts;
  const resolvedPageTypes = pageTypes || DEFAULT_PAGE_TYPES;
  const isIndustryLevel = !industryCategory.includes('::') && (entityNames?.length || 0) > 0;

  const scopeGuidance = isIndustryLevel
    ? `This industry has sub-scopes for the following entities:\n${
        (entityNames || []).map(n => `  - ${industryCategory}::${n}`).join('\n')
      }\n\nROUTING RULES (decide scope per create_article call):\n${multiScopeRules || DEFAULT_MULTI_SCOPE_RULES}`
    : `Single-scope ingest. All articles must use scope="${industryCategory}" (or leave scope= industryCategory).`;

  const customBlock = customInstructions?.trim()
    ? `INDUSTRY-SPECIFIC ANALYSIS FOCUS (该行业的专属分析框架与重点关注方向):\n${customInstructions.trim()}\n提取信息时，优先关注上述方向相关的数据点。`
    : '';

  return `You are a highly capable analyst maintaining an Industry Wiki for: "${industryCategory}".

CURRENT DATE: ${currentDate}

Your job is to ingest ONE source document per turn into the wiki by calling tools.
Be exhaustive — every meaningful data point, number, forecast, opinion and trend in the
source must end up in the wiki. Do not summarize away specifics.

PAGE TYPES (用户定义的页面类型，严格遵守，不得发明新类型):
${resolvedPageTypes}

${customBlock}

SCOPE GUIDANCE:
${scopeGuidance}

RECENT ACTIVITY LOG (avoid re-processing the same sources):
${recentLog}

TOOL-USE PROTOCOL (REQUIRED):
- Start by reviewing the compact article index the server injects below (id, title, scope, summary of every existing article in this industry).
- For each piece of information in the source, route to ONE of these:
    • NEW TOPIC not covered by any existing article → create_article.
    • PURE ADDITION (adding a section, bullet, or data point without touching existing text) → append_to_article(id, content). This is the safest choice and your default when "adding new material" applies. No string matching needed; cannot fail on whitespace. If you want a new \`## heading\` section, put that heading line at the top of \`content\` yourself.
    • INLINE CHANGE to existing text (updating a number, rewriting a sentence, replacing a section body) → read_article first, then edit_article(id, old_string, new_string). Content from read_article comes back line-numbered ("  N\\tline text"); when constructing \`old_string\` you MUST strip the "  N\\t" prefix and use only the raw line content. Match is byte-for-byte.
    • RESTRUCTURE most of the article → write_article.
- If edit_article fails once with "old_string not found", DO NOT re-read the same article 3 times in a loop. Switch strategy: use append_to_article for additions, or write_article for rewrites.
- Every article MUST live under this industry. Sub-scopes use "industry::entity" form.
- Always include the visual citation span at the end of each sentence/block, exactly like:
    <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
  Pick the color scheme based on the source type (Management=slate-800; Expert=sky-100; Sellside=blue-100; otherwise slate-100).
- When done, always call finish({note}) — even if you made no changes.`;
}

export async function ingestSourcesToWikiViaTools(args: {
  industryCategory: string;               // Top-level industry (split scope on "::")
  entityNames?: string[];                 // For multi-scope runs
  sourceTexts: string[];                  // Raw source strings, one per note
  sourceMetadatas?: Array<{ title?: string; url?: string; date?: string } | undefined>;
  model: string;
  recentActions?: WikiAction[];
  pageTypes?: string;
  customInstructions?: string;
  multiScopeRules?: string;
  maxRounds?: number;
  shouldAbort?: () => boolean;
  abortSignal?: AbortSignal;
  onProgress?: (p: WikiToolIngestProgress) => void;
  onSourceComplete?: (sourceIndex: number, totalSources: number) => void | Promise<void>;
}): Promise<WikiToolIngestResult> {
  const {
    industryCategory, entityNames = [], sourceTexts, sourceMetadatas = [],
    model, recentActions, pageTypes, customInstructions, multiScopeRules,
    maxRounds, shouldAbort, abortSignal, onProgress, onSourceComplete,
  } = args;

  const applied: WikiToolIngestApplied[] = [];
  const errors: string[] = [];
  let aborted = false;

  if (sourceTexts.length === 0) {
    return { applied, aborted: false, errors };
  }

  // Top-level industry key (bundle key for every source in this run).
  const topLevel = industryCategory.split('::')[0] || industryCategory;

  const currentDate = new Date().toLocaleString();
  const recentLog = (recentActions || [])
    .filter(a => a.industryCategory === industryCategory ||
                 a.industryCategory.startsWith(topLevel + '::') ||
                 a.industryCategory === topLevel)
    .slice(0, 30)
    .map(a => {
      const d = new Date(a.timestamp);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      return `[${dateStr}] ${a.action} [${a.industryCategory}] ${a.articleTitle} — ${a.description}`;
    })
    .join('\n') || '(No recent activity)';

  const systemPrompt = buildToolIngestSystemPrompt({
    industryCategory, entityNames, customInstructions,
    pageTypes, multiScopeRules, recentLog, currentDate,
  });

  // Default scope hint: if caller passed a sub-scope, forward it; otherwise leave it
  // to the LLM's routing logic.
  const scopeHint = industryCategory.includes('::') ? industryCategory : undefined;

  for (let i = 0; i < sourceTexts.length; i++) {
    if (shouldAbort?.() || abortSignal?.aborted) {
      aborted = true;
      break;
    }

    onProgress?.({
      sourceIndex: i, totalSources: sourceTexts.length,
      phase: 'start',
      message: `正在处理第 ${i + 1}/${sourceTexts.length} 条笔记...`,
    });

    try {
      const stream = wikiIngestToolsApi.stream({
        industry: topLevel,
        source: sourceTexts[i],
        sourceMetadata: sourceMetadatas[i],
        scopeHint,
        model,
        systemPrompt,
        maxRounds,
      }, abortSignal);

      for await (const ev of stream) {
        if (shouldAbort?.() || abortSignal?.aborted) {
          aborted = true;
          break;
        }
        if (ev.type === 'tool_call') {
          const argsBrief =
            ev.name === 'create_article' ? String((ev.args as any)?.title || '').slice(0, 40)
            : ev.name === 'append_to_article' ? `${String((ev.args as any)?.id || '').slice(0, 8)} +${String((ev.args as any)?.content || '').length}字`
            : ev.name === 'write_article' ? String((ev.args as any)?.id || '').slice(0, 24)
            : ev.name === 'edit_article' ? `${String((ev.args as any)?.id || '').slice(0, 8)} [${String((ev.args as any)?.old_string || '').slice(0, 24)}…]`
            : ev.name === 'read_article' ? String((ev.args as any)?.id || '').slice(0, 24)
            : ev.name === 'list_articles' ? String((ev.args as any)?.scope || 'all')
            : '';
          onProgress?.({
            sourceIndex: i, totalSources: sourceTexts.length,
            round: ev.round, toolName: ev.name, phase: 'tool_call',
            message: `第 ${i + 1}/${sourceTexts.length} 条 · r${ev.round} · ${ev.name}(${argsBrief})`,
          });
        } else if (ev.type === 'article_created') {
          applied.push({ title: ev.title, action: 'create', scope: ev.scope, id: ev.id });
          onProgress?.({
            sourceIndex: i, totalSources: sourceTexts.length, phase: 'article_created',
            toolName: 'create_article',
            message: `✨ 新建 "${ev.title}" (${ev.scope})`,
          });
        } else if (ev.type === 'article_updated') {
          applied.push({ title: `(id=${ev.id})`, action: 'update', scope: ev.scope || industryCategory, id: ev.id });
          onProgress?.({
            sourceIndex: i, totalSources: sourceTexts.length, phase: 'article_updated',
            toolName: 'edit_article',
            message: `✏️ 更新 (id=${ev.id.slice(0, 8)}…)`,
          });
        } else if (ev.type === 'error') {
          errors.push(`[source ${i + 1}] ${ev.content}`);
          onProgress?.({
            sourceIndex: i, totalSources: sourceTexts.length, phase: 'error',
            message: `❌ 第 ${i + 1}/${sourceTexts.length} 条报错: ${ev.content}`,
          });
        } else if (ev.type === 'done') {
          onProgress?.({
            sourceIndex: i, totalSources: sourceTexts.length, phase: 'done',
            message: `第 ${i + 1}/${sourceTexts.length} 条完成 · ${ev.rounds} 轮`,
          });
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        aborted = true;
        break;
      }
      errors.push(`[source ${i + 1}] ${err?.message || String(err)}`);
      onProgress?.({
        sourceIndex: i, totalSources: sourceTexts.length, phase: 'error',
        message: `❌ 第 ${i + 1}/${sourceTexts.length} 条请求失败: ${err?.message || err}`,
      });
    }

    if (onSourceComplete) {
      try { await onSourceComplete(i, sourceTexts.length); } catch { /* ignore */ }
    }
  }

  return { applied, aborted, errors };
}

export async function queryWiki(
  industryCategory: string,
  existingArticles: WikiArticle[],
  userQuery: string,
  model: string = 'gemini-3-flash-preview'
): Promise<string> {
  const serializedWiki = existingArticles.map(a => ({
    title: a.title,
    content: a.content
  }));

  const systemPrompt = `You are a knowledgeable AI assistant specializing in the "${industryCategory}" industry.
Use ONLY the provided Wiki knowledge base to answer the user's question. If the answer cannot be found in the Wiki, state clearly that you don't have enough information in the current Wiki, but DO NOT use external knowledge.

WIKI KNOWLEDGE BASE:
${JSON.stringify(serializedWiki)}

Respond in friendly and clear Markdown formatting.`;

  try {
    let resultString = '';
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: userQuery }],
      systemPrompt,
    })) {
      if (event.type === 'text' && event.content) {
        resultString += event.content;
      }
    }
    return resultString;
  } catch (err) {
    console.error('Failed to query Wiki:', err);
    throw err;
  }
}

export async function lintWiki(
  industryCategory: string,
  existingArticles: Pick<WikiArticle, 'title' | 'content'>[],
  model: string = 'gemini-3-flash-preview',
  lintDimensions?: string
): Promise<string> {
  const serializedWiki = existingArticles.map(a => ({
    title: a.title,
    content: a.content
  }));

  const dimensions = lintDimensions || DEFAULT_LINT_DIMENSIONS;

  const systemPrompt = `You are an expert editor reviewing the Industry Wiki for "${industryCategory}".
Analyze the provided Wiki articles across these dimensions:

${dimensions}

WIKI KNOWLEDGE BASE:
${JSON.stringify(serializedWiki)}

Respond with a structured Markdown report. For each dimension, list findings or state "未发现问题". Use Chinese.
If everything is well-organized, explicitly state: "Wiki 内容结构清晰，未发现明显问题。"`;

  try {
    let resultString = '';
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: 'Please lint the wiki and provide the report.' }],
      systemPrompt,
    })) {
      if (event.type === 'text' && event.content) {
        resultString += event.content;
      }
    }
    return resultString;
  } catch (err) {
    console.error('Failed to lint Wiki:', err);
    throw err;
  }
}
