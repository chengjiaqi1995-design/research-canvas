import type { PromptTemplate } from '../types/index.ts';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'industry_landscape',
    name: '行业竞争格局',
    description: '分析行业主要玩家、市场份额、竞争壁垒',
    category: 'analysis',
    prompt: `你是一名资深行业分析师。请根据以下资料，分析该行业的竞争格局：

1. 主要玩家及其市场份额
2. 核心竞争壁垒（技术、规模、品牌、渠道等）
3. 潜在进入者与替代威胁
4. 行业集中度变化趋势

请用结构化的方式呈现，包含数据支撑。

{context}`,
  },
  {
    id: 'company_financials',
    name: '公司财务摘要',
    description: '提取收入、利润、现金流等关键财务指标',
    category: 'summary',
    prompt: `你是一名专业的财务分析师。请根据以下资料，提取并分析公司的关键财务指标：

1. 收入规模与增速
2. 毛利率、净利率趋势
3. 自由现金流状况
4. 资产负债结构
5. 关键财务风险点

请用表格形式呈现核心数据，并给出简要评价。

{context}`,
  },
  {
    id: 'multi_company_compare',
    name: '多公司对比',
    description: '横向对比多家公司的核心指标',
    category: 'comparison',
    prompt: `你是一名投资研究员。请根据以下资料，对涉及的公司进行横向对比分析：

对比维度：
1. 业务规模与市场地位
2. 财务表现（收入、利润率、增速）
3. 竞争优势与劣势
4. 估值水平（如有数据）
5. 投资吸引力排序

请用对比表格 + 文字分析的形式呈现。

{context}`,
  },
  {
    id: 'investment_thesis',
    name: '投资论点提炼',
    description: 'Bull/Bear/Base case 分析',
    category: 'analysis',
    prompt: `你是一名买方分析师。请根据以下资料，提炼该公司/行业的投资论点：

## Bull Case（乐观情景）
- 核心驱动因素
- 潜在上行空间

## Base Case（基准情景）
- 最可能的发展路径
- 预期回报

## Bear Case（悲观情景）
- 主要风险因素
- 潜在下行风险

## 关键变量
- 哪些因素会决定最终走向哪个情景

{context}`,
  },
  {
    id: 'event_timeline',
    name: '事件时间线',
    description: '按时间排列关键事件和里程碑',
    category: 'summary',
    prompt: `请根据以下资料，梳理出关键事件的时间线：

按时间顺序列出：
- 日期/时间段
- 事件描述
- 影响与意义

请按时间从早到晚排列，突出转折性事件。

{context}`,
  },
  {
    id: 'core_takeaways',
    name: '研报核心观点',
    description: '提取研报的 3-5 个核心观点及数据支撑',
    category: 'summary',
    prompt: `你是一名研究助理。请从以下资料中提取 3-5 个最核心的观点：

对于每个观点：
1. 一句话概括观点
2. 关键数据/证据支撑
3. 投资含义

请按重要性排序。

{context}`,
  },
  {
    id: 'risk_analysis',
    name: '风险因素分析',
    description: '识别和评估主要风险因素',
    category: 'analysis',
    prompt: `你是一名风控分析师。请根据以下资料，识别并评估主要风险因素：

对于每个风险：
1. 风险描述
2. 发生概率（高/中/低）
3. 潜在影响程度（高/中/低）
4. 可能的缓释措施

请按风险严重程度排序。

{context}`,
  },
  {
    id: 'web_research',
    name: '联网研究',
    description: '基于公开数据搜索和分析（需联网模型）',
    category: 'research',
    prompt: `请搜索并整理以下主题的最新公开信息：

{context}

要求：
1. 引用具体数据来源
2. 标注信息的时效性
3. 区分事实与观点
4. 如有矛盾信息，请指出并分析`,
  },
];
