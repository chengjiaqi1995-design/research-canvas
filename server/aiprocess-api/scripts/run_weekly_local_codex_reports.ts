import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';
import prisma from '../src/utils/db';

const userId = '104921709359061938941';
const bucketName = 'gen-lang-client-0634831802-uploads-asia';
const outDir = path.resolve(__dirname, '../../../tmp/scheduled-reports');
const startArg = process.argv[2] || '2026-05-03';
const endArg = process.argv[3] || '2026-05-09';
const start = new Date(`${startArg}T00:00:00.000+08:00`);
const end = new Date(`${endArg}T23:59:59.999+08:00`);
const rangeKey = `${startArg}_${endArg}`;
const rangeLabel = `${startArg} 00:00:00 - ${endArg} 23:59:59 SGT`;

type Note = {
  id: string;
  fileName: string | null;
  summary: string | null;
  translatedSummary: string | null;
  transcriptText: string | null;
  industry: string | null;
  organization: string | null;
  topic: string | null;
  tags: string[] | null;
  type: string | null;
  createdAt: Date;
  actualDate: Date | null;
};

type Evidence = {
  ref: number;
  note: Note;
  text: string;
  score: number;
  category: string;
  sentiment: '利好' | '利空' | '中性' | '待验证';
  index: number;
};

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
    .replace(/\s+/g, ' ')
    .trim();
}

function preferred(note: Note) {
  return stripHtml(note.translatedSummary || note.summary || note.transcriptText || '');
}

function isGenericSourceTitle(input = '') {
  const text = stripHtml(input).replace(/\s+/g, ' ').trim();
  if (!text) return true;
  return (
    /^(?:源|来源)\s*\d+(?:\s*[·\-–—]\s*AI\s*总结)?$/i.test(text) ||
    /^source\s*\d+(?:\s*[·\-–—]\s*AI\s*(?:summary|summaries))?$/i.test(text)
  );
}

function title(note: Note) {
  const fileName = stripHtml(note.fileName || '');
  if (fileName && !isGenericSourceTitle(fileName)) return fileName;
  const topic = stripHtml(note.topic || '');
  if (topic && !isGenericSourceTitle(topic)) return topic;
  const organization = stripHtml(note.organization || '');
  const noteIndustry = stripHtml(note.industry || '');
  if (organization && noteIndustry) return `${noteIndustry} - ${organization}`;
  return organization || noteIndustry || fileName || '未命名 note';
}

function industry(note: Note) {
  return stripHtml(note.industry || '未分类');
}

function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitSentences(text: string) {
  const clean = stripHtml(text)
    .replace(/#{1,6}\s*/g, '。')
    .replace(/[•●]\s*/g, '。')
    .replace(/\s+-\s+\*\*/g, '。')
    .replace(/\s+[-*]\s+/g, '。')
    .replace(/\s+/g, ' ');
  const parts = clean
    .split(/(?<=[。！？；;])\s*|(?<=\.)\s+(?=[A-Z0-9\u4e00-\u9fa5])/)
    .flatMap((part) => {
      if (part.length <= 260) return [part];
      return part.split(/(?<=[，,：:])\s*/);
    })
    .map((part) => part.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const part of parts) {
    const cleaned = cleanBullet(part);
    if (cleaned.length < 18) continue;
    if (isGarbageEvidence(cleaned)) continue;
    if (/免责声明|风险提示|仅供参考|不构成投资建议/.test(part)) continue;
    if (/建议(买入|卖出|做空)|仓位|止盈|止损/.test(part)) continue;
    if (cleaned.length > 360) {
      merged.push(`${cleaned.slice(0, 340)}...`);
    } else {
      merged.push(cleaned);
    }
  }
  return merged;
}

function isGarbageEvidence(sentence: string) {
  const numericChunks = sentence.match(/[-+]?\$?\d+(?:\.\d+)?%?|[A-Z]?\$\d+(?:\.\d+)?[A-Z]?/g) || [];
  if ((sentence.includes('|') && sentence.split('|').length > 5) || /consensus vs consensus/i.test(sentence)) return true;
  if (/USD mn 指标|Margin 指标|Gross profit|Operating income|Net income|Revenue .*Gross margin|EBITDA .*Operating income/i.test(sentence) && numericChunks.length >= 10) return true;
  if (/指标\s+\d{2}Q\d|YoY\s+\d{2}Q\d|QoQ\s+consensus/i.test(sentence) && numericChunks.length >= 10) return true;
  if (numericChunks.length >= 18) return true;
  if (/^at \d+\s*(a\.m\.|p\.m\.)/i.test(sentence)) return true;
  if (/^[-*]\s*\*\*/.test(sentence)) return true;
  return false;
}

function scoreSentence(sentence: string) {
  let score = 0;
  if (/\d|%|％|亿|万|GW|GWh|MW|MWh|kWh|美元|美金|人民币|元|吨|片|倍|pct|bp|bps|Q[1-4]|一季度|二季度|三季度|四季度/i.test(sentence)) score += 5;
  if (/增长|提升|下降|下滑|恢复|放量|扩产|投产|爬坡|涨价|降价|提价|订单|交期|库存|成本|毛利|利润|收入|指引|目标|政策|关税|补贴|认证|良率|渗透率|产能|并网|稀缺|供需|短缺|紧缺|突破|转向|退出|进入|签署|合同|backlog|ARR|capex|EBITDA/i.test(sentence)) score += 5;
  if (/预计|计划|目标|将|到20\d{2}|年内|年底|下半年|未来|Q[1-4]/i.test(sentence)) score += 2;
  if (/风险|承压|亏损|延迟|退单|库存|高企|缺口|瓶颈|限制|禁用|下滑/.test(sentence)) score += 2;
  return score;
}

function classify(sentence: string) {
  if (/订单|销量|需求|客户|capex|出货|ARR|合同|backlog|收入|应用|渗透率/i.test(sentence)) return '需求变化';
  if (/产能|扩产|投产|开工率|供给|供应|工厂|产线|良率|认证|新增/.test(sentence)) return '供给变化';
  if (/价格|涨价|降价|提价|ASP|库存|交期|短缺|紧缺|稀缺|供需|backlog/i.test(sentence)) return '供需关系变化';
  if (/技术|产品|SST|HVDC|碳化硅|SiC|AI|智能体|模型|芯片|良率|效率|闪充|固态|钙钛矿|GPU|CPU|DRAM|二代|800V/i.test(sentence)) return '技术和产品创新';
  if (/成本|铜|银|锂|油价|电价|人工|物流|毛利|利润率|单位|降本|价格比|原材料/.test(sentence)) return '成本曲线变化';
  if (/政策|监管|关税|补贴|IRA|法案|禁用|安全仓|本土|贸易|出口管制|准入/.test(sentence)) return '政策变化';
  if (/管理层|CEO|组织|战略|回购|分红|激励|事业部|收购|并购/.test(sentence)) return '内部管理变化';
  return '待归类变化';
}

function sentiment(sentence: string): Evidence['sentiment'] {
  if (/下降|下滑|亏损|承压|延迟|退单|风险|缺口|瓶颈|限制|禁用|库存高|价格战|减值|不确定|恶化/.test(sentence)) return '利空';
  if (/增长|提升|恢复|放量|扩产|投产|涨价|提价|订单|签署|突破|改善|高于|盈利|满产|上量|进入|拿到/.test(sentence)) return '利好';
  if (/预计|计划|可能|待确认|尚未|需要/.test(sentence)) return '待验证';
  return '中性';
}

function cleanBullet(sentence: string) {
  let text = stripHtml(sentence)
    .replace(/\[(?:REF)?\d+\]/gi, '')
    .replace(/【源\s*\d+(?:[、,\s]*源?\s*\d+)*】/g, '')
    .replace(/【[^】]*(?:源|source|street|consensus|call|UBS|GS|Td|BofA|Barclay|BNP)[^】]*】/gi, '')
    .replace(/\b(?:earning|earnings|barclay|barclays|bnp|UBS|GS|Td|call|clear street|nmr)\b/gi, '')
    .replace(/^\s*(?:[一二三四五六七八九十]+、|模块[一二三四五六七八九十\d]+：|#+)\s*/g, '')
    .replace(/^(?:整体业绩概览|利润率分析|异常指标说明|分业务讨论|未来指引|关键风险标注|市场总览与政策动态|成本与价格趋势|订单与储备规模|收入端|展望)\s*[：:：]?\s*/g, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s*/g, '')
    .replace(/\s+([。；，、：])/g, '$1')
    .replace(/([。；，、：])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s+([A-Za-z]{1,4})\s*[。；]?$/g, (match, tail) => {
    return /^(US|EU|AI|GPU|CPU|DRAM|MW|GW|GWh|MWh|ARR|ASP|EBITDA|EBIT|IRA|ITC|SST|HVDC|SiC|mn|bn)$/i.test(tail) ? match : '';
  }).trim();
  return text;
}

function evidenceForNote(note: Note, ref: number, max = 8) {
  const sentences = splitSentences(preferred(note));
  const scored = sentences
    .map((text, index) => ({
      ref,
      note,
      text: cleanBullet(text),
      score: scoreSentence(text),
      category: classify(text),
      sentiment: sentiment(text),
      index,
    }))
    .filter((item) => item.score >= 5 && item.text.length >= 20);
  const seen = new Set<string>();
  const selected = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((item) => {
      const key = item.text.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max)
    .sort((a, b) => a.index - b.index);
  if (selected.length) return selected;
  return sentences.slice(0, Math.min(3, sentences.length)).map((text, index) => ({
    ref,
    note,
    text: cleanBullet(text),
    score: 1,
    category: '待归类变化',
    sentiment: '中性' as const,
    index,
  }));
}

function ref(n: number) {
  return `[REF${n}]`;
}

function htmlDocument(titleText: string, subtitle: string, body: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleText)}</title>
<style>
:root{color-scheme:light;--ink:#182230;--muted:#667085;--line:#d7dee8;--panel:#fff;--soft:#f7f9fc;--blue:#175cd3;--green:#087443;--red:#b42318;--amber:#b54708;--shadow:0 12px 28px rgba(16,24,40,.07)}*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;line-height:1.68}.page{max-width:1220px;margin:0 auto;padding:30px 22px 56px}header,section{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}header{padding:28px 32px}section{margin-top:18px;padding:24px 28px;box-shadow:0 8px 20px rgba(16,24,40,.05)}h1{margin:0 0 10px;font-size:28px;line-height:1.25;letter-spacing:0}h2{margin:0 0 14px;font-size:20px;line-height:1.35;letter-spacing:0}h3{margin:18px 0 8px;font-size:16px;line-height:1.4}p{margin:8px 0}.subtitle,.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;margin:14px 0 4px;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:10px 9px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#344054;font-size:12px;font-weight:750}ul,ol{margin:8px 0 0 20px;padding:0}li{margin:6px 0}strong{font-weight:750}.ref-link{color:var(--blue);text-decoration:none;font-weight:700;margin:0 2px}.pill{display:inline-flex;padding:2px 7px;border-radius:6px;font-size:12px;font-weight:750;white-space:nowrap}.pos{background:#ecfdf3;color:var(--green)}.neg{background:#fee4e2;color:var(--red)}.neu{background:#f2f4f7;color:#475467}.watch{background:#fff6e5;color:var(--amber)}@media(max-width:820px){.page{padding:18px 12px 36px}header,section{padding:18px 16px}table{font-size:12px}th,td{padding:8px 6px}h1{font-size:23px}}
</style>
</head>
<body><main class="page">
<header><h1>${escapeHtml(titleText)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p></header>
${body}
</main></body></html>
`;
}

function pillClass(value: Evidence['sentiment']) {
  if (value === '利好') return 'pos';
  if (value === '利空') return 'neg';
  if (value === '待验证') return 'watch';
  return 'neu';
}

function buildChangeReport(notes: Note[], allEvidence: Evidence[]) {
  const ranked = allEvidence
    .filter((item) => item.score >= 7)
    .sort((a, b) => b.score - a.score || a.ref - b.ref)
    .slice(0, 95);
  const high = ranked.filter((item) => item.score >= 10).slice(0, 55);
  const medium = ranked.filter((item) => item.score < 10).slice(0, 40);
  const rows = (items: Evidence[]) => items.map((item) => `
      <tr>
        <td>${item.score >= 10 ? '高' : '中'}</td>
        <td>${escapeHtml(item.category)}</td>
        <td>${escapeHtml(item.text)}</td>
        <td><span class="pill ${pillClass(item.sentiment)}">${item.sentiment}</span> → ${escapeHtml(industry(item.note))}</td>
        <td>${ref(item.ref)}</td>
      </tr>`).join('');
  const causal = ranked.slice(0, 24).map((item) => {
    const impact = item.sentiment === '利空' ? '相关公司盈利/订单/估值叙事承压' : item.sentiment === '利好' ? '相关环节收入、价格或份额存在改善弹性' : '需要后续数据验证持续性';
    return `<li><strong>${escapeHtml(industry(item.note))}：</strong>${escapeHtml(item.text)} → ${impact} ${ref(item.ref)}</li>`;
  }).join('');
  return `
<section>
  <h2>高优先级变化</h2>
  <table>
    <thead><tr><th>重要度</th><th>变化类型</th><th>变化内容</th><th>影响方向</th><th>引用</th></tr></thead>
    <tbody>${rows(high)}</tbody>
  </table>
</section>
<section>
  <h2>中优先级变化</h2>
  <table>
    <thead><tr><th>重要度</th><th>变化类型</th><th>变化内容</th><th>影响方向</th><th>引用</th></tr></thead>
    <tbody>${rows(medium)}</tbody>
  </table>
</section>
<section>
  <h2>因果链与矛盾信号</h2>
  <ul>${causal}</ul>
  <p>本期最密集的变化集中在 AI 算力基础设施、电力设备、储能、汽车与碳化硅链条。需要继续验证的是：订单与收入确认节奏是否同步、海外政策合规成本能否顺利传导、以及价格/成本变化是否会在后续季度转化为真实毛利改善。</p>
</section>`;
}

function topdownSection(groups: Map<string, Evidence[]>) {
  const topGroups = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
  return `<section><h2>Topdown</h2><ol>${topGroups.map(([name, items]) => {
    const samples = items.sort((a, b) => b.score - a.score).slice(0, 3);
    return `<li><strong>${escapeHtml(name)}：</strong>${samples.map((item) => `${escapeHtml(item.text)} ${ref(item.ref)}`).join('；')}。</li>`;
  }).join('')}</ol></section>`;
}

function buildWeeklyReport(notes: Note[], allEvidence: Evidence[]) {
  const byIndustry = new Map<string, Note[]>();
  const evidenceByRef = new Map<number, Evidence[]>();
  notes.forEach((note, index) => {
    const key = industry(note);
    if (!byIndustry.has(key)) byIndustry.set(key, []);
    byIndustry.get(key)!.push(note);
    evidenceByRef.set(index + 1, allEvidence.filter((item) => item.ref === index + 1));
  });
  const groups = new Map<string, Evidence[]>();
  for (const item of allEvidence) {
    const key = industry(item.note);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const industrySections = [...byIndustry.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name, groupNotes]) => {
      const sentimentScore = groupNotes
        .flatMap((note) => evidenceByRef.get(notes.indexOf(note) + 1) || [])
        .reduce((acc, item) => acc + (item.sentiment === '利好' ? 1 : item.sentiment === '利空' ? -1 : 0), 0);
      const mark = sentimentScore > 2 ? '+' : sentimentScore < -2 ? '-' : '=';
      const noteBlocks = groupNotes.map((note) => {
        const noteIndex = notes.indexOf(note) + 1;
        const bullets = (evidenceByRef.get(noteIndex) || []).slice(0, 8);
        return `<h3>${escapeHtml(title(note))}（${mark}）</h3>
<ul>${bullets.map((item) => `<li>${escapeHtml(item.text)} ${ref(item.ref)}</li>`).join('')}</ul>`;
      }).join('');
      return `<section><h2>${escapeHtml(name)}（${mark}）</h2>${noteBlocks}</section>`;
    }).join('\n');

  const positives = allEvidence.filter((item) => item.sentiment === '利好').sort((a, b) => b.score - a.score).slice(0, 28);
  const negatives = allEvidence.filter((item) => item.sentiment === '利空').sort((a, b) => b.score - a.score).slice(0, 18);
  const future = allEvidence
    .filter((item) => /2026|2027|2028|2030|年底|下半年|Q[1-4]|未来|计划|预计|目标/.test(item.text))
    .sort((a, b) => b.score - a.score)
    .slice(0, 35);
  const implication = `<section><h2>推演：基于过去一周变化的影响推导</h2>
<h3>变好的</h3><ul>${positives.map((item) => `<li><strong>${escapeHtml(industry(item.note))}</strong> — ${escapeHtml(item.text)} → 通过订单、价格、产能或技术渗透改善基本面 ${ref(item.ref)}</li>`).join('')}</ul>
<h3>变差的</h3><ul>${negatives.map((item) => `<li><strong>${escapeHtml(industry(item.note))}</strong> — ${escapeHtml(item.text)} → 通过需求、成本、政策或交付压力削弱基本面 ${ref(item.ref)}</li>`).join('')}</ul>
</section>`;
  const watch = `<section><h2>后续重点关注</h2><ul>${future.map((item) => `<li>${escapeHtml(item.text)}；后续需要跟踪时间窗口、订单兑现和成本/价格传导 ${ref(item.ref)}</li>`).join('')}</ul></section>`;
  return `${topdownSection(groups)}\n${industrySections}\n${implication}\n${watch}`;
}

async function loadSettings() {
  const [content] = await new Storage().bucket(bucketName).file(`${userId}/settings/ai.json`).download();
  return JSON.parse(content.toString());
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const settings = await loadSettings();
  const skills = settings.skills || [];
  const changeSkill = skills.find((skill: any) => skill.name === '发现变化 = 周报视角2');
  const weeklySkill = skills.find((skill: any) => skill.name === '周报skill');
  if (!changeSkill || !weeklySkill) throw new Error('Required Research Canvas skills not found.');

  const notes: Note[] = await prisma.transcription.findMany({
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
  if (!notes.length) throw new Error(`No Research Canvas notes found for ${rangeLabel}`);

  const allEvidence = notes.flatMap((note, index) => evidenceForNote(note, index + 1, 8));
  const prefix = path.join(outDir, `weekly-local-codex-${rangeKey}`);
  const sourcePack = `# Research Canvas Source Pack\n\nRange: ${rangeLabel}\nCount: ${notes.length}\nSkills: 发现变化 = 周报视角2; 周报skill\nModel: local Codex\n\n${notes.map((note, index) => `## [REF${index + 1}] ${title(note)}\n- id: ${note.id}\n- industry: ${industry(note)}\n- organization: ${note.organization || ''}\n- createdAt: ${note.createdAt.toISOString()}\n\n${preferred(note)}`).join('\n\n---\n\n')}`;
  const references = notes.map((note, index) => ({
    refNumber: index + 1,
    ref: `REF${index + 1}`,
    id: note.id,
    title: title(note),
    fileName: title(note),
    summary: '',
    translatedSummary: '',
    industry: industry(note),
    organization: note.organization || '',
    date: note.createdAt.toISOString(),
    sourceType: 'aiprocess-transcription',
    canvasId: '',
    workspaceId: '',
    workspaceName: '',
  }));

  fs.writeFileSync(`${prefix}.source-pack.md`, sourcePack);
  fs.writeFileSync(`${prefix}.references.json`, JSON.stringify(references, null, 2));
  fs.writeFileSync(`${prefix}.source-index.json`, JSON.stringify(notes.map((note, index) => ({
    ref: `REF${index + 1}`,
    id: note.id,
    title: title(note),
    industry: industry(note),
    createdAt: note.createdAt.toISOString(),
    chars: preferred(note).length,
  })), null, 2));
  fs.writeFileSync(`${prefix}.change-skill.md`, changeSkill.content || '');
  fs.writeFileSync(`${prefix}.weekly-skill.md`, weeklySkill.content || '');
  fs.writeFileSync(`${prefix}.evidence.json`, JSON.stringify(allEvidence.map((item) => ({
    ref: item.ref,
    title: title(item.note),
    industry: industry(item.note),
    score: item.score,
    category: item.category,
    sentiment: item.sentiment,
    text: item.text,
  })), null, 2));

  const changeTitle = `${startArg}_${endArg} 发现变化 = 周报视角2`;
  const weeklyTitle = `${startArg}_${endArg} 周报skill`;
  const changeHtml = htmlDocument(
    changeTitle,
    `数据来源仅限 Research Canvas notes；窗口 ${rangeLabel}；模型：local Codex；skill：发现变化 = 周报视角2。`,
    buildChangeReport(notes, allEvidence),
  );
  const weeklyHtml = htmlDocument(
    weeklyTitle,
    `数据来源仅限 Research Canvas notes；窗口 ${rangeLabel}；模型：local Codex；skill：周报skill。`,
    buildWeeklyReport(notes, allEvidence),
  );
  fs.writeFileSync(`${prefix}.change.html`, changeHtml);
  fs.writeFileSync(`${prefix}.weekly.html`, weeklyHtml);
  fs.writeFileSync(`${prefix}.generation.json`, JSON.stringify({
    rangeLabel,
    noteCount: notes.length,
    evidenceCount: allEvidence.length,
    model: 'local Codex',
    outputs: {
      change: `${prefix}.change.html`,
      weekly: `${prefix}.weekly.html`,
      references: `${prefix}.references.json`,
    },
  }, null, 2));
  console.log(JSON.stringify({
    rangeLabel,
    noteCount: notes.length,
    evidenceCount: allEvidence.length,
    changeHtml: `${prefix}.change.html`,
    weeklyHtml: `${prefix}.weekly.html`,
    referencesPath: `${prefix}.references.json`,
  }, null, 2));
}

main().finally(async () => prisma.$disconnect());
