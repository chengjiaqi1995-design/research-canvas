import { aiApi } from '../db/apiClient.ts';
import type { WikiArticle } from '../types/wiki.ts';

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
  onSourceComplete?: OnSourceComplete
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const allActions: WikiIngestInstruction[] = [];
  let currentArticles = existingArticles;

  for (let i = 0; i < sourceTexts.length; i++) {
    console.log(`📦 Wiki ingest source ${i + 1}/${sourceTexts.length}`);

    const actions = await ingestSingleSource(
      industryCategory, currentArticles, sourceTexts[i], i + 1, sourceTexts.length, model, promptTemplate
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
  promptTemplate: string
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

CURRENT WIKI STATE (JSON array of articles):
{{serializedWiki}}

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

  // Inject variables
  systemPrompt = systemPrompt
    .replace(/\{\{industryCategory\}\}/g, industryCategory)
    .replace(/\{\{currentDate\}\}/g, currentDate)
    .replace(/\{\{serializedWiki\}\}/g, JSON.stringify(serializedWiki))
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
