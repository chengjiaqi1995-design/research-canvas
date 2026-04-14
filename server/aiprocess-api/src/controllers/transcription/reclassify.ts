import { Request, Response } from 'express';
import prisma from '../../utils/db';
import type { ApiResponse } from '../../types';

/**
 * 新的行业分类列表（增加了 "核电"）
 */
const NEW_INDUSTRIES = [
  '核电', '铜金', '铁', '铝', '航空航天', '五金工具', '泛工业', '工业软件', '稀土', 'LNG', '煤', 'EPC',
  '互联网/大模型', 'bitcoin miner', '军工', '卡车', '基建地产链条', '天然气发电', '战略金属', '报废车',
  '数据中心设备', '煤电', '石油', '车险', '钠电', '电网设备', '汽车', '零部件', '锂电',
  '电力运营商', '工程机械/矿山机械', '两轮车/全地形车', '风光储', '轨道交通', '机器人/工业自动化',
  '检测服务', '自动驾驶', '轮胎', '工业MRO', '设备租赁', '天然气管道',
  '暖通空调/楼宇设备', '农用机械', '航运', '海运', '铁路', '车运/货代', '非电消纳', '造船', '创新消费品',
  '政治', '宏观'
];

/**
 * Portfolio sector 名称 → NEW_INDUSTRIES 名称的映射
 * 用于将 portfolio 里的 sector 转换为笔记系统的行业分类
 */
const PORTFOLIO_SECTOR_TO_INDUSTRY: Record<string, string> = {
  '美国基建地产': '基建地产链条',
  '汽车零部件': '零部件',
  '战略小金属': '战略金属',
  'AI赋能': '互联网/大模型',
  '两轮车': '两轮车/全地形车',
  '全地形车': '两轮车/全地形车',
  '其他工业': '泛工业',
  // 以下 portfolio sector 名称和 NEW_INDUSTRIES 完全一致，无需映射
  // '核电', '锂电', '整车', '电力设备', '电力运营商', '工程机械',
  // '自动化', '人型机器人', '自动驾驶', '光伏和储能', '稀土', '铜',
  // 'EPC', '卡车', '天然气', '战略金属', '报废车拍卖', '数据中心设备',
  // '煤', '煤电', '石油', '车险', '钠电', '五金工具', 'bitcoin miner',
  // '军工', '航空航天', '轨道交通', '检测服务', '轮胎', '工业MRO',
  // '设备租赁', '天然气管道', '数据中心散热', 'ETF', '基建地产链条',
  // '矿山机械'
};

/**
 * 旧行业标签 → 新行业 的直接映射表
 */
const INDUSTRY_MAPPING: Record<string, string> = {
  // === 原有映射 ===
  '挖矿': '矿山机械',
  '其他工业': '泛工业',
  'AI赋能': '互联网/大模型',
  '全地形车': '两轮车/全地形车',
  '两轮车': '两轮车/全地形车',

  // === 电力/能源相关 ===
  'IPP/Utilities': '电力运营商',
  'IPP': '电力运营商',
  'Utilities': '电力运营商',
  '电力': '电力运营商',
  '电力公司': '电力运营商',
  '发电': '电力运营商',
  '火电': '煤电',
  '燃气发电': '天然气发电',
  '燃气轮机': '天然气发电',
  '新能源': '风光储',
  '清洁能源': '风光储',
  '太阳能': '风光储',
  '风电': '风光储',
  '储能': '风光储',
  '光伏': '风光储',
  '电池': '锂电',
  '动力电池': '锂电',
  '蓄电池': '锂电',

  // === 核电 ===
  '核能': '核电',
  '核电站': '核电',
  '铀': '核电',
  'uranium': '核电',
  'nuclear': '核电',

  // === 军工/航空航天 ===
  '航空航天与国防': '军工',
  '国防': '军工',
  '国防军工': '军工',
  '防务': '军工',
  '航空': '航空航天',
  '航天': '航空航天',

  // === 汽车/交通 ===
  '汽车整车': '汽车',
  '新能源汽车': '汽车',
  '电动车': '汽车',
  'EV': '汽车',
  '商用车': '卡车',
  '重卡': '卡车',
  '轻卡': '卡车',
  '摩托车': '两轮车/全地形车',
  '电动两轮车': '两轮车/全地形车',
  '汽车零部件': '零部件',
  '汽车零配件': '零部件',
  '汽车配件': '零部件',

  // === 机器人 ===
  '机器人': '机器人/工业自动化',
  '人形机器人': '机器人/工业自动化',
  '人型机器人': '机器人/工业自动化',
  '工业机器人': '机器人/工业自动化',
  '自动化': '机器人/工业自动化',
  '工业自动化': '机器人/工业自动化',

  // === 机械 ===
  '工程机械': '工程机械/矿山机械',
  '矿山机械': '工程机械/矿山机械',

  // === 科技/互联网 ===

  // === 建筑/地产 ===
  '地产': '基建地产链条',
  '房地产': '基建地产链条',
  '建筑': '基建地产链条',
  '基建': '基建地产链条',
  '建材': '基建地产链条',
  '水泥': '基建地产链条',
  '钢铁': '基建地产链条',
  '美国基建地产': '基建地产链条',

  // === 矿业/金属 ===
  '有色金属': '战略金属',
  '金属': '战略金属',
  '贵金属': '战略金属',
  '黄金': '战略金属',
  '战略小金属': '战略金属',

  // === 数据中心 ===
  '数据中心': '数据中心设备',
  'IDC': '数据中心设备',
  '服务器': '数据中心设备',
  '散热': '数据中心设备',
  '液冷': '数据中心设备',

  // === IT/软件 ===
  '软件': '工业软件',
  'CAD': '工业软件',
  'CAE': '工业软件',
  'ERP': '工业软件',
  'MES': '工业软件',

  // === 铁路 ===
  '高铁': '轨道交通',
  '城轨': '轨道交通',
  '地铁': '轨道交通',

  // === 通用/宏观 ===
  'General': 'GENERAL',
  'general': 'GENERAL',
  '宏观': 'GENERAL',
  '宏观研究': 'GENERAL',
  '综合': 'GENERAL',
  '多行业': 'GENERAL',

  // === 保险 ===
  '保险': '车险',
  '财险': '车险',

  // === 比特币 ===
  'Bitcoin': 'bitcoin miner',
  'BTC': 'bitcoin miner',
  '比特币': 'bitcoin miner',
  '加密货币': 'bitcoin miner',
  '数字货币': 'bitcoin miner',
  'crypto': 'bitcoin miner',

  // === 油气 ===
  '天然气设备': '天然气管道',
  '油气': '石油',
  '原油': '石油',
  '炼化': '石油',
  '石化': '石油',
  '管道': '天然气管道',
  '油气管道': '天然气管道',

  // === 其他工业 ===
  '检测': '检测服务',
  '质检': '检测服务',
  '第三方检测': '检测服务',
  '租赁': '设备租赁',
  '工程总包': 'EPC',
  '总承包': 'EPC',
  'MRO': '工业MRO',
  '维修': '工业MRO',
};

/**
 * 将 portfolio sector 名称转换为 NEW_INDUSTRIES 中的名称
 */
function resolvePortfolioSector(sectorName: string): string | null {
  // 直接在 NEW_INDUSTRIES 中
  if (NEW_INDUSTRIES.includes(sectorName)) return sectorName;
  // 通过映射表转换
  if (PORTFOLIO_SECTOR_TO_INDUSTRY[sectorName]) return PORTFOLIO_SECTOR_TO_INDUSTRY[sectorName];
  // 通过通用映射表转换
  if (INDUSTRY_MAPPING[sectorName]) return INDUSTRY_MAPPING[sectorName];
  return null;
}

/**
 * 从 portfolio positions 构建公司名关键词 → 行业映射
 * 同时存储多种匹配形式：全名、关键词
 */
async function buildPortfolioSectorMap(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    const positions = await prisma.portfolioPosition.findMany({
      where: { userId },
      select: {
        nameEn: true,
        nameCn: true,
        tickerBbg: true,
        sector: { select: { name: true } },
      },
    });

    for (const p of positions) {
      const rawSector = p.sector?.name;
      if (!rawSector) continue;

      // 转换 portfolio sector → NEW_INDUSTRIES 行业名
      const industry = resolvePortfolioSector(rawSector);
      if (!industry) {
        console.warn(`   ⚠️ Portfolio sector "${rawSector}" 无法映射到 NEW_INDUSTRIES`);
        continue;
      }

      // 将中英文全名和 ticker 送给 AI 做模糊理解（统一小写）
      if (p.nameCn) map.set(p.nameCn.toLowerCase(), industry);
      if (p.nameEn) map.set(p.nameEn.toLowerCase(), industry);
      if (p.tickerBbg) map.set(p.tickerBbg.toLowerCase(), industry);
    }

    console.log(`   📋 已加载 ${positions.length} 个 portfolio positions，建立 ${map.size} 条公司→行业映射`);
  } catch (error: any) {
    console.warn(`   ⚠️ 加载 portfolio positions 失败: ${error.message}`);
  }

  return map;
}

/**
 * 尝试通过 portfolio sector 匹配笔记的公司/机构名
 */
function matchByPortfolio(
  organization: string | null,
  fileName: string,
  topic: string | null,
  portfolioMap: Map<string, string>,
): string | null {
  if (portfolioMap.size === 0) return null;

  // 要搜索的文本列表
  const searchTexts: string[] = [];
  if (organization) searchTexts.push(organization.toLowerCase());
  if (topic) searchTexts.push(topic.toLowerCase());
  if (fileName) searchTexts.push(fileName.toLowerCase());

  for (const text of searchTexts) {
    for (const [companyKey, industry] of portfolioMap) {
      // 跳过太短的 key（避免误匹配）
      if (companyKey.length < 3) continue;

      // 双向包含匹配
      if (text.includes(companyKey) || companyKey.includes(text.split('-')[0]?.trim() || '')) {
        return industry;
      }
    }
  }

  return null;
}

/**
 * 提取文章六个不同位置的片段，每个位置提取 length 个字符
 */
function extractSixChunks(text: string | null, length: number = 200): string {
  if (!text || text.trim().length === 0) return '';
  if (text.length <= length * 6) return text;

  const len = text.length;
  const p1 = text.substring(0, length);
  const p2 = text.substring(Math.floor(len * 0.2), Math.floor(len * 0.2) + length);
  const p3 = text.substring(Math.floor(len * 0.4), Math.floor(len * 0.4) + length);
  const p4 = text.substring(Math.floor(len * 0.6), Math.floor(len * 0.6) + length);
  const p5 = text.substring(Math.floor(len * 0.8) - length, Math.floor(len * 0.8));
  const p6 = text.substring(len - length);

  return `[切片1]: ${p1}...\n[切片2]: ...${p2}...\n[切片3]: ...${p3}...\n[切片4]: ...${p4}...\n[切片5]: ...${p5}...\n[切片6]: ...${p6}`;
}

/**
 * 使用 Gemini 判断笔记应该归属哪个行业
 */
async function classifyWithGemini(
  content: string,
  topic: string | null,
  organization: string | null,
  currentIndustry: string | null,
  fileName: string,
  apiKey: string,
  geminiModel: string,
  portfolioHint: string | null = null,
): Promise<string> {
  const axios = require('axios');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

  // 将行业列表编号展示
  const industriesNumbered = NEW_INDUSTRIES.map((ind, i) => `${i + 1}. ${ind}`).join('\n');

  const portfolioContext = portfolioHint
    ? `\n【重要：用户的投资组合公司映射表】\n如果笔记内容主要是在讨论以下公司或其相关简称（强烈支持模糊匹配），请**必须**返回其对应的行业：\n${portfolioHint.substring(0, 3000)}\n`
    : '';

  const prompt = `你是工业行业分类专家。请根据以下笔记信息，从给定的行业列表中选择最匹配的一个行业。

【笔记信息】
- 文件名: ${fileName || '未知'}
- 当前行业标签: ${currentIndustry || '未知'}
- 主题: ${topic || '未知'}
- 公司/机构: ${organization || '未知'}
- 综合内容:
${content.substring(0, 4000)}
${portfolioContext}
【可选行业列表】
${industriesNumbered}

【分类规则】
1. 必须从上述列表中精确选择一个行业名称，严禁自创。
2. **绝对不要轻易使用 "GENERAL" 或 "其他"**！哪怕是略微宏观的行业报告，也要尽量试图推断并归类到 "泛工业"、"基建地产链条"、"检测服务" 等最接近的实体行业中。只有在极端跨行业且完全无法匹配时才使用 "GENERAL"（极不推荐）。
3. 如果用户的投资组合映射表里有对应的公司，你应当优先使用该表中定义的行业。
3. 常见对应：
   - 电力公司/独立发电商/IPP → "电力运营商"
   - 燃气轮机/天然气发电 → "天然气"
   - 煤电/火电厂 → "煤电"
   - LNG/液化天然气 → "LNG"
   - 核电/铀矿 → "核电"
   - 黄金/紫金矿业/金矿 → "铜金" 或 "战略金属"
   - 铁矿石/铁矿 → "铁"
   - 光伏/风电/储能 → "风光储"
   - 机器人/人形机器人/伺服 → "机器人/工业自动化"
   - 乘用车/新能源车/汽车 → "汽车"
   - 干散货/集装箱/油轮 → "海运" 或 "航运"
   - 造船/船厂 → "造船"
   - 货代/物流/UPS → "车运/货代"
   - 拖拉机/收割机/农用 → "农用机械"
   - 空调/冷气/特灵/大金 → "暖通空调/楼宇设备"
   - 报废车/残值车/Copart → "报废车"
   - 重卡/商用车 → "卡车"
   - 摩托车/ATV/电瓶车 → "两轮车/全地形车"
   - 国防/军事/导弹/CACI → "军工"
   - 飞机/发动机/航天 → "航空航天"
   - 数据中心服务器/UPS/配电 → "数据中心设备"
   - 数据中心散热/液冷 → "数据中心设备"
   - 比特币挖矿 → "bitcoin miner"
   - 3PL/物流 → "泛工业"
   - 明确工业相关但不属于细分 → "泛工业"
   - 完全不相关 → "GENERAL"

请只返回行业名称，不要加引号、序号或任何其他文字。`;

  try {
    const response = await axios.post(url, {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 100,
      }
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    const rawResult = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!rawResult || rawResult === '') {
      console.warn(`⚠️ Gemini 返回空结果。细节:`, JSON.stringify(response.data));
      return 'GENERAL';
    }

    // 清理结果
    const result = rawResult
      .replace(/^[\d]+\.\s*/, '')
      .replace(/^["'""'']+|["'""'']+$/g, '')
      .trim();

    // 精确匹配
    if (NEW_INDUSTRIES.includes(result)) return result;

    // 去空格模糊匹配
    const normalizedResult = result.replace(/[\s\/\\]/g, '').toLowerCase();
    const match = NEW_INDUSTRIES.find(ind =>
      ind.replace(/[\s\/\\]/g, '').toLowerCase() === normalizedResult
    );
    if (match) return match;

    // 部分匹配
    const partialMatch = NEW_INDUSTRIES.find(ind =>
      ind.length > 2 && (normalizedResult.includes(ind.replace(/[\s\/\\]/g, '').toLowerCase()) ||
        ind.replace(/[\s\/\\]/g, '').toLowerCase().includes(normalizedResult))
    );
    if (partialMatch) {
      console.log(`   🔍 Gemini 部分匹配: "${rawResult}" → "${partialMatch}"`);
      return partialMatch;
    }

    // 通过映射表
    if (INDUSTRY_MAPPING[result]) return INDUSTRY_MAPPING[result];
    if (INDUSTRY_MAPPING[rawResult]) return INDUSTRY_MAPPING[rawResult];

    console.warn(`⚠️ Gemini 返回了不在列表中的行业: "${rawResult}" (cleaned: "${result}")，使用 GENERAL`);
    return 'GENERAL';
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`❌ Gemini 分类失败: ${errMsg}`);
    return 'GENERAL';
  }
}

/**
 * 批量重新分类所有笔记的行业
 * POST /api/transcriptions/reclassify-industries
 *
 * 流程：
 * 1. 先更新用户的行业目录
 * 2. 加载 portfolio positions sector 数据
 * 3. 逐条分类：keep → mapping → portfolio匹配 → Gemini
 */
export async function reclassifyIndustries(req: Request, res: Response) {
  const userId = req.userId!;
  const { geminiApiKey, geminiModel, dryRun } = req.body as {
    geminiApiKey?: string;
    geminiModel?: string;
    dryRun?: boolean;
  };

  const apiKey = geminiApiKey;
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: 'GEMINI_API_KEY 未设置。请在设置中配置 Gemini API Key',
    } as ApiResponse);
  }

  if (!geminiModel) {
    return res.status(400).json({ success: false, error: '未指定 Gemini 模型，请在前端设置中选择模型' } as ApiResponse);
  }
  const model = geminiModel;

  console.log(`\n🔄 ========== 开始行业重分类 ==========`);
  console.log(`   用户: ${userId}`);
  console.log(`   模式: ${dryRun ? '预览（dry run）' : '实际执行'}`);
  console.log(`   Gemini 模型: ${model}`);

  // Step 0: 先更新用户的行业目录
  if (!dryRun) {
    await prisma.user.update({
      where: { id: userId },
      data: { customIndustries: JSON.stringify(NEW_INDUSTRIES) },
    });
    console.log(`   ✅ 已更新用户的行业列表（${NEW_INDUSTRIES.length} 个行业）`);
  }

  // Step 1: 加载 portfolio positions 的 sector 映射
  const portfolioMap = await buildPortfolioSectorMap(userId);

  // Step 2: 获取所有未分类完成的笔记
  const transcriptions = await prisma.transcription.findMany({
    where: {
      userId,
      status: 'completed',
      OR: [
        { industry: null },
        { industry: { notIn: NEW_INDUSTRIES } }
      ]
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      industry: true,
      topic: true,
      organization: true,
      summary: true,
      transcriptText: true,
    },
  });

  console.log(`   📊 共 ${transcriptions.length} 条笔记需要处理`);

  // Step 3: 分类处理
  const results: Array<{
    id: string;
    fileName: string;
    oldIndustry: string | null;
    newIndustry: string;
    method: 'keep' | 'mapping' | 'portfolio' | 'gemini';
  }> = [];

  let keepCount = 0;
  let mappingCount = 0;
  let portfolioCount = 0;
  let geminiCount = 0;

  for (let i = 0; i < transcriptions.length; i++) {
    const t = transcriptions[i];
    const oldIndustry = t.industry;
    let newIndustry: string;
    let method: 'keep' | 'mapping' | 'portfolio' | 'gemini';

    // Case 1: 已经在新列表中 → 保持不变
    if (oldIndustry && NEW_INDUSTRIES.includes(oldIndustry)) {
      newIndustry = oldIndustry;
      method = 'keep';
      keepCount++;
    }
    // Case 2: 在映射表中 → 直接映射
    else if (oldIndustry && INDUSTRY_MAPPING[oldIndustry]) {
      newIndustry = INDUSTRY_MAPPING[oldIndustry];
      method = 'mapping';
      mappingCount++;
      console.log(`   📝 [${i + 1}/${transcriptions.length}] 映射: "${oldIndustry}" → "${newIndustry}" (${t.fileName})`);
    }
    // Case 3: 调用 Gemini AI (融合 Portfolio 模糊判断)
    else {
      method = 'gemini';
      geminiCount++;
      const summaryText = t.summary || t.fileName || '';
      const contentChunks = extractSixChunks(t.transcriptText, 200);
      const combinedContent = `[AI摘要]\n${summaryText}\n\n[全文提取切片]\n${contentChunks}`;

      // 整理全局 portfolio 映射供 AI 选择（限制长度以免超出限制）
      const portfolioListString = portfolioMap.size > 0 
        ? Array.from(portfolioMap.entries()).map(([k, v]) => `${k} -> ${v}`).join('\n')
        : null;

      console.log(`   🤖 [${i + 1}/${transcriptions.length}] Gemini: "${oldIndustry || '无'}" → ? (${t.fileName})`);

      newIndustry = await classifyWithGemini(
        combinedContent,
        t.topic,
        t.organization,
        oldIndustry,
        t.fileName,
        apiKey,
        model,
        portfolioListString,
      );

      console.log(`      → "${newIndustry}"`);

      // API 限流
      if (i < transcriptions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    results.push({
      id: t.id,
      fileName: t.fileName,
      oldIndustry,
      newIndustry,
      method,
    });
  }

  // Step 4: 实际更新数据库
  if (!dryRun) {
    console.log(`\n   💾 开始写入数据库...`);

    const toUpdate = results.filter(r => r.oldIndustry !== r.newIndustry);
    const BATCH_SIZE = 50;
    for (let batch = 0; batch < toUpdate.length; batch += BATCH_SIZE) {
      const slice = toUpdate.slice(batch, batch + BATCH_SIZE);
      await Promise.all(
        slice.map(r =>
          prisma.transcription.update({
            where: { id: r.id },
            data: { industry: r.newIndustry },
          })
        )
      );
    }

    console.log(`   ✅ 共更新 ${toUpdate.length} 条笔记的行业`);
  }

  const changedCount = results.filter(r => r.oldIndustry !== r.newIndustry).length;

  const summary = {
    total: transcriptions.length,
    kept: keepCount,
    mapped: mappingCount,
    portfolioMatched: portfolioCount,
    geminiClassified: geminiCount,
    changed: changedCount,
    unchanged: transcriptions.length - changedCount,
    dryRun: !!dryRun,
    newIndustriesCount: NEW_INDUSTRIES.length,
  };

  console.log(`\n   📊 ========== 重分类完成 ==========`);
  console.log(`   总计: ${summary.total}`);
  console.log(`   保持不变: ${summary.kept}`);
  console.log(`   直接映射: ${summary.mapped}`);
  console.log(`   Portfolio匹配: ${summary.portfolioMatched}`);
  console.log(`   Gemini分类: ${summary.geminiClassified}`);
  console.log(`   实际变更: ${summary.changed}`);
  console.log(`   =====================================\n`);

  return res.json({
    success: true,
    data: {
      summary,
      details: results,
      newIndustries: NEW_INDUSTRIES,
    },
    message: dryRun
      ? `预览完成：${summary.changed} 条笔记将被重新分类`
      : `重分类完成：${summary.changed} 条笔记已更新`,
  } as ApiResponse);
}
