import { aiApi } from '../db/apiClient.ts';
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
 * System-hardcoded rules appended AFTER the user's prompt template.
 * These are NOT editable by the user but should be visible in the UI.
 */
export const WIKI_SYSTEM_RULES = `INSTRUCTIONS:
1. Read the source carefully and completely. Extract ALL substantive information — numbers, forecasts, opinions, strategic plans, market data, competitive dynamics, personnel changes, policy impacts, timelines.
2. Verify that every key data point ends up in the appropriate Wiki article. If a data point does not fit any existing article, create a new article for it. No information should be silently dropped.
3. Pay attention to the DATE and METADATA of the source. Always prioritize the newest information. If newer facts contradict older ones, update the wiki to reflect the latest state while noting the change.
4. When updating an existing article, use INCREMENTAL EDIT commands (see output format below). Do NOT output the full article — only specify which sections to modify and how. This saves tokens and prevents data loss.
5. ARTICLE STRUCTURE — ADAPTIVE BY PAGE TYPE:
Each page type is defined above in PAGE TYPES. You MUST strictly follow those definitions — do NOT use page types that are not listed.
Common structural principles for ALL page types:
- Always mark temporal context (when was this data/opinion from)
- Prioritize non-standard metrics (orders, pipeline, pricing, capacity utilization, customer concentration). Standard financials (revenue, profit) only on significant change.
- When updating, use incremental EDIT commands (see output format below). Never replace wholesale.
- Use horizontal time-series tables (time as columns, metrics as rows) where it naturally fits for quantitative tracking.
- Each article should have clear ## section headings that organize content logically.
- For articles comparing multiple entities, use markdown tables with entities as rows and dimensions as columns.
- For articles tracking quantitative metrics over time, use a single horizontal time-series table; add new time columns on the right, never delete old ones.
- For articles breaking down sub-segments, give each sub-segment its own ## section.

6. CROSS-REFERENCES: At the end of each article, add a "相关文章" section listing related wiki articles by title. Format: → [Article Title]. This helps build a connected knowledge network. Only reference articles that genuinely share data or context.

7. Output your decision strictly using XML tags. Each tag MUST include a summary attribute — a one-line index summary of the article's scope (<50 chars, Chinese).

**For NEW articles (action="create"):** Output the FULL content:
<article action="create" title="Title" description="Brief log of why" summary="一句话摘要，如：EPC行业订单与产能趋势追踪">
# Your deep, comprehensive markdown content goes here...
</article>

**For UPDATING existing articles (action="update"):** Use INCREMENTAL EDIT commands. Do NOT output the full article. Instead, specify one or more <edit> tags inside the <article> tag. Each <edit> targets a specific ## section:
<article action="update" id="existing-id" title="Title" description="Brief log of changes" summary="更新后的一句话摘要">
<edit section="核心指标趋势" mode="append">
New content to append at the END of this section...
</edit>
<edit section="管理层解读与分析" mode="prepend">
New content to insert at the TOP of this section...
</edit>
<edit section="核心判断" mode="replace">
Completely rewritten section content (use sparingly, only when the old content is outdated)...
</edit>
<edit section="新增章节标题" mode="create">
Content for a brand new section to add at the end of the article...
</edit>
</article>

Edit modes:
- **append**: Add content at the end of the section (most common — use for new data points, new time periods, new entries)
- **prepend**: Add content at the top of the section (use for reverse-chronological sections like 管理层解读)
- **replace**: Replace the entire section content (use only when old content is fully superseded)
- **create**: Add a new ## section to the article (use when a new theme/driver emerges)

CRITICAL RULES for incremental edits:
- NEVER output the full article content for updates — only <edit> tags
- Each <edit> must target a specific ## section by its exact heading text
- You can have multiple <edit> tags in one <article> to update several sections
- If no sections need updating, do not output an <article> tag at all

8. VISUAL CITATIONS WITH HOVER TOOLTIPS (CRITICAL REQUIREMENT):
Whenever you assert a fact or write a paragraph based on the Source Material, you MUST append an inline HTML visual citation capsule at the end of the sentence or block. Match the color scheme to the source type from its Metadata (Expert / Management / Sellside / News, etc.).
CRITICAL: You must include the EXACT 'Title' of the source note in the 'title' attribute of the span! And use the 'align-super' and 'cursor-help' classes.

- For "Management" or "管理层": <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Expert" or "专家": <span class="bg-sky-100 text-sky-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Sellside" or "卖方研报": <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For Unknown/News/Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>

Example (source note titled '中国重汽3月交流纪要'):
- 预计2024下半年产能利用率将从70%提升至85% <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='中国重汽3月交流纪要'>'24/07</span>。

Only output the <article> XML tags. Do not output anything outside of the XML tags.`;

/**
 * The user-editable portion of the default prompt (context header + variable placeholders).
 * This is what appears in the editable text area. The WIKI_SYSTEM_RULES are appended automatically.
 */
export const DEFAULT_WIKI_USER_PROMPT = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "{{industryCategory}}".
Your task is to thoroughly extract and integrate ALL intelligence from the source material into the existing Wiki. Your goal is **comprehensive coverage** — every meaningful data point, claim, trend, and opinion in the source must be captured in the Wiki. Do not summarize or compress; extract exhaustively.

CURRENT DATE: {{currentDate}}

PAGE TYPES — each article must be one of the following types. Use the type tag in the title prefix (e.g. "[公司] 三一重工"):
{{pageTypes}}

{{customInstructions}}

CURRENT WIKI STATE (index with descriptions; recently updated articles include full content):
{{serializedWiki}}

RECENT ACTIVITY LOG (what has been ingested/changed recently — avoid re-processing the same sources):
{{recentLog}}

NEW SOURCE MATERIAL:
{{sourceMaterial}}`;

export interface WikiIngestInstruction {
  type: 'create' | 'update';
  scope?: string; // e.g. "EPC" or "EPC::Quanta Services" — used by multi-scope ingest
  articleId?: string; // Make sure to target correct article when updating
  title: string;
  content: string;
  description: string; // Action log description (why this change was made)
  indexSummary: string; // One-line summary for index (<50 chars)
}

export interface WikiIngestResponse {
  actions: WikiIngestInstruction[];
}

/**
 * Callback invoked after each source is ingested.
 * The caller should apply the actions (addArticle / updateArticle) and return
 * the **latest** full list of articles so the next source sees up-to-date wiki state.
 */
export type OnSourceComplete = (actions: WikiIngestInstruction[], sourceIndex: number, totalSources: number) => WikiArticle[];

/**
 * Apply incremental <edit> tags to an existing article's content.
 * Supports modes: append, prepend, replace, create (new section).
 */
function applyIncrementalEdits(existingContent: string, editXml: string): string {
  const editRegex = /<edit\s+([^>]+)>([\s\S]*?)<\/edit>/gi;
  let content = existingContent;
  let editMatch;

  while ((editMatch = editRegex.exec(editXml)) !== null) {
    const editAttrs = editMatch[1];
    const editContent = editMatch[2].trim();

    const sectionMatch = editAttrs.match(/section=["']([^"']+)["']/i);
    const modeMatch = editAttrs.match(/mode=["'](append|prepend|replace|create)["']/i);

    if (!sectionMatch) continue;

    const sectionTitle = sectionMatch[1];
    const mode = modeMatch ? modeMatch[1] : 'append';

    if (mode === 'create') {
      // Add a new section at the end (before 相关文章 if it exists)
      const relatedIdx = content.search(/\n## 相关文章/);
      const newSection = `\n\n## ${sectionTitle}\n\n${editContent}`;
      if (relatedIdx !== -1) {
        content = content.slice(0, relatedIdx) + newSection + content.slice(relatedIdx);
      } else {
        content = content + newSection;
      }
      continue;
    }

    // Find the section boundary: from "## sectionTitle" to the next "## " or end
    const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`(## ${escapedTitle}[^\\n]*\\n)([\\s\\S]*?)(?=\\n## |$)`);
    const sectionHit = content.match(sectionRegex);

    if (!sectionHit) {
      // Section not found — treat as create
      const relatedIdx = content.search(/\n## 相关文章/);
      const newSection = `\n\n## ${sectionTitle}\n\n${editContent}`;
      if (relatedIdx !== -1) {
        content = content.slice(0, relatedIdx) + newSection + content.slice(relatedIdx);
      } else {
        content = content + newSection;
      }
      continue;
    }

    const sectionHeader = sectionHit[1];
    const sectionBody = sectionHit[2];
    const fullMatch = sectionHit[0];

    let newSectionContent: string;
    switch (mode) {
      case 'append':
        newSectionContent = sectionHeader + sectionBody.trimEnd() + '\n\n' + editContent;
        break;
      case 'prepend':
        newSectionContent = sectionHeader + editContent + '\n\n' + sectionBody.trimStart();
        break;
      case 'replace':
        newSectionContent = sectionHeader + editContent;
        break;
      default:
        newSectionContent = sectionHeader + sectionBody.trimEnd() + '\n\n' + editContent;
    }

    content = content.replace(fullMatch, newSectionContent);
  }

  return content;
}

export async function ingestSourcesToWiki(
  industryCategory: string,
  existingArticles: WikiArticle[],
  sourceTexts: string[],
  model: string = 'gemini-2.5-flash', // default fallback Model
  promptTemplate: string = '',
  onSourceComplete?: OnSourceComplete,
  recentActions?: WikiAction[],
  pageTypes?: string,
  shouldAbort?: () => boolean,
  abortSignal?: AbortSignal,
  customInstructions?: string
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const allActions: WikiIngestInstruction[] = [];
  let currentArticles = existingArticles;

  for (let i = 0; i < sourceTexts.length; i++) {
    // Check abort before starting each source
    if (shouldAbort?.() || abortSignal?.aborted) {
      console.log(`⏹️ Wiki ingest aborted at source ${i + 1}/${sourceTexts.length}`);
      break;
    }

    console.log(`📦 Wiki ingest source ${i + 1}/${sourceTexts.length}`);

    let actions: WikiIngestInstruction[];
    try {
      actions = await ingestSingleSource(
        industryCategory, currentArticles, sourceTexts[i], i + 1, sourceTexts.length, model, promptTemplate, recentActions, pageTypes, abortSignal, customInstructions
      );
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`⏹️ Wiki ingest stream aborted mid-source ${i + 1}/${sourceTexts.length}`);
        break;
      }
      throw err;
    }

    if (actions.length > 0) {
      allActions.push(...actions);
      if (onSourceComplete) {
        currentArticles = onSourceComplete(actions, i, sourceTexts.length);
      }
    }
  }

  return { actions: allActions };
}

/**
 * Ingest a single source into the wiki.
 */
async function ingestSingleSource(
  industryCategory: string,
  currentArticles: WikiArticle[],
  sourceText: string,
  sourceNum: number,
  totalSources: number,
  model: string,
  promptTemplate: string,
  recentActions?: WikiAction[],
  pageTypes?: string,
  abortSignal?: AbortSignal,
  customInstructions?: string
): Promise<WikiIngestInstruction[]> {
  // Build wiki context: index (title + description) for all articles,
  // full content only for the most recently updated articles (token optimization)
  const MAX_FULL_CONTENT = 8;
  const sortedArticles = [...currentArticles].sort((a, b) => b.updatedAt - a.updatedAt);
  const fullContentIds = new Set(sortedArticles.slice(0, MAX_FULL_CONTENT).map(a => a.id));
  const serializedWiki = currentArticles.map(a => fullContentIds.has(a.id)
    ? { id: a.id, title: a.title, description: a.description || '', content: a.content }
    : { id: a.id, title: a.title, description: a.description || '' }
  );

  const currentDate = new Date().toLocaleString();

  // Build the full system prompt: user-editable part + system rules
  const userPrompt = promptTemplate || DEFAULT_WIKI_USER_PROMPT;
  let systemPrompt = userPrompt + '\n\n' + WIKI_SYSTEM_RULES;

  // Build recent activity log — compact Karpathy-style format for LLM context
  const recentLog = (recentActions || [])
    .filter(a => a.industryCategory === industryCategory)
    .slice(0, 30)
    .map(a => {
      const d = new Date(a.timestamp);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      return `[${dateStr}] ${a.action} ${a.articleTitle} — ${a.description}`;
    })
    .join('\n') || '(No recent activity)';

  // Inject page types — use whatever the user configured, no smart parsing
  const resolvedPageTypes = pageTypes || DEFAULT_PAGE_TYPES;

  // Build custom instructions block (only inject if non-empty)
  const customInstructionsBlock = customInstructions?.trim()
    ? `INDUSTRY-SPECIFIC ANALYSIS FOCUS (该行业的专属分析框架与重点关注方向):\n${customInstructions.trim()}\n\n提取信息时，优先关注上述方向相关的数据点。`
    : '';

  systemPrompt = systemPrompt
    .replace(/\{\{industryCategory\}\}/g, industryCategory)
    .replace(/\{\{currentDate\}\}/g, currentDate)
    .replace(/\{\{pageTypes\}\}/g, resolvedPageTypes)
    .replace(/\{\{customInstructions\}\}/g, customInstructionsBlock)
    .replace(/\{\{serializedWiki\}\}/g, JSON.stringify(serializedWiki))
    .replace(/\{\{recentLog\}\}/g, recentLog)
    .replace(/\{\{sourceMaterial\}\}/g, sourceText);

  try {
    let resultString = '';
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: `Ingest source ${sourceNum}/${totalSources}. Thoroughly extract and integrate ALL intelligence from this source into the Wiki. Every data point, number, forecast, opinion, and trend must be captured. Do not drop any information.` }],
      systemPrompt,
      signal: abortSignal,
    })) {
      if (event.type === 'text' && event.content) {
        resultString += event.content;
      }
    }

    // Parse XML tags via regex for maximum stability avoiding JSON limits
    const actions: WikiIngestInstruction[] = [];
    const articleRegex = /<article\s+([^>]+)>([\s\S]*?)<\/article>/gi;
    let match;

    while ((match = articleRegex.exec(resultString)) !== null) {
      const attrsStr = match[1];
      const rawContent = match[2].trim();

      const typeMatch = attrsStr.match(/action=["'](create|update)["']/i);
      const titleMatch = attrsStr.match(/title=["']([^"']+)["']/i);
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      const descMatch = attrsStr.match(/description=["']([^"']+)["']/i);
      const summaryMatch = attrsStr.match(/summary=["']([^"']+)["']/i);

      if (typeMatch) {
        const actionType = typeMatch[1].toLowerCase() as 'create' | 'update';
        const articleId = idMatch ? idMatch[1] : undefined;
        let finalContent = rawContent;

        // For updates: check for incremental <edit> tags
        if (actionType === 'update' && articleId && rawContent.includes('<edit ')) {
          const existingArticle = currentArticles.find(a => a.id === articleId);
          if (existingArticle) {
            finalContent = applyIncrementalEdits(existingArticle.content, rawContent);
          }
        }

        actions.push({
          type: actionType,
          title: titleMatch ? titleMatch[1] : 'Untitled',
          articleId,
          description: descMatch ? descMatch[1] : '更新的内容',
          indexSummary: summaryMatch ? summaryMatch[1] : '',
          content: finalContent
        });
      }
    }

    if (actions.length === 0 && resultString.trim() !== '') {
       console.warn('No standard <article> XML tags captured from AI response.', resultString);
    }

    return actions;
  } catch (err) {
    console.error(`Failed to ingest source ${sourceNum}:`, err);
    throw err;
  }
}

// ─── Multi-Scope Ingest (一键全分类) ─────────────────────────────────────

/**
 * Ingest sources into MULTIPLE wiki scopes simultaneously.
 * When called at industry level (e.g. "EPC"), the LLM automatically classifies
 * content into the industry wiki and/or individual company wikis.
 */
export async function ingestSourcesToWikiMultiScope(
  industryCategory: string,
  entityNames: string[],
  allScopeArticles: WikiArticle[],
  sourceTexts: string[],
  model: string = 'gemini-2.5-flash',
  promptTemplate: string = '',
  onSourceComplete?: OnSourceComplete,
  recentActions?: WikiAction[],
  pageTypes?: string,
  shouldAbort?: () => boolean,
  abortSignal?: AbortSignal,
  customInstructions?: string,
  multiScopeRules?: string
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const allActions: WikiIngestInstruction[] = [];
  let currentArticles = allScopeArticles;

  for (let i = 0; i < sourceTexts.length; i++) {
    if (shouldAbort?.() || abortSignal?.aborted) {
      console.log(`⏹️ Multi-scope ingest aborted at source ${i + 1}/${sourceTexts.length}`);
      break;
    }

    console.log(`📦 Multi-scope ingest source ${i + 1}/${sourceTexts.length}`);

    let actions: WikiIngestInstruction[];
    try {
      actions = await ingestSingleSourceMultiScope(
        industryCategory, entityNames, currentArticles, sourceTexts[i],
        i + 1, sourceTexts.length, model, promptTemplate, recentActions, pageTypes, abortSignal, customInstructions, multiScopeRules
      );
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`⏹️ Multi-scope stream aborted mid-source ${i + 1}/${sourceTexts.length}`);
        break;
      }
      throw err;
    }

    if (actions.length > 0) {
      allActions.push(...actions);
      if (onSourceComplete) {
        currentArticles = onSourceComplete(actions, i, sourceTexts.length);
      }
    }
  }

  return { actions: allActions };
}

async function ingestSingleSourceMultiScope(
  industryCategory: string,
  entityNames: string[],
  allScopeArticles: WikiArticle[],
  sourceText: string,
  sourceNum: number,
  totalSources: number,
  model: string,
  promptTemplate: string,
  recentActions?: WikiAction[],
  pageTypes?: string,
  abortSignal?: AbortSignal,
  customInstructions?: string,
  multiScopeRules?: string
): Promise<WikiIngestInstruction[]> {
  const currentDate = new Date().toLocaleString();

  // Use whatever page types the user configured — no smart parsing
  const resolvedPageTypes = pageTypes || DEFAULT_PAGE_TYPES;

  // Build multi-scope wiki state
  const industryArticles = allScopeArticles.filter(a => a.industryCategory === industryCategory);
  const companyArticlesMap = new Map<string, WikiArticle[]>();
  for (const name of entityNames) {
    const scope = `${industryCategory}::${name}`;
    companyArticlesMap.set(name, allScopeArticles.filter(a => a.industryCategory === scope));
  }

  // Token optimization: serialize as index (title + description) for most articles,
  // full content only for the most recently updated ones per scope
  const serializeArticles = (articles: WikiArticle[]) => {
    if (articles.length === 0) return '(空)';
    const sorted = [...articles].sort((a, b) => b.updatedAt - a.updatedAt);
    const fullIds = new Set(sorted.slice(0, 5).map(a => a.id));
    return sorted.map(a => fullIds.has(a.id)
      ? JSON.stringify({ id: a.id, title: a.title, description: a.description || '', content: a.content })
      : JSON.stringify({ id: a.id, title: a.title, description: a.description || '' })
    ).join('\n');
  };

  let multiScopeContext = `=== SCOPE: "${industryCategory}" (行业大盘) ===\n`;
  multiScopeContext += `现有文章:\n${serializeArticles(industryArticles)}\n\n`;

  for (const name of entityNames) {
    const scope = `${industryCategory}::${name}`;
    const arts = companyArticlesMap.get(name) || [];
    multiScopeContext += `=== SCOPE: "${scope}" (${name} 公司专属) ===\n`;
    multiScopeContext += `现有文章:\n${serializeArticles(arts)}\n\n`;
  }

  // Build recent activity log (across all scopes) — compact format
  const recentLog = (recentActions || [])
    .filter(a => a.industryCategory === industryCategory || a.industryCategory.startsWith(industryCategory + '::'))
    .slice(0, 30)
    .map(a => {
      const d = new Date(a.timestamp);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      return `[${dateStr}] ${a.action} [${a.industryCategory}] ${a.articleTitle} — ${a.description}`;
    })
    .join('\n') || '(No recent activity)';

  // Build system prompt — multi-scope version uses user's page types + routing rules
  const systemPrompt = `You are a highly capable analytical AI maintaining a multi-scope Industry Wiki system for the industry: "${industryCategory}".

Your task is to thoroughly extract and integrate ALL intelligence from the source material into the correct Wiki scopes. Your goal is **comprehensive coverage** — every meaningful data point, claim, trend, and opinion in the source must be captured. Do not summarize or compress; extract exhaustively.

CURRENT DATE: ${currentDate}

PAGE TYPES (用户定义的页面类型，严格遵守，不得发明新类型):
${resolvedPageTypes}

${customInstructions?.trim() ? `INDUSTRY-SPECIFIC ANALYSIS FOCUS (该行业的专属分析框架与重点关注方向):\n${customInstructions.trim()}\n\n提取信息时，优先关注上述方向相关的数据点。` : ''}

MULTI-SCOPE WIKI SYSTEM:
${multiScopeContext}

${multiScopeRules || DEFAULT_MULTI_SCOPE_RULES}

RECENT ACTIVITY LOG:
${recentLog}

NEW SOURCE MATERIAL:
${sourceText}

${WIKI_SYSTEM_RULES}

MULTI-SCOPE OUTPUT FORMAT:
Every <article> tag MUST include a scope attribute to specify which scope it belongs to.

**For NEW articles (action="create"):**
<article action="create" scope="${industryCategory}::CompanyName" title="[页面类型] Article Title" description="Brief log" summary="一句话摘要(<50字)">
# Comprehensive markdown content...
</article>

**For UPDATING existing articles (action="update"):** Use INCREMENTAL <edit> tags:
<article action="update" scope="${industryCategory}" id="existing-article-id" title="[页面类型] Article Title" description="Brief log" summary="更新后的摘要">
<edit section="章节标题" mode="append">
New data to add at end of section...
</edit>
</article>

Only output the <article> XML tags. Do not output anything outside of the XML tags.`;

  try {
    let resultString = '';
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: `Ingest source ${sourceNum}/${totalSources}. Thoroughly extract and integrate ALL intelligence from this source into the correct Wiki scopes. Every data point must be captured and classified to the right scope.` }],
      systemPrompt,
      signal: abortSignal,
    })) {
      if (event.type === 'text' && event.content) {
        resultString += event.content;
      }
    }

    // Parse XML tags — now including scope attribute
    const actions: WikiIngestInstruction[] = [];
    const articleRegex = /<article\s+([^>]+)>([\s\S]*?)<\/article>/gi;
    let match;

    while ((match = articleRegex.exec(resultString)) !== null) {
      const attrsStr = match[1];
      const rawContent = match[2].trim();

      const typeMatch = attrsStr.match(/action=["'](create|update)["']/i);
      const titleMatch = attrsStr.match(/title=["']([^"']+)["']/i);
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      const descMatch = attrsStr.match(/description=["']([^"']+)["']/i);
      const scopeMatch = attrsStr.match(/scope=["']([^"']+)["']/i);
      const summaryMatch = attrsStr.match(/summary=["']([^"']+)["']/i);

      if (typeMatch) {
        const actionType = typeMatch[1].toLowerCase() as 'create' | 'update';
        const articleId = idMatch ? idMatch[1] : undefined;
        let finalContent = rawContent;

        // For updates: check for incremental <edit> tags
        if (actionType === 'update' && articleId && rawContent.includes('<edit ')) {
          const existingArticle = allScopeArticles.find((a: WikiArticle) => a.id === articleId);
          if (existingArticle) {
            finalContent = applyIncrementalEdits(existingArticle.content, rawContent);
          }
        }

        actions.push({
          type: actionType,
          scope: scopeMatch ? scopeMatch[1] : industryCategory,
          title: titleMatch ? titleMatch[1] : 'Untitled',
          articleId,
          description: descMatch ? descMatch[1] : '更新的内容',
          indexSummary: summaryMatch ? summaryMatch[1] : '',
          content: finalContent
        });
      }
    }

    if (actions.length === 0 && resultString.trim() !== '') {
      console.warn('No standard <article> XML tags captured from multi-scope AI response.', resultString);
    }

    return actions;
  } catch (err) {
    console.error(`Failed to multi-scope ingest source ${sourceNum}:`, err);
    throw err;
  }
}

export async function queryWiki(
  industryCategory: string,
  existingArticles: WikiArticle[],
  userQuery: string,
  model: string = 'gemini-2.5-flash'
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
  model: string = 'gemini-2.5-flash',
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
