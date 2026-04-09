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

export async function ingestSourcesToWiki(
  industryCategory: string,
  existingArticles: WikiArticle[],
  sourceTexts: string[],
  model: string = 'gemini-2.5-flash', // default fallback Model
  promptTemplate: string = ''
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const serializedWiki = existingArticles.map(a => ({
    id: a.id,
    title: a.title,
    content: a.content
  }));

  const sourceMaterial = sourceTexts.map((text, i) => `--- SOURCE ${i+1} ---\n${text}`).join('\n\n');
  const currentDate = new Date().toLocaleString();

  let systemPrompt = promptTemplate;
  if (!systemPrompt) {
    // Fallback if none provided
    systemPrompt = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "{{industryCategory}}".
Your task is to integrate newly discovered intelligence (sources) into the existing Wiki.

CURRENT DATE: {{currentDate}}

CURRENT WIKI STATE (JSON array of articles):
{{serializedWiki}}

NEW SOURCE MATERIAL:
{{sourceMaterial}}

INSTRUCTIONS:
1. Analyze the NEW SOURCE MATERIAL.
2. Determine if it contains new facts, trends, or contradictions regarding "{{industryCategory}}".
3. CRITICAL: Pay attention to the DATE and METADATA of the sources. Always prioritize the newest information. If newer facts contradict older ones, update the wiki to reflect the latest state.
4. Output your decision strictly using XML tags for articles instead of JSON. You can write as much detailed Markdown content inside the tags as needed without worrying about JSON formatting errors.

<article action="create" title="Title of new article" description="Brief 1-sentence log of why you created this">
# Your deep, comprehensive markdown content goes here...
</article>

<article action="update" id="id-of-existing-article-if-update" title="Title of updated article" description="Brief 1-sentence log of changes">
# Your merged, comprehensive markdown content goes here...
</article>

5. VISUAL CITATIONS (CRITICAL REQUIREMENT):
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
    .replace(/\{\{sourceMaterial\}\}/g, sourceMaterial);

  try {
    let resultString = '';
    for await (const event of aiApi.chatStream({
      model,
      messages: [{ role: 'user', content: 'Compile and compress the new intelligence into the Wiki.' }],
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
    
    return { actions };
  } catch (err) {
    console.error('Failed to parse Wiki Ingest LLM response:', err);
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
