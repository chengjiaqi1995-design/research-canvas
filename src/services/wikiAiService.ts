import { aiApi } from '../db/apiClient.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';

export interface WikiIngestInstruction {
  type: 'create' | 'update';
  scope?: string; // e.g. "EPC" or "EPC::Quanta Services" — used by multi-scope ingest
  articleId?: string; // Make sure to target correct article when updating
  title: string;
  content: string;
  description: string;
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
  abortSignal?: AbortSignal
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
        industryCategory, currentArticles, sourceTexts[i], i + 1, sourceTexts.length, model, promptTemplate, recentActions, pageTypes, abortSignal
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
  abortSignal?: AbortSignal
): Promise<WikiIngestInstruction[]> {
  const serializedWiki = currentArticles.map(a => ({
    id: a.id,
    title: a.title,
    content: a.content
  }));

  const currentDate = new Date().toLocaleString();

  let systemPrompt = promptTemplate;
  if (!systemPrompt) {
    // Fallback if none provided
    systemPrompt = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "{{industryCategory}}".
Your task is to thoroughly extract and integrate ALL intelligence from the source material into the existing Wiki. Your goal is **comprehensive coverage** — every meaningful data point, claim, trend, and opinion in the source must be captured in the Wiki. Do not summarize or compress; extract exhaustively.

CURRENT DATE: {{currentDate}}

PAGE TYPES — each article must be one of the following types. Use the type tag in the title prefix (e.g. "[趋势] 行业周期分析"):
{{pageTypes}}

CURRENT WIKI STATE (JSON array of articles):
{{serializedWiki}}

RECENT ACTIVITY LOG (what has been ingested/changed recently — avoid re-processing the same sources):
{{recentLog}}

NEW SOURCE MATERIAL:
{{sourceMaterial}}

INSTRUCTIONS:
1. Read the source carefully and completely. Extract ALL substantive information — numbers, forecasts, opinions, strategic plans, market data, competitive dynamics, personnel changes, policy impacts, timelines.
2. Verify that every key data point ends up in the appropriate Wiki article. If a data point does not fit any existing article, create a new article for it. No information should be silently dropped.
3. Pay attention to the DATE and METADATA of the source. Always prioritize the newest information. If newer facts contradict older ones, update the wiki to reflect the latest state while noting the change.
4. When updating an existing article, MERGE the new information into it — keep all existing valuable content and add the new data points in the appropriate sections. Never replace an article wholesale unless the old content is entirely superseded.
5. ARTICLE STRUCTURE — TIME-SERIES FORMAT (CRITICAL):
Every article of EVERY page type MUST follow this three-section structure to preserve temporal evolution:

a) 「当前画像」section at top: A concise snapshot of the LATEST state. Refresh entirely when new data arrives. Prioritize non-standard metrics (orders, pipeline, pricing, capacity utilization, customer concentration, contract terms). Standard financial numbers (revenue, net income) should only be mentioned when there is a significant change or inflection point — do not routinely list every quarter's revenue/profit.

b) 「指标趋势与关键变化」section: A SINGLE markdown table with TIME as the HORIZONTAL axis (columns, left=oldest → right=newest). Each row = one metric. The LAST row is always "**关键变化**" with attribution/reasoning. Example:
| 指标 | 2025Q3 | 2025Q4 | 2026Q1 |
|------|--------|--------|--------|
| 在手订单 | $9.9B (+8%) | $11.1B (+12%) | $12.8B (+15%) |
| 意向合同 | $3.5B | $3.8B | $4.2B |
| **关键变化** | 电力占比首超40% | 订单创新高 | 数据中心订单集中释放 |
When new data arrives, ADD a new column on the RIGHT. Never delete old columns. Rows adapt to the most relevant non-standard metrics for this topic.

c) 「深度分析」section: Qualitative insights, expert opinions, management commentary. Append new entries at top (reverse chronological).

6. Output your decision strictly using XML tags for articles instead of JSON. You can write as much detailed Markdown content inside the tags as needed without worrying about JSON formatting errors.

<article action="create" title="Title of new article" description="Brief 1-sentence log of why you created this">
# Your deep, comprehensive markdown content goes here...
</article>

<article action="update" id="id-of-existing-article-if-update" title="Title of updated article" description="Brief 1-sentence log of changes">
# Your merged, comprehensive markdown content goes here...
</article>

6. VISUAL CITATIONS WITH HOVER TOOLTIPS (CRITICAL REQUIREMENT):
Whenever you assert a fact or write a paragraph based on the Source Material, you MUST append an inline HTML visual citation capsule at the end of the sentence or block. Match the color scheme to the source type from its Metadata (Expert / Management / Sellside / News, etc.).
CRITICAL: You must include the EXACT 'Title' of the source note in the 'title' attribute of the span! And use the 'align-super' and 'cursor-help' classes.

- For "Management" or "管理层": <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Expert" or "专家": <span class="bg-sky-100 text-sky-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For "Sellside" or "卖方研报": <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- For Unknown/News/Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>

Example (source note titled '中国重汽3月交流纪要'):
- 预计2024下半年产能利用率将从70%提升至85% <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='中国重汽3月交流纪要'>'24/07</span>。

Always retain existing valuable information when updating an article. Only output the <article> XML tags. Do not output anything outside of the XML tags.`;
  }

  // Build recent activity log
  const recentLog = (recentActions || [])
    .filter(a => a.industryCategory === industryCategory)
    .slice(0, 20)
    .map(a => `[${new Date(a.timestamp).toLocaleDateString()}] ${a.action} | ${a.articleTitle} — ${a.description}`)
    .join('\n') || '(No recent activity)';

  // Inject variables — auto-select the correct page types based on scope
  const isCompanyScope = industryCategory.includes('::');
  const industryDefaultTypes = `- [趋势] 行业性的趋势和主题：技术路线演进、政策变化、供需格局变动、价格走势等跨公司的共性话题。\n- [对比] 多个实体之间的横向比较：竞争格局、市场份额、产品对比、估值对比等需要并排分析的内容。\n- [拆分] 行业细分环节的深度拆解：价值链不同环节的分析、不同参与者角色的视角与决策逻辑、细分市场的结构性差异。`;
  const companyDefaultTypes = `- [经营] 公司经营数据：营收、利润、产能利用率、订单、出货量等量化指标和变化趋势。\n- [战略] 公司战略与规划：管理层表态、业务方向调整、并购、扩产计划、研发投入。\n- [市场] 公司的市场地位与竞争：市场份额、客户结构、竞品对比、定价策略。\n- [拆分] 公司各业务条线的拆解：不同业务板块的营收构成、增长驱动、利润率差异、战略侧重。`;

  let resolvedPageTypes: string;
  if (pageTypes && pageTypes.includes('当 Wiki scope 是')) {
    // User has the combined template — extract the relevant section
    if (isCompanyScope) {
      const companyMatch = pageTypes.match(/当 Wiki scope 是公司级别时[^：]*：\n?([\s\S]*?)(?:\n\n当|$)/);
      resolvedPageTypes = companyMatch ? companyMatch[1].trim() : companyDefaultTypes;
    } else {
      const industryMatch = pageTypes.match(/当 Wiki scope 是行业级别时[^：]*：\n?([\s\S]*?)(?:\n\n当|$)/);
      resolvedPageTypes = industryMatch ? industryMatch[1].trim() : industryDefaultTypes;
    }
  } else {
    resolvedPageTypes = pageTypes || (isCompanyScope ? companyDefaultTypes : industryDefaultTypes);
  }

  // Append strict enforcement so LLM doesn't invent page types or mimic wrong existing ones
  if (isCompanyScope) {
    resolvedPageTypes += `\n\n⚠️ 严格规则：你只能使用上面列出的页面类型标签。绝对不能使用 [趋势]、[对比]、[拆分] 等行业级别标签。如果已有文章使用了错误的标签，在更新时必须纠正为正确标签。`;
  } else {
    resolvedPageTypes += `\n\n⚠️ 严格规则：你只能使用上面列出的页面类型标签。绝对不能使用 [经营]、[战略]、[市场]、[拆分] 等公司级别标签。行业 Wiki 不为单个公司建立专属页面——公司相关信息只在有专属 scope 时才放入公司 wiki，否则融入 [趋势] 或 [对比] 页面中提及即可。如果已有文章使用了错误的标签（如 [公司]），在更新时必须纠正。`;
  }

  systemPrompt = systemPrompt
    .replace(/\{\{industryCategory\}\}/g, industryCategory)
    .replace(/\{\{currentDate\}\}/g, currentDate)
    .replace(/\{\{pageTypes\}\}/g, resolvedPageTypes)
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
      const content = match[2].trim();

      const typeMatch = attrsStr.match(/action=["'](create|update)["']/i);
      const titleMatch = attrsStr.match(/title=["']([^"']+)["']/i);
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      const descMatch = attrsStr.match(/description=["']([^"']+)["']/i);

      if (typeMatch) {
        actions.push({
          type: typeMatch[1].toLowerCase() as 'create' | 'update',
          title: titleMatch ? titleMatch[1] : 'Untitled',
          articleId: idMatch ? idMatch[1] : undefined,
          description: descMatch ? descMatch[1] : '更新的内容',
          content: content
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
  abortSignal?: AbortSignal
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
        i + 1, sourceTexts.length, model, promptTemplate, recentActions, pageTypes, abortSignal
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
  abortSignal?: AbortSignal
): Promise<WikiIngestInstruction[]> {
  const currentDate = new Date().toLocaleString();

  // Resolve page types
  const industryDefaultTypes = `- [趋势] 行业性的趋势和主题：技术路线演进、政策变化、供需格局变动、价格走势等跨公司的共性话题。\n- [对比] 多个实体之间的横向比较：竞争格局、市场份额、产品对比、估值对比等需要并排分析的内容。\n- [拆分] 行业细分环节的深度拆解：价值链不同环节的分析、不同参与者角色的视角与决策逻辑、细分市场的结构性差异。`;
  const companyDefaultTypes = `- [经营] 公司经营数据：营收、利润、产能利用率、订单、出货量等量化指标和变化趋势。\n- [战略] 公司战略与规划：管理层表态、业务方向调整、并购、扩产计划、研发投入。\n- [市场] 公司的市场地位与竞争：市场份额、客户结构、竞品对比、定价策略。\n- [拆分] 公司各业务条线的拆解：不同业务板块的营收构成、增长驱动、利润率差异、战略侧重。`;

  let resolvedIndustryTypes = industryDefaultTypes;
  let resolvedCompanyTypes = companyDefaultTypes;
  if (pageTypes && pageTypes.includes('当 Wiki scope 是')) {
    const indMatch = pageTypes.match(/当 Wiki scope 是行业级别时[^：]*：\n?([\s\S]*?)(?:\n\n当|$)/);
    if (indMatch) resolvedIndustryTypes = indMatch[1].trim();
    const compMatch = pageTypes.match(/当 Wiki scope 是公司级别时[^：]*：\n?([\s\S]*?)(?:\n\n当|$)/);
    if (compMatch) resolvedCompanyTypes = compMatch[1].trim();
  }

  // Build multi-scope wiki state
  const industryArticles = allScopeArticles.filter(a => a.industryCategory === industryCategory);
  const companyArticlesMap = new Map<string, WikiArticle[]>();
  for (const name of entityNames) {
    const scope = `${industryCategory}::${name}`;
    companyArticlesMap.set(name, allScopeArticles.filter(a => a.industryCategory === scope));
  }

  const serializeArticles = (articles: WikiArticle[]) =>
    articles.length === 0
      ? '(空)'
      : articles.map(a => JSON.stringify({ id: a.id, title: a.title, content: a.content })).join('\n');

  let multiScopeContext = `=== SCOPE: "${industryCategory}" (行业大盘) ===\n`;
  multiScopeContext += `页面类型:\n${resolvedIndustryTypes}\n`;
  multiScopeContext += `现有文章:\n${serializeArticles(industryArticles)}\n\n`;

  for (const name of entityNames) {
    const scope = `${industryCategory}::${name}`;
    const arts = companyArticlesMap.get(name) || [];
    multiScopeContext += `=== SCOPE: "${scope}" (${name} 公司专属) ===\n`;
    multiScopeContext += `页面类型:\n${resolvedCompanyTypes}\n`;
    multiScopeContext += `现有文章:\n${serializeArticles(arts)}\n\n`;
  }

  // Build recent activity log (across all scopes)
  const recentLog = (recentActions || [])
    .filter(a => a.industryCategory === industryCategory || a.industryCategory.startsWith(industryCategory + '::'))
    .slice(0, 30)
    .map(a => `[${new Date(a.timestamp).toLocaleDateString()}] ${a.action} | [${a.industryCategory}] ${a.articleTitle} — ${a.description}`)
    .join('\n') || '(No recent activity)';

  // Build system prompt — use a dedicated multi-scope prompt (ignores user's single-scope template)
  const systemPrompt = `You are a highly capable analytical AI maintaining a multi-scope Industry Wiki system for the industry: "${industryCategory}".

Your task is to thoroughly extract and integrate ALL intelligence from the source material into the correct Wiki scopes. Your goal is **comprehensive coverage** — every meaningful data point, claim, trend, and opinion in the source must be captured. Do not summarize or compress; extract exhaustively.

CURRENT DATE: ${currentDate}

MULTI-SCOPE WIKI SYSTEM:
${multiScopeContext}

ROUTING RULES (严格遵守，避免重复):

1. 内容去向判断：
   - 某个已知公司（有专属 scope）的具体信息（财务数据、经营指标、战略规划、管理层表态、市场份额等）→ 只放到该公司的 scope，例如 scope="${industryCategory}::公司名"
   - 行业级宏观趋势、政策变化、技术路线、不涉及特定公司的分析 → scope="${industryCategory}" 的 [趋势] 页面
   - 多公司横向对比（市场份额排名、估值对比表等）→ scope="${industryCategory}" 的 [对比] 页面
   - 行业价值链细分环节分析、不同参与者角色视角 → scope="${industryCategory}" 的 [拆分] 页面
   - 公司各业务条线拆解 → 该公司 scope 的 [拆分] 页面

2. ⚠️ 绝对不能重复：如果某公司有专属 scope，该公司的具体数据只写入公司 scope，绝不在行业 scope 中重复。

3. ⚠️ 行业 scope 不为单个公司建立专属页面：没有专属 scope 的公司，相关信息融入 [趋势]/[对比] 页面中提及即可，不要创建 [公司] 类型的页面。

4. 页面类型限制：行业 scope 只用 [趋势]/[对比]/[拆分]，公司 scope 只用 [经营]/[战略]/[市场]/[拆分]，绝不混用。

5. 一条笔记可以同时产出多个 scope 的文章，但每条具体信息只出现在一个地方。

RECENT ACTIVITY LOG:
${recentLog}

NEW SOURCE MATERIAL:
${sourceText}

INSTRUCTIONS:
1. Read the source carefully and completely. Extract ALL substantive information — numbers, forecasts, opinions, strategic plans, market data, competitive dynamics, personnel changes, policy impacts, timelines.
2. For each piece of information, decide which scope it belongs to based on the ROUTING RULES above.
3. Verify that every key data point ends up in the appropriate Wiki article in the correct scope. If a data point does not fit any existing article, create a new article. No information should be silently dropped.
4. Pay attention to the DATE and METADATA of the source. Always prioritize the newest information.
5. When updating an existing article, MERGE the new information into it — keep all existing valuable content and add the new data points. Never replace an article wholesale.
6. ARTICLE STRUCTURE — TIME-SERIES FORMAT (CRITICAL):
Every article of EVERY page type ([经营],[战略],[市场],[拆分],[趋势],[对比]) MUST follow this three-section structure:

a) 「当前画像」section at top: Concise snapshot of the LATEST state. Refresh entirely when new data arrives. Prioritize non-standard metrics (orders, pipeline, pricing, capacity utilization, customer concentration). Standard financial numbers only when there is a significant change — do not routinely list every quarter's revenue/profit.

b) 「指标趋势与关键变化」section: A SINGLE markdown table. TIME is the HORIZONTAL axis (columns, left=oldest → right=newest). Each row = one metric. Last row = "**关键变化**" with attribution. Example:
| 指标 | 2025Q3 | 2025Q4 | 2026Q1 |
|------|--------|--------|--------|
| 在手订单 | $9.9B (+8%) | $11.1B (+12%) | $12.8B (+15%) |
| **关键变化** | 电力占比首超40% | 订单创新高 | 数据中心订单集中释放 |
New data → ADD column on the RIGHT. Never delete old columns.

c) 「深度分析」section: Qualitative insights, expert opinions, management commentary. Append at top (reverse chronological).

7. Output your decision strictly using XML tags. **Every <article> tag MUST include a scope attribute**:

<article action="create" scope="${industryCategory}::CompanyName" title="[经营] Article Title" description="Brief log">
# Comprehensive markdown content...
</article>

<article action="update" scope="${industryCategory}" id="existing-article-id" title="[趋势] Article Title" description="Brief log of changes">
# Merged markdown content...
</article>

8. VISUAL CITATIONS WITH HOVER TOOLTIPS (CRITICAL):
Append inline HTML citation capsules matching source type. CRITICAL: include the EXACT 'Title' of the source note in the 'title' attribute! Use 'align-super' and 'cursor-help' classes.
- Management/管理层: <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- Expert/专家: <span class="bg-sky-100 text-sky-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- Sellside/卖方研报: <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>
- Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[9px] font-medium ml-1 align-super cursor-help" title='{Source Note Title}'>'YY/MM</span>

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
      const content = match[2].trim();

      const typeMatch = attrsStr.match(/action=["'](create|update)["']/i);
      const titleMatch = attrsStr.match(/title=["']([^"']+)["']/i);
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      const descMatch = attrsStr.match(/description=["']([^"']+)["']/i);
      const scopeMatch = attrsStr.match(/scope=["']([^"']+)["']/i);

      if (typeMatch) {
        actions.push({
          type: typeMatch[1].toLowerCase() as 'create' | 'update',
          scope: scopeMatch ? scopeMatch[1] : industryCategory,
          title: titleMatch ? titleMatch[1] : 'Untitled',
          articleId: idMatch ? idMatch[1] : undefined,
          description: descMatch ? descMatch[1] : '更新的内容',
          content: content
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
  model: string = 'gemini-2.5-flash'
): Promise<string> {
  const serializedWiki = existingArticles.map(a => ({
    title: a.title,
    content: a.content
  }));

  const systemPrompt = `You are an expert editor reviewing the Industry Wiki for "${industryCategory}".
Analyze the provided Wiki articles to find:
1. **Contradictions**: Conflicting facts, numbers, or statements across different articles.
2. **Orphans/Gaps**: Vague paragraphs, missing context, or topics that are mentioned but lack detail.

WIKI KNOWLEDGE BASE:
${JSON.stringify(serializedWiki)}

Respond with a strictly formatted Markdown report. If everything is well-organized and consistent, explicitly state: "Wiki 内容结构清晰，未发现明显矛盾或孤立内容。"`;

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
