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
  model: string = 'gemini-2.5-flash' // default fallback Model
): Promise<WikiIngestResponse | null> {
  if (sourceTexts.length === 0) return null;

  const serializedWiki = existingArticles.map(a => ({
    id: a.id,
    title: a.title,
    content: a.content
  }));

  const systemPrompt = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "${industryCategory}".
Your task is to integrate newly discovered intelligence (sources) into the existing Wiki.

CURRENT WIKI STATE (JSON array of articles):
${JSON.stringify(serializedWiki)}

NEW SOURCE MATERIAL:
${sourceTexts.map((text, i) => `--- SOURCE ${i+1} ---\n${text}`).join('\n\n')}

INSTRUCTIONS:
1. Analyze the NEW SOURCE MATERIAL.
2. Determine if it contains new facts, trends, or contradictions regarding "${industryCategory}".
3. Decide how to modify the CURRENT WIKI STATE. You can:
   - UPDATE an existing article if the content naturally fits as an enhancement or correction.
   - CREATE a new article if the source discusses an entirely new orthogonal topic within the industry.
4. Output your decision strictly as a JSON object matching the following TypeScript interface (No markdown wrapping, purely the valid JSON string!!!):
   {
      "actions": [
        {
          "type": "create" | "update",
          "articleId": "id-of-existing-article-if-update",
          "title": "Title of the article",
          "content": "The full Markdown content of the new or updated article (make sure to merge old content if updating)",
          "description": "Brief 1-sentence log of what you did and why"
        }
      ]
   }
If the source material provides zero relevant knowledge, you may return an empty actions array: {"actions": []}.
Always retain existing valuable information when updating an article. Output pure JSON without backticks.`;

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

    // Clean markdown backticks just in case
    resultString = resultString.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    const parsed = JSON.parse(resultString) as WikiIngestResponse;
    return parsed;
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
