import { aiApi } from '../db/apiClient.ts';
import type { WikiArticle, WikiAction } from '../types/wiki.ts';

export interface WikiIngestInstruction {
  type: 'create' | 'update';
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
  shouldAbort?: () => boolean
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const allActions: WikiIngestInstruction[] = [];
  let currentArticles = existingArticles;

  for (let i = 0; i < sourceTexts.length; i++) {
    // Check abort before starting each source
    if (shouldAbort?.()) {
      console.log(`⏹️ Wiki ingest aborted at source ${i + 1}/${sourceTexts.length}`);
      break;
    }

    console.log(`📦 Wiki ingest source ${i + 1}/${sourceTexts.length}`);

    const actions = await ingestSingleSource(
      industryCategory, currentArticles, sourceTexts[i], i + 1, sourceTexts.length, model, promptTemplate, recentActions, pageTypes
    );

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
  pageTypes?: string
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

PAGE TYPES — each article must be one of the following types. Use the type tag in the title prefix (e.g. "[公司] 三一重工"):
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
5. Output your decision strictly using XML tags for articles instead of JSON. You can write as much detailed Markdown content inside the tags as needed without worrying about JSON formatting errors.

<article action="create" title="Title of new article" description="Brief 1-sentence log of why you created this">
# Your deep, comprehensive markdown content goes here...
</article>

<article action="update" id="id-of-existing-article-if-update" title="Title of updated article" description="Brief 1-sentence log of changes">
# Your merged, comprehensive markdown content goes here...
</article>

6. VISUAL CITATIONS (CRITICAL REQUIREMENT):
Whenever you assert a fact or write a paragraph based on the Source Material, you MUST append an inline HTML visual citation capsule at the end of the sentence or block. Match the color scheme to the source type from its Metadata (Expert / Management / Sellside / News, etc.):

- For "Management" or "管理层": <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For "Expert" or "专家": <span class="bg-sky-100 text-sky-700 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For "Sellside" or "卖方研报": <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For Unknown/News/Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>

Example of generating a bullet point:
- 预计2024下半年产能利用率将从70%提升至85% <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[10px] font-medium ml-1">'24/07</span>。

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
  const industryDefaultTypes = `- [公司] 单个公司的专属页面：经营动态、财务数据、产能、战略规划、管理层观点。\n- [趋势] 行业性的趋势和主题：技术路线演进、政策变化、供需格局变动、价格走势。\n- [对比] 多个实体之间的横向比较：竞争格局、市场份额、产品对比、估值对比。`;
  const companyDefaultTypes = `- [经营] 公司经营数据：营收、利润、产能利用率、订单、出货量等量化指标和变化趋势。\n- [战略] 公司战略与规划：管理层表态、业务方向调整、并购、扩产计划、研发投入。\n- [市场] 公司的市场地位与竞争：市场份额、客户结构、竞品对比、定价策略。`;

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
