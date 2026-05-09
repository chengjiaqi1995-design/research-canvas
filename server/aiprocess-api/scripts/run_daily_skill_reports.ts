import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import prisma from '../src/utils/db';

const userId = '104921709359061938941';
const dateStr = process.argv[2] || '2026-05-08';
const bucketName = 'gen-lang-client-0634831802-uploads-asia';
const outDir = path.resolve(__dirname, '../../../tmp/scheduled-reports');

function sgtDateRange(date: string) {
  const start = new Date(`${date}T00:00:00.000+08:00`);
  const end = new Date(`${date}T23:59:59.999+08:00`);
  return { start, end };
}

function stripHtml(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function preferred(note: any) {
  return stripHtml(note.translatedSummary || note.summary || note.transcriptText || '');
}

function noteBlock(note: any, index: number) {
  return `### [REF${index + 1}] ${note.fileName}
- id: ${note.id}
- industry: ${note.industry || '未分类'}
- organization: ${note.organization || 'N/A'}
- createdAt: ${note.createdAt?.toISOString?.() || note.createdAt}

${preferred(note)}`;
}

function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadSettings() {
  const storage = new Storage();
  const [content] = await storage.bucket(bucketName).file(`${userId}/settings/ai.json`).download();
  return JSON.parse(content.toString());
}

async function callGemini(prompt: string, apiKey: string, model: string, label: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 65536,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${label} Gemini ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];
  let text = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i]?.text && !parts[i]?.thought) {
      text = parts[i].text;
      break;
    }
  }
  if (!text) text = parts.map((p: any) => p.text || '').join('\n');
  text = text.trim().replace(/^```(?:html)?\s*/i, '').replace(/```$/i, '').trim();
  const body = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.trim();
  if (body) text = body;
  return {
    text,
    usage: data.usageMetadata || {},
    finishReason: data?.candidates?.[0]?.finishReason || 'UNKNOWN',
  };
}

async function generateDetailedWeeklyBody(params: {
  notes: any[];
  skillContent: string;
  apiKey: string;
  model: string;
  dateStr: string;
}) {
  const { notes, skillContent, apiKey, model, dateStr } = params;
  const groups = [
    { name: 'AI、智能体与创作者工具（=）', refs: [1, 2, 3] },
    { name: '能源安全、美国制造业与宏观产业政策（=）', refs: [4, 5] },
    { name: 'AI算力基础设施、电力设备与储能（+）', refs: [6, 7, 9, 11, 12, 14, 17] },
    { name: '汽车、锂电与新能源零部件（=）', refs: [8, 10, 16, 18] },
    { name: 'PCB铜箔、SOFC与光伏/泛半导体设备（+）', refs: [13, 15] },
    { name: '碳化硅与固态变压器远期链条（+）', refs: [19, 20] },
  ];

  const topdownPrompt = `你正在为 Research Canvas 生成投资研究日报的 Topdown。资料范围是 ${dateStr} 00:00-23:59 SGT。

【硬约束】
- 严格执行下面 Research Canvas skill 的信息筛选标准。
- 只输出 HTML 片段：<section><h2>Topdown</h2><ol>...</ol></section>。
- 输出 5-7 条跨行业主题，每条都要说明变化、数字、影响路径，并带独立引用 [REFn]。
- 不要写参考文献/来源列表。
- 不要写“本周”，统一写“本日/当日”。
- 引用必须独立写 [REF1] [REF2]，禁止 [REF1, REF2]。

【Research Canvas Skill 原文】
${skillContent}

【Source Pack】
${notes.map((n, i) => noteBlock(n, i)).join('\n\n---\n\n')}`;

  const topdown = normalizeBody((await callGemini(topdownPrompt, apiKey, model, 'weekly-topdown')).text);
  const sections = [topdown];

  for (const group of groups) {
    const groupNotes = group.refs
      .map((ref) => ({ ref, note: notes[ref - 1] }))
      .filter((x) => x.note);
    if (!groupNotes.length) continue;
    const prompt = `你正在为 Research Canvas 生成投资研究日报的一个行业分段。资料范围是 ${dateStr} 00:00-23:59 SGT。

【本段标题】
${group.name}

【硬约束】
- 严格执行 Research Canvas skill：只纳入价格变化、成本曲线差距变化、技术变化、政策变化，以及与这些变化直接相关的订单/产能/毛利/交期/客户/产品节奏。
- 输出 HTML 片段：<section><h2>### ${group.name}</h2>...内容...</section>。
- 必须详细：本段每份 note 至少提取 4-8 条有信息量的 bullet；如果材料很丰富，可以更多。
- 一个公司/主题的多条数字、订单、技术节点、毛利率、交期、政策条件要拆开写，不要合并成一句。
- 每个事实 bullet 末尾必须带独立引用 [REFn]。
- 不要写交易建议、买卖建议、仓位建议。
- 不要写参考文献/来源列表。
- 不要写“本周”，统一写“本日/当日”。
- 引用必须独立写 [REF1] [REF2]，禁止 [REF1, REF2]。

【Research Canvas Skill 原文】
${skillContent}

【本段 Source Notes】
${groupNotes.map((x) => noteBlock(x.note, x.ref - 1)).join('\n\n---\n\n')}`;
    const section = normalizeBody((await callGemini(prompt, apiKey, model, `weekly-section-${group.refs.join('-')}`)).text);
    sections.push(section);
    console.log(JSON.stringify({
      key: 'weekly-section',
      group: group.name,
      refs: group.refs,
      bodyChars: section.length,
      refCount: [...section.matchAll(/\[REF\d+\]/g)].length,
    }, null, 2));
  }

  const implicationsPrompt = `你正在为 Research Canvas 投资研究日报生成收尾部分。资料范围是 ${dateStr} 00:00-23:59 SGT。

【硬约束】
- 只输出两个 HTML section：
  <section><h2>推演：基于本日变化的影响推导</h2>...</section>
  <section><h2>后续重点关注</h2>...</section>
- 推演必须分为“变好的”和“变差的”，每条写完整因果链：谁 -> 本日什么变化 -> 通过什么路径 -> 基本面怎么变化。
- 后续关注必须写“观察什么 + 为什么重要 + 时间窗口”。
- 每条都带独立引用 [REFn]。
- 不要写参考文献/来源列表。
- 不要写“本周”，统一写“本日/当日”。
- 引用必须独立写 [REF1] [REF2]，禁止 [REF1, REF2]。

【Research Canvas Skill 原文】
${skillContent}

【已生成正文分段】
${sections.join('\n\n')}`;
  const implications = normalizeBody((await callGemini(implicationsPrompt, apiKey, model, 'weekly-implications')).text);
  sections.push(implications);

  return normalizeBody(sections.join('\n\n'));
}

function htmlDocument(title: string, body: string, subtitle: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#d8e0ea;--panel:#fff;--soft:#f7f9fc;--blue:#175cd3;--green:#087443;--amber:#b54708;--red:#b42318;--violet:#6941c6;--shadow:0 14px 32px rgba(16,24,40,.08)}*{box-sizing:border-box}body{margin:0;background:#edf2f7;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;line-height:1.68}.page{max-width:1180px;margin:0 auto;padding:30px 22px 56px}header,section{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}header{padding:28px 32px}section{margin-top:18px;padding:24px 28px;box-shadow:0 8px 20px rgba(16,24,40,.05)}h1{margin:0 0 10px;font-size:28px;line-height:1.25;letter-spacing:0}h2{margin:0 0 14px;font-size:20px;line-height:1.35;letter-spacing:0}h3{margin:18px 0 8px;font-size:16px}p{margin:8px 0}.subtitle,.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;margin:14px 0 4px;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:10px 9px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#344054;font-size:12px;font-weight:750}ul,ol{margin:8px 0 0 20px;padding:0}li{margin:6px 0}strong{font-weight:750}.ref-link{color:var(--blue);text-decoration:none;font-weight:700;margin:0 2px}.badge{display:inline-flex;padding:2px 7px;border-radius:6px;font-size:12px;font-weight:750;white-space:nowrap}.pos{background:#ecfdf3;color:var(--green)}.neg{background:#fee4e2;color:var(--red)}.neu{background:#f2f4f7;color:#475467}@media(max-width:820px){.page{padding:18px 12px 36px}header,section{padding:18px 16px}table{font-size:12px}th,td{padding:8px 6px}h1{font-size:23px}}
</style>
</head>
<body><main class="page">
<header><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p></header>
${body}
</main></body></html>
`;
}

function normalizeBody(html: string) {
  return normalizeDailyLanguage(normalizeCitations(html))
    .trim()
    .replace(/<h1[\s\S]*?<\/h1>/i, '')
    .replace(/<h2>\s*(参考文献|来源列表|本轮来源索引|Sources|References)[\s\S]*$/i, '')
    .trim();
}

function normalizeCitations(html: string) {
  return html.replace(/\[(?:\s*REF\s*\d+\s*[,，、;；/]\s*)+REF\s*\d+\s*\]/gi, (match) => {
    const nums = [...match.matchAll(/REF\s*(\d+)/gi)].map((m) => Number(m[1]));
    return nums.map((n) => `[REF${n}]`).join(' ');
  });
}

function normalizeDailyLanguage(html: string) {
  return html
    .replace(/本周/g, '本日')
    .replace(/周报/g, '日报');
}

function buildPrompt(params: {
  title: string;
  periodLabel: string;
  sourcePack: string;
  skillName: string;
  skillContent: string;
  mode: 'rc1' | 'weekly';
}) {
  const { title, periodLabel, sourcePack, skillName, skillContent, mode } = params;
  const dailyAdaptation = mode === 'rc1'
    ? '把 skill 的变化发现能力用于日度资料窗口。严格保持“变化发现”skill 的极简纪律：只列高/中重要度变化信号；每条变化一行；不写长段解释；不解释七大分类；最后只给因果链和2-3句总结。'
    : '虽然 skill 名称是周报，本次按日度资料窗口生成。结构仍保留 Topdown、分行业、推演、后续关注，但所有措辞必须用当日/本日，不要写成本周；输出必须充分展开。';

  const modeSpecificRules = mode === 'rc1'
    ? `【RC1 输出结构，必须遵守】
<section>
  <h2>高优先级变化</h2>
  <table><thead><tr><th>重要度</th><th>变化类型</th><th>变化内容</th><th>影响方向</th><th>引用</th></tr></thead><tbody>...</tbody></table>
</section>
<section>
  <h2>中优先级变化</h2>
  <table>...</table>
</section>
<section>
  <h2>因果链与矛盾信号</h2>
  <ul>...</ul>
  <p>2-3句总结。</p>
</section>

- 每条变化只能占一行，但必须保留关键数字、时间、价格、产能、订单、交期、毛利率等。
- 不要输出“核心主题”“行业展开”“投资观点”等长段分析。`
    : `【周报skill 日度版输出结构，必须遵守】
<section><h2>Topdown</h2><ol>...</ol></section>
<section><h2>### [行业名]（+/-/=）</h2>...</section>
<section><h2>推演：基于本日变化的影响推导</h2>...</section>
<section><h2>后续重点关注</h2>...</section>

- 必须覆盖所有触及价格变化、成本曲线差距变化、技术变化、政策变化的材料。
- 20条 notes 的输入，目标不少于100条事实 bullet；一个公司/主题有多条信息就拆成多条 bullet。
- 具体数字不能省略，不能把多个事实压缩成一句泛泛判断。
- 不要写“继续”，直接尽量完整输出。`;

  return `你正在为 Research Canvas 信息流生成 HTML 报告。必须严格按用户在 Research Canvas 中保存的 skill 执行。

【本次任务】
- 报告标题：${title}
- 时间范围：${periodLabel}
- 输入材料：下面 Source Pack 中同一批 Research Canvas notes。
- 使用 Skill：${skillName}
- 输出：只输出 HTML 片段，不要完整 html/head/body，不要 Markdown。

【硬约束，违反即失败】
1. 严格按 Skill 内容筛选和组织，不要自创另一个报告框架。
2. 报告必须非常详细；20条 notes 也要尽量展开，保留具体数字、时间、价格、成本、capex、订单、利用率、政策条款、公司/行业影响路径。
3. 正文里每个事实点都要带 [REFn]，引用必须独立：正确 [REF1] [REF2]，错误 [REF1, REF2] 或 [1]。
4. 不要在文末输出参考文献、来源列表、本轮来源索引、bibliography。用户会点击正文引用打开原文。
5. 不要输出交易建议、买卖建议、仓位建议。只做事实、变化、基本面推演。
6. 使用简体中文。
7. HTML 只用 h2/h3/p/ul/ol/li/strong/table/thead/tbody/tr/th/td/span 标签。
8. 不要使用“本周”，本次资料范围是日度；统一使用“本日/当日”。

【日报口径适配】
${dailyAdaptation}

${modeSpecificRules}

【Research Canvas Skill 原文】
${skillContent}

【Source Pack】
${sourcePack}
`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const settings = await loadSettings();
  const apiKey = settings.keys?.google;
  const model = settings.apiConfig?.mergeSkillModel || settings.apiConfig?.weeklySummaryModel || settings.defaultModel || 'gemini-3-flash-preview';
  if (!apiKey) throw new Error('missing google key from Research Canvas AI settings');

  const skills = settings.skills || [];
  const rcSkill = skills.find((s: any) => s.name === '发现变化 = 周报视角2');
  const weeklySkill = skills.find((s: any) => s.name === '周报skill');
  if (!rcSkill || !weeklySkill) throw new Error('required Research Canvas skills not found');

  const { start, end } = sgtDateRange(dateStr);
  const notes = await prisma.transcription.findMany({
    where: {
      userId,
      status: 'completed',
      createdAt: { gte: start, lte: end },
      type: { notIn: ['weekly-summary', 'daily-summary'] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fileName: true,
      summary: true,
      translatedSummary: true,
      transcriptText: true,
      industry: true,
      organization: true,
      topic: true,
      createdAt: true,
      actualDate: true,
      tags: true,
      type: true,
    },
  });
  if (!notes.length) throw new Error(`no notes found for ${dateStr}`);

  const sourceIndex = notes.map((n: any, i: number) => {
    const text = preferred(n);
    return {
      ref: `REF${i + 1}`,
      id: n.id,
      title: n.fileName,
      industry: n.industry || '未分类',
      org: n.organization || '',
      createdAt: n.createdAt?.toISOString?.() || String(n.createdAt),
      chars: text.length,
    };
  });
  const references = notes.map((n: any, i: number) => ({
    refNumber: i + 1,
    ref: `REF${i + 1}`,
    id: n.id,
    title: n.fileName,
    fileName: n.fileName,
    summary: '',
    translatedSummary: '',
    industry: n.industry || '',
    organization: n.organization || '',
    date: n.createdAt?.toISOString?.() || String(n.createdAt),
    sourceType: 'aiprocess-transcription',
    canvasId: '',
    workspaceId: '',
    workspaceName: '',
  }));

  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.industry || '未分类', (counts.get(n.industry || '未分类') || 0) + 1);
  const countLines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const sourcePack = `# Source Pack

Range: ${dateStr} 00:00:00 to ${dateStr} 23:59:59 by createdAt (Asia/Singapore)
Count: ${notes.length}
Primary Skill: RC1 发现变化 = 周报视角2
Second Skill: 周报skill

## Industry Counts
${countLines}

## Notes

${notes.map((n: any, i: number) => noteBlock(n, i)).join('\n\n---\n\n')}
`;

  const prefix = path.join(outDir, `daily-${dateStr}`);
  fs.writeFileSync(`${prefix}.source-pack.md`, sourcePack);
  fs.writeFileSync(`${prefix}.source-index.json`, JSON.stringify(sourceIndex, null, 2));
  fs.writeFileSync(`${prefix}.references.json`, JSON.stringify(references, null, 2));
  fs.writeFileSync(`${prefix}.rc1-skill.md`, rcSkill.content || '');
  fs.writeFileSync(`${prefix}.weekly-skill.md`, weeklySkill.content || '');

  const jobs = [
    {
      key: 'rc1' as const,
      skill: rcSkill,
      title: `${dateStr} 变化信号日报（RC1）`,
      subtitle: `按 Research Canvas notes 的 createdAt 筛选 ${dateStr}，使用 Canvas Skill「发现变化 = 周报视角2」生成。`,
      source: 'codex-daily-rc1-skill',
    },
    {
      key: 'weekly-skill' as const,
      skill: weeklySkill,
      title: `${dateStr} 投资研究日报（周报skill·同批输入）`,
      subtitle: `与 RC1 日报完全相同的 ${notes.length} 条输入，使用 Canvas Skill「周报skill」生成。`,
      source: 'codex-daily-weekly-skill',
    },
  ];

  const outputs = [];
  for (const job of jobs) {
    console.log(`Generating ${job.key} with ${model}, notes=${notes.length}, sourcePackChars=${sourcePack.length}`);
    const prompt = buildPrompt({
      title: job.title,
      periodLabel: `${dateStr} 00:00-23:59 SGT`,
      sourcePack,
      skillName: job.skill.name,
      skillContent: job.skill.content || '',
      mode: job.key === 'rc1' ? 'rc1' : 'weekly',
    });
    const result = job.key === 'weekly-skill'
      ? {
          text: await generateDetailedWeeklyBody({
            notes,
            skillContent: job.skill.content || '',
            apiKey,
            model,
            dateStr,
          }),
          usage: {},
          finishReason: 'SECTIONED',
        }
      : await callGemini(prompt, apiKey, model, job.key);
    const body = normalizeBody(result.text);
    const html = htmlDocument(job.title, body, job.subtitle);
    const htmlPath = `${prefix}.${job.key}.html`;
    fs.writeFileSync(htmlPath, html);
    fs.writeFileSync(`${prefix}.${job.key}.generation.json`, JSON.stringify({
      model,
      finishReason: result.finishReason,
      usage: result.usage,
      htmlPath,
      htmlBytes: Buffer.byteLength(html),
      bodyChars: body.length,
      noteCount: notes.length,
    }, null, 2));
    outputs.push({
      key: job.key,
      title: job.title,
      source: job.source,
      htmlPath,
      htmlBytes: Buffer.byteLength(html),
      bodyChars: body.length,
      usage: result.usage,
    });
    console.log(JSON.stringify(outputs[outputs.length - 1], null, 2));
  }

  console.log(JSON.stringify({
    dateStr,
    noteCount: notes.length,
    sourcePackChars: sourcePack.length,
    referencesPath: `${prefix}.references.json`,
    outputs,
  }, null, 2));
}

main().finally(async () => prisma.$disconnect());
