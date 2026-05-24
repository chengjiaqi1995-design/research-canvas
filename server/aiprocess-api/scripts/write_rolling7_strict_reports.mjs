import fs from 'fs';
import path from 'path';

const outDir = path.resolve(process.cwd(), '../../tmp/scheduled-reports');

function latestPrefix() {
  const metas = fs.readdirSync(outDir)
    .filter((name) => /^rolling7-local-codex-.*\.meta\.json$/.test(name))
    .map((name) => path.join(outDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!metas.length) throw new Error('No rolling7 meta file found.');
  return metas[0].replace(/\.meta\.json$/, '');
}

const prefix = process.argv[2] || latestPrefix();
const meta = JSON.parse(fs.readFileSync(`${prefix}.meta.json`, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(`${prefix}.evidence.json`, 'utf8'));
const sourceIndex = JSON.parse(fs.readFileSync(`${prefix}.source-index.json`, 'utf8'));

function esc(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ref(n) {
  return `[REF${n}]`;
}

function normalize(text = '') {
  return String(text)
    .replace(/The first-generation production line, replacing the Model S and Model X lines at the Fremont factory, is designed with an annual capacity of 1 million robots\./g, '特斯拉第一代人形机器人产线规划在 Fremont 工厂替代 Model S 与 Model X 产线，设计年产能为 100 万台机器人。')
    .replace(/The second-generation production line at the Texas Gigafactory is also under preparation, with a long-term designed annual capacity of 10 million robots\./g, '特斯拉 Texas Gigafactory 第二代人形机器人产线也在准备中，长期设计年产能为 1,000 万台机器人。')
    .replace(/If subsequent testing is problem-free, it is expected to move from C-sample to D-sample and SOP testing in early June 2026, with potential supply start in Q4 2026\./g, '如果后续测试没有问题，项目预计在 2026 年 6 月初从 C 样进入 D 样和 SOP 测试，潜在供货起点在 2026Q4。')
    .replace(/\[(?:REF)?\d+\]/gi, '')
    .replace(/【源\s*\d+(?:[、,\s]*源?\s*\d+)*】/g, '')
    .replace(/【[^】]*(?:源|source|street|consensus|call|UBS|GS|Td|BofA|Barclay|BNP)[^】]*】/gi, '')
    .replace(/\b(?:earning|earnings|barclay|barclays|bnp|UBS|GS|Td|call|clear street|nmr)\b/gi, '')
    .replace(/Podwise\s+https?:\/\/\S+\s*/gi, '')
    .replace(/阅读状态：[^；。]*[；。]?/g, '')
    .replace(/保存状态：[^；。]*[；。]?/g, '')
    .replace(/音频保存状态：[^；。]*[；。]?/g, '')
    .replace(/本地音频路径：[^；。]*[；。]?/g, '')
    .replace(/适合支撑的 claim 类型：[^；。]*[；。]?/g, '')
    .replace(/是否需要交叉验证：[^；。]*[；。]?/g, '')
    .replace(/^来源与背景\s*/g, '')
    .replace(/来源：(?:Podwise CLI|小宇宙|红杉资本播客|Sequoia Capital Podcast)[^。；]*[。；]?/g, '')
    .replace(/核查说明：[^。；]*[。；]?/g, '')
    .replace(/^(?:[一二三四五六七八九十]+、|模块[一二三四五六七八九十\d]+[:：]|#+)\s*/g, '')
    .replace(/^(?:整体业绩概览|利润率分析|异常指标说明|分业务讨论|未来指引|关键风险标注|市场总览与政策动态|成本与价格趋势|订单与储备规模|收入端|展望|市场规模与渗透率|市场展望|商业模式与市场通路|财务预测|未来增长|需求景气度与业绩预判|动力电池需求趋势分析|Pax Silica倡议概述与战略定位|AI使用模式的转变|电力消耗现状与增长驱动|未来预测与物理瓶颈|技术迭代与公司进展|海外主电源行业与技术路线分析|AI Capex 与离网电源模式趋势)\s*[:：]?\s*/g, '')
    .replace(/\s*\([A-Za-z][^)]{0,80}\)\s*/g, (m) => {
      if (/MW|GW|GWh|MWh|kWh|BBU|UPS|HVDC|SST|AI|CPU|GPU|ASP|ARR|EBITDA|PEEK|ACR|IT|HPC|TPU|PSU|SiC/.test(m)) return m;
      return '';
    })
    .replace(/Intermodal/g, '多式联运')
    .replace(/Hyperscalers?/gi, '超大规模云厂商')
    .replace(/CapEx/gi, '资本开支')
    .replace(/ASP/g, '单价')
    .replace(/revenue/gi, '收入')
    .replace(/margin/gi, '利润率')
    .replace(/\s+([。；，、：])/g, '$1')
    .replace(/([。；，、：])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function noteTitle(refNumber) {
  return sourceIndex.find((item) => Number(String(item.ref).replace('REF', '')) === refNumber)?.title || `REF${refNumber}`;
}

function sourceItem(refNumber) {
  return sourceIndex.find((item) => Number(String(item.ref).replace('REF', '')) === refNumber) || {};
}

function cleanHeadingText(input = '') {
  return String(input)
    .replace(/\s*--[^-]*-(?:中国|美国|欧洲|其他|印度|韩国|日本|全球)-20\d{2}\/\d{2}\/\d{2}\s*$/g, '')
    .replace(/\s*-\[[^\]]+\]\s*/g, ' ')
    .replace(/\s*\[[^\]]+\]\s*/g, ' ')
    .replace(/\s*·\s*AI总结\s*$/g, '')
    .replace(/\.(?:mp3|m4a|ogg|pdf)\s*$/i, '')
    .replace(/^Recording\s*\(\d+\)$/i, '')
    .replace(/^Video Player\s*\(\d+\)$/i, '')
    .replace(/^\d{2}-\d{2}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function thematicHeading(refNumber, items = []) {
  const source = sourceItem(refNumber);
  const rawTitle = cleanHeadingText(source.title || '');
  const ind = cleanHeadingText(source.industry || '');
  const sample = items.slice().sort((a, b) => b.score - a.score)[0];
  const fixedByRef = {
    1: '电网设备产能与交付瓶颈',
    2: '工业设备租赁与利用率',
    3: '仓储自动化与 ACR 渗透率',
    4: '消费储能与海外渠道',
    5: 'AI 电力需求与能源约束',
    6: '人形机器人量产节点',
    7: '数据中心备用电源订单',
    8: '大模型训练与产品化节奏',
    9: '地缘政策与技术竞争',
    10: '数据中心建设瓶颈',
    11: 'SiC 设备订单与验收',
    12: 'SiC 设备国产化与客户验证',
    13: 'EPC 订单与管道资产',
    14: '离网电源与燃机方案',
    15: '智能调光玻璃商业化',
    16: '钠电产业化与成本曲线',
    17: '电解铝供需与价格弹性',
    18: '多式联运与物流景气',
    19: '能源设备订单与核电需求',
    20: 'AI 供应链安全与政策',
    21: 'AI 内容工具商业化',
    22: '液冷与高压直流供电',
    23: '天然气发电设备出海',
    24: '锂电排产与材料价格',
    25: '电力资产与 HPC 转型',
    26: '油轮价差与库存阈值',
    27: '造船周期与油运供给',
    28: '铜金宏观定价',
    29: '机器人供应链订单验证',
    30: 'AI 电力链与新技术路线',
  };
  if (fixedByRef[refNumber]) return fixedByRef[refNumber];
  if (/IEA|能源景观|电力需求/.test(rawTitle)) return 'AI 与电力需求';
  if (/数据中心|AIDC|液冷|HVDC|BBU|电源/.test(rawTitle)) return 'AI 数据中心电力与散热';
  if (/燃机|天然气发电|能源设备/.test(rawTitle)) return '燃机与天然气发电';
  if (/机器人|人形|ACR|仓储自动化/.test(rawTitle)) return '机器人与仓储自动化';
  if (/锂电|钠电|电池|CIBF/.test(rawTitle)) return '锂电、钠电与备电电池';
  if (/出口|关税|产业链/.test(rawTitle)) return '出口链与关税';
  if (/油轮|航运|造船|油运/.test(rawTitle)) return '油运与造船周期';
  if (/铝|电解铝/.test(rawTitle)) return '电解铝供需';
  if (/Pax Silica|AI供应链/.test(rawTitle)) return 'AI 供应链安全';
  if (/安克|储能|阳台光储/.test(rawTitle)) return '消费储能与阳台光储';
  if (/光羿|调光玻璃/.test(rawTitle)) return '智能调光玻璃';
  if (rawTitle && rawTitle.length <= 28 && !/expert|management|sellside|source|源\s*\d/i.test(rawTitle)) return rawTitle;
  if (sample?.text) {
    const text = normalize(sample.text);
    const first = text.split(/[，。；:：]/)[0].replace(/^(预计|当前|未来|公司|行业|核心|本周)/, '').trim();
    if (first.length >= 4 && first.length <= 24) return first;
  }
  return ind || `主题 ${refNumber}`;
}

function latinHeavy(text = '') {
  const zh = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  return zh < 24 && latin > 80;
}

function shouldDropEvidence(item) {
  const text = item.text || '';
  if (!text || text.length < 20) return true;
  if (item.industry === 'podcast') return true;
  if (/Podwise|阅读状态|本地音频路径|保存状态|音频保存状态|适合支撑的 claim 类型|是否需要交叉验证/i.test(text)) return true;
  if (/建议.*(买入|卖出|配对交易|做多|做空|仓位)|标的推荐|交易建议|投资策略分析/i.test(text)) return true;
  if (/USD mn 指标|Margin 指标|consensus vs consensus|Gross profit .*Operating income|\| \| Revenue|【源|【源\d+】/i.test(text)) return true;
  if (latinHeavy(text)) return true;
  return false;
}

function implication(item) {
  const ind = item.industry || '相关行业';
  if (item.sentiment === '利好') {
    if (item.category === '需求变化') return `${ind} 的收入、订单或利用率有改善弹性`;
    if (item.category === '供给变化') return `${ind} 的产能释放和份额变化需要重新定价`;
    if (item.category === '供需关系变化') return `${ind} 的价格、库存或交付周期可能改善`;
    if (item.category === '技术和产品创新') return `${ind} 的产品单价、渗透率或客户导入有上行空间`;
    if (item.category === '成本曲线变化') return `${ind} 的成本优势或毛利改善可能扩大`;
    if (item.category === '政策变化') return `${ind} 的政策约束或准入门槛可能带来结构性溢价`;
    return `${ind} 的基本面和估值叙事边际改善`;
  }
  if (item.sentiment === '利空') {
    if (item.category === '需求变化') return `${ind} 的需求、销量或订单兑现承压`;
    if (item.category === '供给变化') return `${ind} 的新增供给或交付节奏可能压制利润`;
    if (item.category === '供需关系变化') return `${ind} 的价格、库存或供需缺口存在反向扰动`;
    if (item.category === '成本曲线变化') return `${ind} 的成本端可能侵蚀利润率`;
    if (item.category === '政策变化') return `${ind} 的合规和准入风险上升`;
    return `${ind} 的盈利兑现和估值修复需要降权`;
  }
  return `${ind} 需要继续跟踪订单、价格、成本和交付数据`;
}

function watchPoint(item) {
  if (/订单|合同|出货|客户|交付/.test(item.text)) return '后续验证订单是否转为收入、交付是否按期完成';
  if (/价格|涨价|成本|毛利|利润率/.test(item.text)) return '后续验证价格和成本变化能否进入毛利率';
  if (/产能|扩产|投产|良率/.test(item.text)) return '后续验证产能释放、良率和客户认证节奏';
  if (/政策|关税|补贴|出口|本土|准入/.test(item.text)) return '后续验证政策执行细则和供应链重配成本';
  if (/AI|数据中心|电力|燃机|液冷|HVDC|BBU/.test(item.text)) return '后续验证云厂商资本开支、供电架构导入和设备订单';
  return '后续验证该变化是否能持续进入经营数据';
}

function toneClass(tone) {
  if (tone === '利好') return 'pos';
  if (tone === '利空') return 'neg';
  if (tone === '待验证') return 'watch';
  return 'neu';
}

function htmlDocument(title, subtitle, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#d7dee8;--panel:#fff;--soft:#f7f9fc;--blue:#175cd3;--green:#087443;--red:#b42318;--amber:#b54708;--shadow:0 12px 28px rgba(16,24,40,.07)}*{box-sizing:border-box}body{margin:0;background:#eef3f8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif;line-height:1.72}.page{max-width:1240px;margin:0 auto;padding:30px 22px 56px}header,section{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}header{padding:28px 32px}section{margin-top:18px;padding:24px 28px;box-shadow:0 8px 20px rgba(16,24,40,.05)}h1{margin:0 0 10px;font-size:28px;line-height:1.25;letter-spacing:0}h2{margin:0 0 14px;font-size:20px;line-height:1.35;letter-spacing:0}h3{margin:18px 0 8px;font-size:16px;line-height:1.4}p{margin:8px 0}.subtitle,.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;margin:14px 0 4px;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:10px 9px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#344054;font-size:12px;font-weight:750}ul,ol{margin:8px 0 0 20px;padding:0}li{margin:6px 0}strong{font-weight:750}.ref-link{color:var(--blue);text-decoration:none;font-weight:700;margin:0 2px}.pill{display:inline-flex;padding:2px 7px;border-radius:6px;font-size:12px;font-weight:750;white-space:nowrap}.pos{background:#ecfdf3;color:var(--green)}.neg{background:#fee4e2;color:var(--red)}.neu{background:#f2f4f7;color:#475467}.watch{background:#fff6e5;color:var(--amber)}@media(max-width:820px){.page{padding:18px 12px 36px}header,section{padding:18px 16px}table{font-size:12px}th,td{padding:8px 6px}h1{font-size:23px}}
</style>
</head>
<body><main class="page">
<header><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></header>
${body}
</main></body></html>`;
}

const cleanedEvidence = evidence
  .map((item) => ({ ...item, text: normalize(item.text) }))
  .filter((item) => !shouldDropEvidence(item));

const byIndustry = new Map();
for (const item of cleanedEvidence) {
  if (!byIndustry.has(item.industry)) byIndustry.set(item.industry, []);
  byIndustry.get(item.industry).push(item);
}

function buildChangeReport() {
  const ranked = cleanedEvidence
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score || a.ref - b.ref)
    .slice(0, 70);
  const lines = ranked.map((item) => {
    const level = item.score >= 12 ? '高' : '中';
    const direction = item.sentiment === '中性' ? '待验证' : item.sentiment;
    return `<p>[${level}] [${esc(item.category)}] ${esc(item.text)}（${esc(direction)} → ${esc(item.industry)}） ${ref(item.ref)}</p>`;
  }).join('\n');
  const chains = ranked.slice(0, 24).map((item) => (
    `${esc(item.industry)}：${esc(item.text)} → ${esc(implication(item))} → ${esc(watchPoint(item))} ${ref(item.ref)}`
  ));
  return `<section><h2>变化信号</h2>${lines}</section>
<section><h2>因果链</h2>${chains.map((line, index) => `<p>因果链${index + 1}：${line}</p>`).join('\n')}</section>
<section><h2>总结</h2><p>本期最值得关注的是 AI 电力化、机器人订单验证、锂电材料与 BBU 需求、出口链关税边际变化、油运和铝的短期供需缺口。核心待验证项是订单能否进入收入、涨价能否进入毛利、产能能否按期交付，以及政策和关税变化是否真正改变供应链成本。</p></section>`;
}

function topdown() {
  const groups = [...byIndustry.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 9);
  const rows = groups.map(([industry, items]) => {
    const top = items.slice().sort((a, b) => b.score - a.score || a.ref - b.ref).slice(0, 4);
    const refs = [...new Set(top.map((item) => item.ref))].map(ref).join(' ');
    const facts = top.map((item) => `${normalize(item.text)}；`).join('');
    const tone = top.filter((item) => item.sentiment === '利好').length >= top.filter((item) => item.sentiment === '利空').length ? '偏正面' : '偏负面';
    return `<li><strong>${esc(industry)}（${tone}）：</strong>${esc(facts)}综合含义是，${esc(industry)} 的排序取决于订单、价格、成本和交付能否继续兑现。${refs}</li>`;
  }).join('\n');
  return `<section><h2>Topdown</h2><ol>${rows}</ol></section>`;
}

function industryNarrative(industry, items) {
  const top = items.slice().sort((a, b) => b.score - a.score || a.ref - b.ref).slice(0, 6);
  const refs = [...new Set(top.map((item) => item.ref))].slice(0, 4).map(ref).join(' ');
  if (/数据中心|电力|天然气|bitcoin miner|互联网\/大模型/.test(industry)) {
    return `<p>${esc(industry)} 的共同变化是“交付能力”开始比单纯需求预测更重要。材料里反复出现电网排队、燃机交期、液冷和高压直流架构、BBU 备电、客户合同和单位兆瓦价值等信号，说明 AI 资本开支已经穿透到电力设备、备用电源、热管理和电池链条。${refs}</p>`;
  }
  if (/机器人/.test(industry)) {
    return `<p>${esc(industry)} 这周的重点不是概念扩散，而是订单、成本和规模化节点。仓储 ACR 的低渗透率、人形机器人零部件的收入利润目标、PEEK 降本、液冷散热和四足机器人量产节点，共同把板块推向 2026 年真实业绩验证。${refs}</p>`;
  }
  if (/锂电|钠电|零部件/.test(industry)) {
    return `<p>${esc(industry)} 的核心矛盾是需求场景扩张和成本曲线再定价同时发生。储能、BBU、钠电、智能调光玻璃和车端新材料都出现新场景，但良率、价格、政策和终端销量决定这些变化能否进入利润表。${refs}</p>`;
  }
  if (/创新消费品|出口/.test(industry)) {
    return `<p>${esc(industry)} 的主线从单纯出口 Beta 转向企业自身能力。关税边际压力下降有利于利润修复，但库存管理、海外产能、品牌溢价和渠道扩张会决定不同公司的弹性差异。${refs}</p>`;
  }
  if (/油运|铝|铜金|宏观/.test(industry)) {
    return `<p>${esc(industry)} 的变化更接近资产定价框架切换：油运从供需转向库存阈值和区域价差，铝从高库存压制转向短期缺口和价格催化，宏观则把 AI 供应链安全纳入产业政策竞争。${refs}</p>`;
  }
  return `<p>${esc(industry)} 的关键在于订单、成本和交付是否继续改善。本周材料显示，局部需求和政策变化已经出现，但仍需要用后续收入、订单和利润率验证持续性。${refs}</p>`;
}

function noteBlocksForIndustry(industry, items) {
  const byRef = new Map();
  for (const item of items) {
    if (!byRef.has(item.ref)) byRef.set(item.ref, []);
    byRef.get(item.ref).push(item);
  }
  return [...byRef.entries()].map(([refNumber, list]) => {
    const bullets = list.slice().sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8);
    const score = list.reduce((acc, item) => acc + (item.sentiment === '利好' ? 1 : item.sentiment === '利空' ? -1 : 0), 0);
    const mark = score > 0 ? '+' : score < 0 ? '-' : '=';
    return `<ul><li><strong>${esc(thematicHeading(refNumber, list))}（${mark}）</strong><ul>${bullets.map((item) => `<li>${esc(item.text)} ${ref(item.ref)}<ul><li>支撑细节：变化类型为${esc(item.category)}；影响路径是${esc(implication(item))}；后续验证点是${esc(watchPoint(item))}。</li></ul></li>`).join('\n')}</ul></li></ul>`;
  }).join('\n');
}

function industrySections() {
  return [...byIndustry.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([industry, items]) => {
      const score = items.reduce((acc, item) => acc + (item.sentiment === '利好' ? 1 : item.sentiment === '利空' ? -1 : 0), 0);
      const mark = score >= 5 ? '+' : score <= -5 ? '-' : '=';
      return `<section><h2>${esc(industry)}（${mark}）</h2>${noteBlocksForIndustry(industry, items)}</section>`;
    }).join('\n');
}

function implications() {
  const positives = cleanedEvidence.filter((item) => item.sentiment === '利好').sort((a, b) => b.score - a.score).slice(0, 30);
  const negatives = cleanedEvidence.filter((item) => item.sentiment === '利空').sort((a, b) => b.score - a.score).slice(0, 20);
  const future = cleanedEvidence.filter((item) => /2026|2027|2028|2030|年底|下半年|未来|预计|计划|目标|Q[1-4]/.test(item.text)).sort((a, b) => b.score - a.score).slice(0, 35);
  return `<section><h2>推演：基于本周变化的影响推导</h2><h3>变好的：</h3><ul>${positives.map((item) => `<li>${esc(item.industry)} — ${esc(item.text)} → ${esc(implication(item))} → 基本面改善点：订单、收入、价格、成本或利润率中至少一个变量需要继续验证。${ref(item.ref)}</li>`).join('\n')}</ul><h3>变差的：</h3><ul>${negatives.map((item) => `<li>${esc(item.industry)} — ${esc(item.text)} → ${esc(implication(item))} → 基本面压力点：需求、成本、交付、库存或政策约束中至少一个变量可能压制兑现。${ref(item.ref)}</li>`).join('\n')}</ul></section>
<section><h2>后续重点关注</h2><ul>${future.map((item) => `<li>${esc(item.industry)} — ${esc(watchPoint(item))}；对应本周变化：${esc(item.text)}。${ref(item.ref)}</li>`).join('\n')}</ul></section>`;
}

function buildWeeklyReport() {
  return `${topdown()}\n${industrySections()}\n${implications()}`;
}

const periodLabel = meta.periodLabel || '最近7天';
const titleRange = meta.rangeLabel.replace(' SGT', '');
const changeTitle = `${titleRange} ${periodLabel} 发现变化 = 周报视角2`;
const weeklyTitle = `${titleRange} ${periodLabel} 周报skill`;
const subtitleBase = `数据来源仅限 Research Canvas notes；窗口 ${meta.rangeLabel}；模型：local Codex；note 数：${meta.noteCount}。`;

fs.writeFileSync(`${prefix}.change.html`, htmlDocument(changeTitle, `${subtitleBase} skill：发现变化 = 周报视角2。`, buildChangeReport()));
fs.writeFileSync(`${prefix}.weekly.html`, htmlDocument(weeklyTitle, `${subtitleBase} skill：周报skill。`, buildWeeklyReport()));
fs.writeFileSync(`${prefix}.report-meta.json`, JSON.stringify({
  prefix,
  changeHtml: `${prefix}.change.html`,
  weeklyHtml: `${prefix}.weekly.html`,
  referencesPath: `${prefix}.references.json`,
  rangeLabel: meta.rangeLabel,
  noteCount: meta.noteCount,
}, null, 2));

console.log(JSON.stringify({
  changeHtml: `${prefix}.change.html`,
  weeklyHtml: `${prefix}.weekly.html`,
  referencesPath: `${prefix}.references.json`,
  rangeLabel: meta.rangeLabel,
  noteCount: meta.noteCount,
}, null, 2));
