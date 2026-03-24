/**
 * 周度总结服务
 * 负责：数据收集、高亮提取、Benchmark 对比、AI 生成周报
 */

import prisma from '../utils/db';
import axios from 'axios';

// ==================== 类型定义 ====================

export interface WeeklyHighlight {
  text: string;
  sourceId: string;
  sourceTitle: string;
  organization?: string;
  industry?: string;
}

export interface BenchmarkData {
  newCompanies: string[];
  newIndustries: string[];
  newTopics: string[];
  recurringCompanies: string[];
  recurringTopics: string[];
  droppedCompanies: string[];
  droppedTopics: string[];
  thisWeekNoteCount: number;
  lastWeekNoteCount: number;
}

export interface WeeklyCollectedData {
  notes: Array<{
    id: string;
    fileName: string;
    summary: string;
    translatedSummary: string;
    organization?: string | null;
    industry?: string | null;
    topic?: string | null;
    tags: string[];
  }>;
  highlights: WeeklyHighlight[];
  metadata: {
    companies: string[];
    industries: string[];
    topics: string[];
  };
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  inputLimit: number;
  outputLimit: number;
  inputUtilization: number;   // 百分比 0-100
  outputUtilization: number;  // 百分比 0-100
  segmented: boolean;         // 是否使用了分段输出
  model: string;
  // 详细调用信息
  batchCount: number;         // 输入拆分批次数（1 = 未分批）
  totalCalls: number;         // Gemini 总调用次数（含续写 + 合并）
  continueCalls: number;      // 续写次数（所有环节的续写总和）
}

export interface WeeklySummaryResult {
  summaryHtml: string;
  highlights: WeeklyHighlight[];
  benchmark: BenchmarkData;
  metadata: {
    companies: string[];
    industries: string[];
    topics: string[];
  };
  sources: Array<{ id: string; title: string }>;
  customPrompt: string;
  tokenStats?: TokenStats;
}

// ==================== 默认 Prompt 模板 ====================

// ── 数据上下文（所有模式共用） ──
const WEEKLY_DATA_CONTEXT = `## 本周概览（{weekStart} ~ {weekEnd}）
笔记数量：{noteCount}，涉及行业：{industries}，涉及公司：{companies}

## 本周高亮标注内容（用户在笔记中重点标记的关键信息）
{highlights}

## 与上周对比
{benchmark}

## 各笔记摘要
{summaries}

## 参考来源列表
{references}`;

// ── 输出格式要求（所有模式共用，始终生效） ──
const WEEKLY_OUTPUT_FORMAT = `## 输出格式要求（固定，不可更改，优先级高于 Skill 中的任何格式示例）
- **必须输出 HTML 格式**，使用 h2/h3/p/ul/li/strong/mark/table 标签。Skill 方法论中出现的 Markdown 符号（如 ## • o * - ）仅为结构示意，实际输出时必须全部转换为对应的 HTML 标签（h2/h3 对应 ##，ul/li 对应 • o * -）。绝对不要输出 Markdown。
- 语言：中文
- **输出量要求**：以内容完整性为第一优先级，字数不限。输入材料中每一条通过筛选的信息都必须单独写出，带具体数字和来源，不要合并、不要概括、不要省略。宁多勿少。
- **分批输出**：如果内容很多，你可以分批输出。在每批结尾写上"待续"或"请回复继续"，系统会自动发送"继续"让你接着写。最后一批不要写"待续"。
- **引用格式（严格遵守）**：在总结中提到某篇笔记的内容时，必须标注来源引用。格式为 [REF1] [REF2]，对应上面参考来源列表的编号。
  - 每个引用必须独立写在方括号中：✅ [REF1] [REF2] [REF3]
  - 禁止将多个引用合并在一个方括号内：❌ [REF1, REF2, REF3]
  - 禁止省略 REF 前缀：❌ [1] [2]
  - 每个要点都要标注来源，同一段落可以有多个引用。引用越多越好，方便读者追溯原文。`;

// ── 无 Skill 时的系统 Prompt ──
export const WEEKLY_SYSTEM_PROMPT = `你是一位专业的金融研究助理。请根据以下本周数据，按照用户的分析要求生成周报。

${WEEKLY_DATA_CONTEXT}

---

${WEEKLY_OUTPUT_FORMAT}

---

## 用户的分析要求`;

// ── 有 Skill 时的系统 Prompt ──
export const WEEKLY_SYSTEM_PROMPT_WITH_SKILL = `请根据以下本周数据和周报撰写方法论（Skill），生成投资研究周报。

${WEEKLY_DATA_CONTEXT}

---

## 周报撰写方法论（Skill）

以下是你必须遵循的周报撰写方法论，包括判断标准和行业覆盖。严格按照这个方法论来筛选信息和组织输出。注意：Skill 中的格式符号（## • o * -）仅为结构示意，实际输出必须使用 HTML 标签，以下方"输出格式要求"为准。

{skillContent}

---

${WEEKLY_OUTPUT_FORMAT}`;

// ── 默认用户 Prompt（用户可自由编辑） ──
export const DEFAULT_WEEKLY_USER_PROMPT = `请生成以下结构的研究周报：

1. **本周核心发现**（3-5 个要点）
   - 综合所有笔记和高亮内容，提炼本周最重要的发现
   - 每个发现用 1-2 句话概括，附上来源引用

2. **行业动态**
   - 按行业分组，概括每个行业本周的关键信息和趋势
   - 标注信息来源

3. **公司追踪**
   - 各公司本周的重要变化、业绩、战略动向
   - 包含具体数据和关键指标

4. **与上周对比分析**
   - 新出现的变化和趋势转折
   - 值得关注的新动向

5. **下周关注建议**
   - 基于本周信息，建议下周重点关注的方向和理由`;

// 有 Skill 时的默认用户 Prompt（更简洁，让 Skill 主导）
export const DEFAULT_WEEKLY_USER_PROMPT_WITH_SKILL = `请严格按照 Skill 方法论生成周报。使用方法论中定义的四个核心维度筛选信息，按照格式规范输出。`;

// 完整默认 Prompt = 系统部分 + 用户部分（向后兼容）
export const DEFAULT_WEEKLY_PROMPT = WEEKLY_SYSTEM_PROMPT + '\n' + DEFAULT_WEEKLY_USER_PROMPT;

// ==================== 核心函数 ====================

/**
 * 从 HTML 中提取 <mark> 高亮标签内容
 */
export function extractHighlightsFromHtml(html: string): string[] {
  if (!html) return [];
  const marks: string[] = [];
  const regex = /<mark[^>]*>([\s\S]*?)<\/mark>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    // 去掉内部嵌套的 HTML 标签，只保留纯文本
    const text = m[1].replace(/<[^>]*>/g, '').trim();
    if (text) marks.push(text);
  }
  return marks;
}

/**
 * 获取笔记的优先内容（中文优先）
 */
function getPreferredContent(translatedSummary: string, summary: string): string {
  if (translatedSummary && translatedSummary.trim().length > 0) {
    return translatedSummary;
  }
  return summary;
}

/**
 * 去除 HTML 标签，获取纯文本
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * 计算指定日期所在周的周一和周日
 */
export function getWeekBoundaries(dateStr?: string): { weekStart: Date; weekEnd: Date } {
  const date = dateStr ? new Date(dateStr) : new Date();
  const day = date.getDay(); // 0=Sunday, 1=Monday, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

/**
 * 收集指定周的所有笔记数据和高亮
 */
export async function collectWeeklyData(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<WeeklyCollectedData> {
  // 查询该周内创建的所有笔记（排除 weekly-summary 类型本身）
  const notes = await prisma.transcription.findMany({
    where: {
      userId,
      createdAt: {
        gte: weekStart,
        lte: weekEnd,
      },
      type: {
        not: 'weekly-summary',
      },
      status: 'completed',
    },
    select: {
      id: true,
      fileName: true,
      summary: true,
      translatedSummary: true,
      organization: true,
      industry: true,
      topic: true,
      tags: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const highlights: WeeklyHighlight[] = [];
  const companiesSet = new Set<string>();
  const industriesSet = new Set<string>();
  const topicsSet = new Set<string>();

  for (const note of notes) {
    // 优先从中文内容提取高亮，没有中文则从英文提取
    const preferredHtml = getPreferredContent(note.translatedSummary, note.summary);
    const noteHighlights = extractHighlightsFromHtml(preferredHtml);

    // 如果中文内容没有高亮，也尝试从英文内容提取
    if (noteHighlights.length === 0 && note.translatedSummary && note.summary) {
      const englishHighlights = extractHighlightsFromHtml(note.summary);
      for (const text of englishHighlights) {
        highlights.push({
          text,
          sourceId: note.id,
          sourceTitle: note.fileName,
          organization: note.organization || undefined,
          industry: note.industry || undefined,
        });
      }
    } else {
      for (const text of noteHighlights) {
        highlights.push({
          text,
          sourceId: note.id,
          sourceTitle: note.fileName,
          organization: note.organization || undefined,
          industry: note.industry || undefined,
        });
      }
    }

    // 收集元数据
    if (note.organization) companiesSet.add(note.organization);
    if (note.industry) industriesSet.add(note.industry);
    if (note.topic) topicsSet.add(note.topic);

    // 从 tags 中也收集
    try {
      const tags = JSON.parse(note.tags || '[]') as string[];
      tags.forEach(tag => topicsSet.add(tag));
    } catch (e) {
      // ignore parse errors
    }
  }

  return {
    notes: notes.map(n => ({
      ...n,
      tags: (() => {
        try { return JSON.parse(n.tags || '[]') as string[]; } catch { return []; }
      })(),
    })),
    highlights,
    metadata: {
      companies: Array.from(companiesSet).filter(Boolean),
      industries: Array.from(industriesSet).filter(Boolean),
      topics: Array.from(topicsSet).filter(Boolean),
    },
  };
}

/**
 * 生成 Benchmark 对比数据
 */
export async function generateBenchmark(
  userId: string,
  currentMetadata: { companies: string[]; industries: string[]; topics: string[] },
  currentNoteCount: number,
  weekStart: Date
): Promise<BenchmarkData> {
  // 查找上一周的 weekly-summary
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 1); // 查找 actualDate 在上周一附近的记录

  const prevSummary = await prisma.transcription.findFirst({
    where: {
      userId,
      type: 'weekly-summary',
      actualDate: {
        gte: prevWeekStart,
        lt: prevWeekEnd,
      },
    },
    select: {
      transcriptText: true,
    },
  });

  let prevCompanies: string[] = [];
  let prevIndustries: string[] = [];
  let prevTopics: string[] = [];
  let prevNoteCount = 0;

  if (prevSummary?.transcriptText) {
    try {
      const prevData = JSON.parse(prevSummary.transcriptText);
      if (prevData.benchmark) {
        // 从上周的 benchmark 获取其 "当时" 的数据
        // 实际上我们需要从上周的 metadata 获取
      }
      // 更好的方式：从 transcriptText 中存储的 metadata 获取
      if (prevData.metadata) {
        prevCompanies = prevData.metadata.companies || [];
        prevIndustries = prevData.metadata.industries || [];
        prevTopics = prevData.metadata.topics || [];
      }
      prevNoteCount = prevData.noteCount || 0;
    } catch (e) {
      console.warn('⚠️ 解析上周周报数据失败:', e);
    }
  }

  const currentCompaniesSet = new Set(currentMetadata.companies);
  const currentIndustriesSet = new Set(currentMetadata.industries);
  const currentTopicsSet = new Set(currentMetadata.topics);
  const prevCompaniesSet = new Set(prevCompanies);
  const prevIndustriesSet = new Set(prevIndustries);
  const prevTopicsSet = new Set(prevTopics);

  return {
    newCompanies: currentMetadata.companies.filter(c => !prevCompaniesSet.has(c)),
    recurringCompanies: currentMetadata.companies.filter(c => prevCompaniesSet.has(c)),
    droppedCompanies: prevCompanies.filter(c => !currentCompaniesSet.has(c)),
    newIndustries: currentMetadata.industries.filter(i => !prevIndustriesSet.has(i)),
    recurringTopics: currentMetadata.topics.filter(t => prevTopicsSet.has(t)),
    droppedTopics: prevTopics.filter(t => !currentTopicsSet.has(t)),
    newTopics: currentMetadata.topics.filter(t => !prevTopicsSet.has(t)),
    thisWeekNoteCount: currentNoteCount,
    lastWeekNoteCount: prevNoteCount,
  };
}

/**
 * 构建给 AI 的 Prompt（含数据替换）
 *
 * promptTemplate 参数现在只包含"用户的分析要求"部分（可编辑），
 * 系统固定部分（数据上下文 + 输出格式 + 引用规则）由 WEEKLY_SYSTEM_PROMPT 提供。
 *
 * 向后兼容：如果 promptTemplate 包含 {summaries} 等占位符，
 * 说明是旧版完整 prompt，直接用它做替换（不拼接系统部分）。
 */
export function buildPrompt(
  promptTemplate: string,
  data: WeeklyCollectedData,
  benchmark: BenchmarkData,
  weekStart: Date,
  weekEnd: Date,
  skillContent?: string,
): string {
  // 构建高亮文本块
  const highlightsText = data.highlights.length > 0
    ? data.highlights.map((h, i) =>
      `${i + 1}. "${h.text}" —— 来源：${h.sourceTitle}${h.organization ? `（${h.organization}）` : ''}`
    ).join('\n')
    : '（本周无高亮标注内容）';

  // 构建 benchmark 文本块
  const benchmarkLines: string[] = [];
  if (benchmark.newCompanies.length > 0) benchmarkLines.push(`新增关注公司：${benchmark.newCompanies.join('、')}`);
  if (benchmark.recurringCompanies.length > 0) benchmarkLines.push(`持续关注公司：${benchmark.recurringCompanies.join('、')}`);
  if (benchmark.droppedCompanies.length > 0) benchmarkLines.push(`不再提及公司：${benchmark.droppedCompanies.join('、')}`);
  if (benchmark.newTopics.length > 0) benchmarkLines.push(`新增话题：${benchmark.newTopics.join('、')}`);
  if (benchmark.recurringTopics.length > 0) benchmarkLines.push(`持续关注话题：${benchmark.recurringTopics.join('、')}`);
  if (benchmark.droppedTopics.length > 0) benchmarkLines.push(`不再提及话题：${benchmark.droppedTopics.join('、')}`);
  benchmarkLines.push(`笔记数量变化：本周 ${benchmark.thisWeekNoteCount} 篇 vs 上周 ${benchmark.lastWeekNoteCount} 篇`);
  const benchmarkText = benchmarkLines.length > 0
    ? benchmarkLines.join('\n')
    : '（无上周数据可对比，本周为首次生成）';

  // 构建各笔记摘要（全文输入，不截断）
  // 若总 prompt 超过安全输入上限，callGeminiForWeeklySummary() 会自动拆分笔记分批处理
  const summariesText = data.notes.map((note, i) => {
    const content = getPreferredContent(note.translatedSummary, note.summary);
    const plainText = stripHtml(content);
    const meta = [note.organization, note.industry].filter(Boolean).join(' | ');
    return `### ${i + 1}. ${note.fileName}${meta ? `（${meta}）` : ''}\n${plainText}`;
  }).join('\n\n');

  // 日期格式化
  const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 构建参考来源列表
  const referencesText = data.notes.map((note, i) =>
    `[REF${i + 1}] ${note.fileName}${note.organization ? `（${note.organization}）` : ''}`
  ).join('\n');

  // 判断是新版（纯用户要求）还是旧版（完整 prompt 带占位符）
  const isLegacyFullPrompt = promptTemplate.includes('{summaries}') || promptTemplate.includes('{references}');

  let fullTemplate: string;
  if (isLegacyFullPrompt) {
    fullTemplate = promptTemplate;  // 旧版：直接用
  } else if (skillContent) {
    // 有 Skill：使用专用系统 prompt（数据 + Skill 方法论），用户 prompt 作为补充
    fullTemplate = WEEKLY_SYSTEM_PROMPT_WITH_SKILL + '\n\n## 用户的补充要求\n' + promptTemplate;
  } else {
    // 无 Skill：使用默认系统 prompt
    fullTemplate = WEEKLY_SYSTEM_PROMPT + '\n' + promptTemplate;
  }

  // 做占位符替换
  let prompt = fullTemplate;
  prompt = prompt.replace(/{weekStart}/g, formatDate(weekStart));
  prompt = prompt.replace(/{weekEnd}/g, formatDate(weekEnd));
  prompt = prompt.replace(/{noteCount}/g, String(data.notes.length));
  prompt = prompt.replace(/{industries}/g, data.metadata.industries.join('、') || '无');
  prompt = prompt.replace(/{companies}/g, data.metadata.companies.join('、') || '无');
  prompt = prompt.replace(/{highlights}/g, highlightsText);
  prompt = prompt.replace(/{benchmark}/g, benchmarkText);
  prompt = prompt.replace(/{summaries}/g, summariesText);
  prompt = prompt.replace(/{references}/g, referencesText);
  prompt = prompt.replace(/{skillContent}/g, skillContent || '');

  return prompt;
}

/**
 * 调用 Gemini 生成周报（单次调用）
 */
async function callGeminiOnce(prompt: string, apiKey: string, model: string): Promise<{ html: string; finishReason: string; promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let response;
  try {
    response = await axios.post(url, {
      contents: [{
        parts: [{
          text: prompt,
        }],
      }],
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 65536,
        thinkingConfig: {
          thinkingLevel: 'low',
        },
      },
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 180000,
    });
  } catch (err: any) {
    const errData = err.response?.data;
    console.error('❌ Gemini API 调用失败:', JSON.stringify(errData, null, 2));
    console.error('❌ HTTP status:', err.response?.status);
    throw new Error(`Gemini API 错误 (${err.response?.status}): ${JSON.stringify(errData?.error?.message || errData)}`);
  }

  if (!response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('❌ Gemini 响应格式错误:', JSON.stringify(response.data, null, 2));
    throw new Error('Gemini 响应格式错误');
  }

  const candidate = response.data.candidates[0];
  const usageMetadata = response.data.usageMetadata || {};

  // 详细日志：打印 parts 结构帮助排查
  const parts = candidate.content?.parts || [];
  console.log(`   📦 Gemini 返回 ${parts.length} 个 parts:`);
  parts.forEach((p: any, i: number) => {
    const keys = Object.keys(p);
    const hasThought = 'thought' in p;
    const textPreview = p.text ? p.text.substring(0, 100).replace(/\n/g, '\\n') : '(no text)';
    console.log(`      part[${i}]: keys=[${keys.join(',')}] thought=${hasThought ? p.thought : 'N/A'} text=${textPreview}...`);
  });

  // 提取实际输出（跳过 thinking parts）
  // Gemini thinking 模式下 parts 可能有：
  // - thought=true 的 thinking part
  // - thought=false 或无 thought 字段的 output part
  let outputText = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].text && !parts[i].thought) {
      outputText = parts[i].text;
      break;
    }
  }
  if (!outputText && parts.length > 0) {
    // fallback: 取最后一个有 text 的 part
    outputText = parts[parts.length - 1].text || '';
    console.warn(`   ⚠️ 所有 parts 都是 thought=true，使用 fallback: parts[${parts.length - 1}]`);
  }

  console.log(`   📝 提取输出: ${outputText.length} 字符, 前100: ${outputText.substring(0, 100).replace(/\n/g, '\\n')}`);

  // 清理 Gemini 输出的各种包裹
  outputText = outputText.trim();

  // 1. 清理 markdown 代码块包裹（```html ... ```）
  if (outputText.startsWith('```')) {
    console.log(`   🧹 清理 markdown 代码块包裹`);
    const lines = outputText.split('\n');
    lines.shift();
    if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
      lines.pop();
    }
    outputText = lines.join('\n').trim();
  }

  // 2. 清理完整 HTML 文档包裹（<!DOCTYPE><html><head><body>）
  //    RichTextEditor (TipTap) 只能渲染 HTML 片段，不能渲染完整文档
  if (outputText.includes('<body')) {
    const bodyMatch = outputText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      console.log(`   🧹 清理完整 HTML 文档包裹，提取 <body> 内容`);
      outputText = bodyMatch[1].trim();
    }
  } else if (outputText.startsWith('<!DOCTYPE') || outputText.startsWith('<html')) {
    // 有 html 头但没有 body 标签的情况
    console.log(`   🧹 清理 HTML 文档头`);
    outputText = outputText
      .replace(/<!DOCTYPE[^>]*>/i, '')
      .replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '')
      .replace(/<head>[\s\S]*?<\/head>/i, '')
      .trim();
  }

  console.log(`   ✅ 最终输出: ${outputText.length} 字符`);

  return {
    html: outputText,
    finishReason: candidate.finishReason || 'UNKNOWN',
    promptTokenCount: usageMetadata.promptTokenCount || 0,
    candidatesTokenCount: usageMetadata.candidatesTokenCount || 0,
    totalTokenCount: usageMetadata.totalTokenCount || 0,
  };
}

// ==================== 限制常量 ====================
//
// 【输入上下文窗口】
//   Gemini 2.5 / 3.x 系列均为 1,048,576 token（1M token ≈ 2M 中文字符）
//   安全输入上限 1,600,000 字符（~800K token，预留系统开销 + 输出空间）
//   超过此限制 → 自动将笔记拆分为多批，每批独立调用后合并
//
// 【单次输出上限】
//   maxOutputTokens = 65,536 token ≈ 13 万中文字符
//   如果被 MAX_TOKENS 截断，自动续写（最多续写 4 次，共 5 次调用）
//   总输出容量 = 5 × 65K = 325K token ≈ 65 万中文字符
//
const INPUT_CONTEXT_LIMIT_TOKENS = 1_048_576;  // Gemini 上下文窗口 token 数
const MAX_OUTPUT_TOKENS = 65_536;               // 单次最大输出 token 数
const CHARS_PER_TOKEN_ESTIMATE = 2;             // 中文约 2 字符/token 的粗略估算
const SAFE_INPUT_CHAR_LIMIT = 1_600_000;        // 安全输入上限（~800K token，预留输出空间）

/**
 * 打印 token 使用率统计（粗略估算，基于字符数 / 2）
 */
function logTokenStats(label: string, inputChars: number, outputChars: number) {
  const estInputTokens = Math.round(inputChars / CHARS_PER_TOKEN_ESTIMATE);
  const estOutputTokens = Math.round(outputChars / CHARS_PER_TOKEN_ESTIMATE);
  const inputUtil = ((estInputTokens / INPUT_CONTEXT_LIMIT_TOKENS) * 100).toFixed(1);
  const outputUtil = ((estOutputTokens / MAX_OUTPUT_TOKENS) * 100).toFixed(1);
  console.log(`   📈 [${label}] Token 使用率（估算）:`);
  console.log(`      输入: ~${estInputTokens.toLocaleString()} / ${INPUT_CONTEXT_LIMIT_TOKENS.toLocaleString()} token (${inputUtil}%)`);
  console.log(`      输出: ~${estOutputTokens.toLocaleString()} / ${MAX_OUTPUT_TOKENS.toLocaleString()} token (${outputUtil}%)`);
  if (parseFloat(outputUtil) > 90) {
    console.warn(`      ⚠️ 输出接近上限，可能被截断`);
  }
}

/**
 * 带自动续写的 Gemini 调用（通用）
 *
 * 先调用一次，如果被 MAX_TOKENS 截断，自动续写直到完成或达到上限。
 * 供 Map 阶段和 Reduce 阶段共用。
 */
/**
 * 检测模型输出末尾是否包含"请继续"/"待续"等分批输出标记
 * 返回 true 表示模型希望继续输出
 */
function detectContinuationRequest(text: string): boolean {
  // 取最后 200 字符检测
  const tail = text.slice(-200);
  const patterns = [
    /待续/,
    /请回复.*继续/,
    /回复.*继续/,
    /请.*继续/,
    /\*\*继续\*\*/,
    /下一部分/,
    /接下来/,
    /未完/,
    /to be continued/i,
    /\(续\)/,
    /（续）/,
  ];
  return patterns.some(p => p.test(tail));
}

/**
 * 清理输出末尾的"待续"/"请回复继续"等提示文本
 */
function removeContinuationMarker(text: string): string {
  // 从末尾移除常见的续写提示（可能在最后一行或最后几行）
  const lines = text.split('\n');
  // 从尾部向前检查，最多检查 5 行
  let removeFrom = lines.length;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const line = lines[i].trim();
    if (!line) continue; // 跳过空行
    if (/^[-—*\s]*(待续|请回复.*继续|回复.*继续|如果.*继续|请您.*继续|下一部分|接下来|未完|\*\*继续\*\*|\(续\)|（续）|to be continued)/i.test(line)) {
      removeFrom = i;
    } else {
      break; // 遇到非续写提示行就停止
    }
  }
  if (removeFrom < lines.length) {
    return lines.slice(0, removeFrom).join('\n').trimEnd();
  }
  return text;
}

async function callGeminiWithAutoContinue(
  prompt: string,
  apiKey: string,
  model: string,
  label: string,
  maxContinueCalls: number = 4,
): Promise<{ text: string; totalInputTokens: number; totalOutputTokens: number; callCount: number }> {
  console.log(`   [${label}] 第 1 次调用 (prompt ${prompt.length.toLocaleString()} 字符)...`);
  const result1 = await callGeminiOnce(prompt, apiKey, model);
  logTokenStats(`${label}-1`, prompt.length, result1.html.length);

  let totalInputTokens = result1.promptTokenCount;
  let totalOutputTokens = result1.candidatesTokenCount;
  let combined = result1.html;
  let callCount = 1;
  let lastFinishReason = result1.finishReason;

  // 判断是否需要续写：MAX_TOKENS 截断 或 模型主动请求继续
  const needsContinuation = () => {
    if (lastFinishReason === 'MAX_TOKENS') return true;
    if (lastFinishReason === 'STOP' && detectContinuationRequest(combined)) return true;
    return false;
  };

  while (needsContinuation() && callCount <= maxContinueCalls) {
    const reason = lastFinishReason === 'MAX_TOKENS' ? 'MAX_TOKENS 截断' : '模型请求继续';
    console.log(`   [${label}] ⚠️ 第 ${callCount} 次需续写（${reason}），自动发送"继续"...`);

    // 清理已有内容末尾的"待续"提示
    combined = removeContinuationMarker(combined);

    // 构建多轮对话式续写 prompt（用 Gemini 的 contents 数组模拟对话）
    const continuePrompt = prompt + `\n\n【续写指令】
以下是已经生成的内容（请勿重复）：
---已生成内容开始---
${combined}
---已生成内容结束---

继续。请从上面内容的断点处接续输出，完成剩余内容。不要重复已有内容，不要重复标题。直接从上次停止的地方继续写。

**格式要求（必须严格遵守）**：续写部分必须使用 HTML 格式（h2/h3/p/ul/li/strong/mark/table 标签），与前面已生成的内容保持完全一致的格式。绝对不要切换为 Markdown 格式。`;

    if (continuePrompt.length > 1_800_000) {
      console.warn(`   [${label}] ⚠️ 续写 prompt 已达 ${continuePrompt.length.toLocaleString()} 字符，停止续写`);
      break;
    }

    callCount++;
    console.log(`   [${label}] 第 ${callCount} 次调用 (prompt ${continuePrompt.length.toLocaleString()} 字符)...`);
    const continueResult = await callGeminiOnce(continuePrompt, apiKey, model);
    logTokenStats(`${label}-${callCount}`, continuePrompt.length, continueResult.html.length);

    totalInputTokens += continueResult.promptTokenCount;
    totalOutputTokens += continueResult.candidatesTokenCount;
    combined += '\n' + continueResult.html;
    lastFinishReason = continueResult.finishReason;
  }

  // 最终清理：移除最末尾可能残留的续写提示
  combined = removeContinuationMarker(combined);

  if (lastFinishReason === 'MAX_TOKENS') {
    console.warn(`   [${label}] ⚠️ 已达最大续写次数，输出可能不完整`);
  }

  if (callCount > 1) {
    console.log(`   [${label}] ✅ 完成（${callCount} 次调用, 输出 ${combined.length.toLocaleString()} 字符）`);
  }

  return { text: combined, totalInputTokens, totalOutputTokens, callCount };
}

/**
 * 调用 Gemini 生成周报
 *
 * 自动处理两种超限情况：
 * 1）输入超限 → 自动将笔记拆分为多批，每批独立调用 → 最后合并
 * 2）输出超限 → 单次被 MAX_TOKENS 截断时自动续写（每次调用最多续 4 次）
 *
 * 流程：
 * - prompt ≤ 安全上限 → 直接调用（输出自动续写）
 * - prompt > 安全上限 → 拆分笔记为 N 批 → 每批调用（输出自动续写）→ 合并调用（输出自动续写）
 */
export async function callGeminiForWeeklySummary(
  prompt: string,
  providedApiKey?: string,
  providedModel?: string,
  // 分批模式需要的额外参数
  splitContext?: {
    promptTemplate: string;
    data: WeeklyCollectedData;
    benchmark: BenchmarkData;
    weekStart: Date;
    weekEnd: Date;
    skillContent?: string;
  },
): Promise<{ html: string; tokenStats: TokenStats }> {
  const apiKey = providedApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY 未设置，请在客户端配置或环境变量中设置');
  }

  const model = providedModel || 'gemini-3-flash-preview';

  // ── 判断是否需要分批 ──
  if (prompt.length <= SAFE_INPUT_CHAR_LIMIT || !splitContext) {
    // 单次输入（输出可能自动续写）
    console.log(`📊 调用 ${model} 生成周报 (prompt ${prompt.length.toLocaleString()} 字符, 单次输入)...`);
    const result = await callGeminiWithAutoContinue(prompt, apiKey, model, '周报');
    console.log(`✅ 周报生成成功${result.callCount > 1 ? `（${result.callCount} 次续写）` : '（单次）'}, 总输出: ${result.text.length.toLocaleString()} 字符`);

    const continueCalls = result.callCount - 1; // 第 1 次是正常调用，后续才是续写
    return {
      html: result.text,
      tokenStats: buildTokenStats(
        result.totalInputTokens, result.totalOutputTokens, result.callCount > 1, model,
        1, result.callCount, continueCalls,
      ),
    };
  }

  // ── 分批模式：输入超限 ──
  const { promptTemplate, data, benchmark, weekStart, weekEnd, skillContent: splitSkillContent } = splitContext;
  const totalNotes = data.notes.length;

  // 估算 prompt 中除笔记摘要以外的"开销"部分大小
  const emptyData: WeeklyCollectedData = { ...data, notes: [] };
  const overheadPrompt = buildPrompt(promptTemplate, emptyData, benchmark, weekStart, weekEnd, splitSkillContent);
  const availableCharsPerBatch = SAFE_INPUT_CHAR_LIMIT - overheadPrompt.length - 500; // 500 留给批次标注

  // 计算每篇笔记的大小，分批
  const noteSizes = data.notes.map((note) => {
    const content = getPreferredContent(note.translatedSummary, note.summary);
    return stripHtml(content).length + 200; // 200 for header/meta
  });

  const batches: Array<typeof data.notes> = [];
  let currentBatch: typeof data.notes = [];
  let currentSize = 0;

  for (let i = 0; i < data.notes.length; i++) {
    if (currentSize + noteSizes[i] > availableCharsPerBatch && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(data.notes[i]);
    currentSize += noteSizes[i];
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  console.log(`📊 输入超限 (${prompt.length.toLocaleString()} > ${SAFE_INPUT_CHAR_LIMIT.toLocaleString()} 字符)，拆分 ${totalNotes} 篇笔记为 ${batches.length} 批`);

  // 每批独立调用
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCallCount = 0;
  let totalContinueCalls = 0;
  const batchOutputs: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batchNotes = batches[i];
    const batchData: WeeklyCollectedData = { ...data, notes: batchNotes };
    const batchPrompt = buildPrompt(promptTemplate, batchData, benchmark, weekStart, weekEnd, splitSkillContent);

    const annotation = `\n\n【注意：这是第 ${i + 1}/${batches.length} 批笔记（共 ${totalNotes} 篇，本批 ${batchNotes.length} 篇）。请基于本批笔记内容生成周报各章节。】`;
    const annotatedPrompt = batchPrompt + annotation;

    console.log(`   📦 第 ${i + 1}/${batches.length} 批: ${batchNotes.length} 篇笔记, prompt ${annotatedPrompt.length.toLocaleString()} 字符`);
    const result = await callGeminiWithAutoContinue(annotatedPrompt, apiKey, model, `批${i + 1}`);

    totalInputTokens += result.totalInputTokens;
    totalOutputTokens += result.totalOutputTokens;
    totalCallCount += result.callCount;
    totalContinueCalls += (result.callCount - 1);
    batchOutputs.push(result.text);
  }

  // 合并各批结果
  console.log(`   🔗 合并 ${batches.length} 批结果...`);
  const mergePrompt = `你是一位专业的金融研究助理。以下是对同一周笔记分批生成的周报内容（因笔记数量过多，分 ${batches.length} 批处理）。

请将这些批次的内容合并成一份完整、结构清晰的周报，要求：
- 去除重复信息，保留所有关键内容
- 按照原始周报格式输出（HTML格式，使用 h2/h3/p/ul/li/strong/mark 标签）
- 信息来自不同批次的要合理整合到对应章节
- 保留所有 [REF] 引用标注

${batchOutputs.map((output, i) => `=== 第 ${i + 1}/${batches.length} 批结果 ===\n${output}`).join('\n\n')}

请输出合并后的完整周报（HTML格式）：`;

  const mergeResult = await callGeminiWithAutoContinue(mergePrompt, apiKey, model, '合并');
  totalInputTokens += mergeResult.totalInputTokens;
  totalOutputTokens += mergeResult.totalOutputTokens;
  totalCallCount += mergeResult.callCount;
  totalContinueCalls += (mergeResult.callCount - 1);

  console.log(`✅ 周报生成成功（${batches.length} 批 + 合并, 共 ${totalCallCount} 次调用, 续写 ${totalContinueCalls} 次）, 总输出: ${mergeResult.text.length.toLocaleString()} 字符`);

  return {
    html: mergeResult.text,
    tokenStats: buildTokenStats(
      totalInputTokens, totalOutputTokens, true, model,
      batches.length, totalCallCount, totalContinueCalls,
    ),
  };
}

/** 构建 TokenStats 对象 */
function buildTokenStats(
  inputTokens: number, outputTokens: number, segmented: boolean, model: string,
  batchCount: number, totalCalls: number, continueCalls: number,
): TokenStats {
  return {
    inputTokens,
    outputTokens,
    inputLimit: INPUT_CONTEXT_LIMIT_TOKENS,
    outputLimit: MAX_OUTPUT_TOKENS,
    inputUtilization: parseFloat(((inputTokens / INPUT_CONTEXT_LIMIT_TOKENS) * 100).toFixed(1)),
    outputUtilization: parseFloat(((outputTokens / MAX_OUTPUT_TOKENS) * 100).toFixed(1)),
    segmented,
    model,
    batchCount,
    totalCalls,
    continueCalls,
  };
}

/**
 * 主函数：生成周度总结
 */
export async function generateWeeklySummary(
  userId: string,
  weekStartStr?: string,
  customPrompt?: string,
  geminiApiKey?: string,
  weeklySummaryModel?: string,
  weekEndStr?: string,
): Promise<WeeklySummaryResult> {
  // 1. 计算周边界（支持自定义结束日期）
  const { weekStart, weekEnd } = weekEndStr
    ? { weekStart: (() => { const d = new Date(weekStartStr || new Date()); d.setHours(0,0,0,0); return d; })(), weekEnd: (() => { const d = new Date(weekEndStr); d.setHours(23,59,59,999); return d; })() }
    : getWeekBoundaries(weekStartStr);
  console.log(`📅 生成周报: ${weekStart.toISOString()} ~ ${weekEnd.toISOString()}`);

  // 2. 收集数据
  const data = await collectWeeklyData(userId, weekStart, weekEnd);
  console.log(`📝 收集到 ${data.notes.length} 篇笔记，${data.highlights.length} 条高亮`);

  if (data.notes.length === 0) {
    throw new Error('该周没有找到任何笔记，无法生成周报');
  }

  // 3. 生成 Benchmark
  const benchmark = await generateBenchmark(userId, data.metadata, data.notes.length, weekStart);
  console.log(`📊 Benchmark: 新增公司 ${benchmark.newCompanies.length}, 持续关注 ${benchmark.recurringCompanies.length}`);

  // 4. 读取用户的周报设置（Skill + 自定义 Prompts）
  const settings = await prisma.portfolioSettings.findUnique({
    where: { userId },
    select: { weeklySkillContent: true, weeklyUserPrompt: true, weeklySystemPrompt: true },
  });
  const skillContent = settings?.weeklySkillContent || '';

  // 5. 构建 Prompt
  // 优先级：前端传入的 customPrompt > DB 保存的 userPrompt > 默认值
  let promptTemplate: string;
  if (customPrompt && customPrompt.trim()) {
    promptTemplate = customPrompt;
  } else if (settings?.weeklyUserPrompt) {
    promptTemplate = settings.weeklyUserPrompt;
  } else {
    promptTemplate = skillContent ? DEFAULT_WEEKLY_USER_PROMPT_WITH_SKILL : DEFAULT_WEEKLY_USER_PROMPT;
  }
  const fullPrompt = buildPrompt(promptTemplate, data, benchmark, weekStart, weekEnd, skillContent);

  // ── 调用 AI 生成周报 ──
  //
  // 自动处理两种情况：
  // 1）输入 ≤ 1.6M 字符 → 直接单次调用（输出超限自动续写）
  // 2）输入 > 1.6M 字符 → 自动拆分笔记为多批 → 每批独立调用 → 合并结果
  //
  console.log(`   prompt ${fullPrompt.length.toLocaleString()} 字符 (限制 ${SAFE_INPUT_CHAR_LIMIT.toLocaleString()})`);
  const { html: summaryHtml, tokenStats } = await callGeminiForWeeklySummary(
    fullPrompt,
    geminiApiKey,
    weeklySummaryModel,
    // 传入原始数据，以便超限时自动拆分笔记重新构建 prompt
    { promptTemplate, data, benchmark, weekStart, weekEnd, skillContent },
  );

  return {
    summaryHtml,
    highlights: data.highlights,
    benchmark,
    metadata: data.metadata,
    sources: data.notes.map(n => ({ id: n.id, title: n.fileName })),
    customPrompt: promptTemplate,
    tokenStats,
  };
}
