import { Tractor, Factory, HardHat, Landmark, ShoppingCart, Ship, Zap, Laptop, Flame, Pickaxe, Folder, Briefcase, Globe, Heart, Cpu, Atom, Leaf, type LucideIcon } from 'lucide-react';

/**
 * 行业大分类 → 小分类映射
 * 现在存储在后端，icon 字段为字符串（Lucide 图标名），前端通过 resolveIcon() 解析
 */
export interface IndustryCategory {
  label: string;
  icon: string;        // Lucide icon name, e.g. "Flame", "Factory"
  subCategories: string[];
}

/** Lucide 图标名 → 组件的映射表 */
export const ICON_MAP: Record<string, LucideIcon> = {
  Tractor, Factory, HardHat, Landmark, ShoppingCart, Ship, Zap, Laptop, Flame, Pickaxe,
  Folder, Briefcase, Globe, Heart, Cpu, Atom, Leaf,
};

/** 所有可用图标列表（用于图标选择器） */
export const AVAILABLE_ICONS = Object.keys(ICON_MAP);

/** 根据字符串名解析 Lucide 图标组件 */
export function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] || Folder;
}

/** 默认大分类列表 — 首次使用时会写入后端，之后从后端读取 */
export const DEFAULT_INDUSTRY_CATEGORIES: IndustryCategory[] = [
  { label: '农业', icon: 'Tractor', subCategories: ['农用机械'] },
  { label: '工业', icon: 'Factory', subCategories: ['五金工具', '军工', '卡车', '基建地产链条', '工程机械/矿山机械', '机器人/工业自动化', '泛工业', '自动驾驶', '航空航天', '钠电', '锂电', '零部件'] },
  { label: '建设', icon: 'HardHat', subCategories: ['EPC', '设备租赁'] },
  { label: '政治', icon: 'Landmark', subCategories: ['宏观'] },
  { label: '消费', icon: 'ShoppingCart', subCategories: ['两轮车/全地形车', '创新消费品', '报废车', '汽车'] },
  { label: '物流和运输', icon: 'Ship', subCategories: ['车运/货代', '造船'] },
  { label: '电力', icon: 'Zap', subCategories: ['bitcoin miner', '天然气发电', '核电', '电力运营商', '电网设备', '风光储'] },
  { label: '科技和互联网', icon: 'Laptop', subCategories: ['互联网/大模型', '工业软件', '数据中心设备'] },
  { label: '能源', icon: 'Flame', subCategories: ['LNG'] },
  { label: '资源', icon: 'Pickaxe', subCategories: ['战略金属', '稀土', '铜金', '铝'] },
];

/**
 * @deprecated 使用 useIndustryCategoryStore 替代。保留此导出仅为向后兼容。
 */
export const INDUSTRY_CATEGORY_MAP = DEFAULT_INDUSTRY_CATEGORIES;

/**
 * 小分类 → 公司名称列表
 * 用于迁移脚本创建公司文件夹
 */
export const INDUSTRY_COMPANIES: Record<string, string[]> = {
  '农用机械': [
    '[DE US] Deere & Company',
    '[Private] Sandhills Global',
  ],
  '五金工具': [
    '[002444 CH] 杭州巨星科技股份有限公司',
    '[0669 HK] 创科实业有限公司',
  ],
  '军工': [
    '[7011 JP] Mitsubishi Heavy Industries Ltd',
    '[7011 JP] Mitsubishi Heavy Industries Ltd.',
    '[BEL IN] Bharat Electronics Ltd.',
    '[CACI US] CACI International Inc.',
    '[LMT US] Lockheed Martin Corp',
    '[NOC US] Northrop Grumman Corp',
    '[Private] Arc Media',
  ],
  '卡车': [
    '[000951 CH] 中国重汽',
    '[3808 HK] 中国重汽(香港)有限公司',
    '[543228 IN] BLR Logistics (India) Limited',
    '[Private] 徐工汽车',
  ],
  '基建地产链条': [
    'ConstructConnect',
    '[1803 JP] Shimizu Corp.',
    '[BHP AU] BHP Group Ltd',
    '[LPX US] Louisiana-Pacific Corporation',
    '[Private] SRM Concrete',
  ],
  '工程机械/矿山机械': [
    '[000157 CH] 中联重科',
    '[000425 CH] 徐工机械',
    '[000680 CH] 山推工程机械股份有限公司',
    '[300818 CH] 耐普矿机股份有限公司',
    '[600031 CH] 三一重工',
    '[600162 CH] 山东临工',
    '[601100 CH] 恒立液压',
    '[CAT US] Caterpillar Inc.',
    '[SAND SS] Sandvik AB',
  ],
  '机器人/工业自动化': [
    '[002050 CH] 三花智控',
    '[002472 CH] 双环传动',
    '[179 HK] 德昌电机控股',
    '[300124 CH] 汇川技术',
    '[300953 CH] 震裕科技',
    '[601689 CH] 拓普集团',
    '[603337 CH] 杰克缝纫机股份有限公司',
    '[6273 JP] SMC Corp.',
    '[6506 JP] Yaskawa',
    '[6861 JP] KEYENCE ORD',
    '[7012 JP] Kawasaki',
    '[9880 HK] 优必选',
    '[HON US] Honeywell International Inc.',
    '[Private] Neuralink Corporation',
    '[Private] 强脑科技',
    '[Private] 微亿智造',
    '[Private] 梅卡曼德机器人',
    '[Private] 灵犀巧手',
    '[ROK US] ROCKWELL AUTOMAT ORD',
    '[SHA GY] Schaeffler AG',
    '[TSLA US] TESLA ORD',
    '巨生智能',
  ],
  '泛工业': [
    'D',
    '[300677 CH] 英科医疗',
  ],
  '自动驾驶': [
    '[9660 HK] 地平线',
    '[NVDA US] NVIDIA Corp',
    '[Private] Kodiak Robotics',
    '[Private] テクノシステムリサーチ',
    '[Private] 九识智能',
    '[Private] 小马智行',
    '[Private] 希迪智驾',
    '[TSLA US] TESLA ORD',
    '[WRD US] WERIDE-W ORD',
  ],
  '航空航天': [
    '[BA US] The Boeing Company',
    '[EH US] EHang Holdings Ltd.',
    '[FTAI US] Fortress Transportation and Infrastructure Investors LLC',
    '[GE US] GE Aerospace',
    '[HWM US] Howmet Aerospace Inc.',
    '[MTX GR] MTU Aero Engines AG',
    '[Private] Precision Castparts Corp.',
    '[Private] SpaceX',
    '[Private] Starlink',
    '[Private] 宝武特钢集团有限公司',
    '[Private] 宝钢特钢有限公司',
    '[Private] 蓝箭航天',
    '[RTX US] RTX Corp',
  ],
  '钠电': [
    '[002324 CH] 上海普利特复合材料股份有限公司',
    '[300438 CH] 鹏辉能源',
    '[300750 CH] 宁德时代',
    '[3931 HK] 中创新航',
    '[600152 CH] 维科技术',
  ],
  '锂电': [
    '[000695 CH] 天津滨海能源发展股份有限公司',
    '[002444 CH] 杭州巨星科技股份有限公司',
    '[300014 CH] 亿纬锂能',
    '[300750 CH] 宁德时代',
    '[603659 CH] 上海璞泰来新能源科技股份有限公司',
    '[688005 CH] 容百科技',
    '华泰',
  ],
  '零部件': [
    '[600885 CH] 宏发股份',
  ],
  'EPC': [
    '[1801 JP] Taisei Corp',
    '[1802 JP] 大林組',
    '[1820 JP] Nishimatsu Construction Co Ltd',
    '[1952 JP] 新日本空調株式会社',
    '[FIX US] COMFORT SYSTEMS USA ORD',
    '[FIX US] Comfort Systems USA',
    '[PWR US] QUANTA SERVICES ORD',
    '[PWR US] Quanta Services Inc.',
    'コムシスホールディングス',
  ],
  '设备租赁': [
    'Equipment Share',
  ],
  '宏观': [
    '[BAC US] Bank of America Corporation',
  ],
  '两轮车/全地形车': [
    '[1585 HK] 雅迪',
    '[301345 CH] 浙江涛涛车业股份有限公司',
    '[301345 CH] 涛涛车业',
    '[603129 CH] 春风动力',
    '[689009 CH] 九号公司',
    '[PII US] Polaris Inc',
    '[SKIL US] Skillsoft Corp',
  ],
  '创新消费品': [
    '[300866 CH] 安克创新',
  ],
  '报废车': [
    '[CPRT US] COPART ORD',
  ],
  '汽车': [
    '[002594 CH] 比亚迪股份有限公司',
    '[005380 KS] HYUNDAI MOTOR ORD',
    '[0175 HK] Geely Automobile Holdings Ltd.',
    '[300750 CH] 宁德时代',
    '[600104 CH] 零跑汽车',
    '[9973 HK] 奇瑞汽车',
    '[MSIL IN] MARUTI SUZUKI INDIA ORD',
    '[NIO US] NIO-SW ORD',
  ],
  '车运/货代': [
    '[CHRW US] C.H. Robinson Worldwide Inc.',
    '[JBHT US] J.B. Hunt Transport Services Inc',
    '[LSTR US] LANDSTAR SYSTEM ORD',
    '[R US] Ryder System Inc',
  ],
  '造船': [
    '[267260 KS] HD HYUNDAI ELECTRIC ORD',
  ],
  'bitcoin miner': [
    '[IREN US] IREN ORD',
  ],
  '天然气发电': [
    '[000338 CH] 潍柴动力',
    '[002353 CH] 杰瑞股份',
    '[002534 CH] 西子洁能',
    '[600875 CH] 东方电气股份有限公司',
    '[601727 CH] 上海电气',
    '[603308 CH] 应流集团股份有限公司',
    '[7011 JP] 三菱重工業株式会社',
    '[BE US] BLOOM ENERGY CL A ORD',
    '[CAT US] 卡特彼勒',
    '[ENR GR] SIEMENS ENERGY N ORD',
    '[FTAI US] Fortress Transportation and Infrastructure Investors LLC',
    '[GEV US] GE VERNOVA',
    '[Private] Enchanted Rock',
    '杭汽轮',
  ],
  '核电': [
    'Sprott',
    '[826 HK] 天工国际',
    '[CCJ US] CAMECO ORD',
    '[CCJ US] Cameco Corp',
    '[KAP LI] KAZATOMPROM NAC ORD',
    '[MIR US] MIRION TECHNOLOGIES CL A ORD',
    '[Private] Commonwealth Fusion Systems',
    '[Private] DeepFission',
    '[Private] Tennessee Valley Authority',
    '电力公司',
  ],
  '电力运营商': [
    '[0916 HK] 龙源电力',
    '[3996 HK] 中国能源建设股份有限公司',
    '[600011 CH] 华能国际电力股份有限公司',
    '[600795 CH] 国电电力',
    '[836 HK] China Resources Power Holdings Co Ltd',
    '[A2A IM] A2A S.p.A.',
    '[AGX US] ARGAN ORD',
    '[D US] Dominion Energy',
    '[EDP PT] EDP - Energias de Portugal SA',
    '[ELI BB] Elia Group',
    '[EXC US] Exelon Corporation',
    '[MSFT US] Microsoft Corp',
    '[NG/ LN] National Grid plc',
    '[Private] Austrian Power Grid AG',
    '[Private] McKinsey & Company',
    '[Private] PJM Interconnection',
    '[Private] Tennessee Valley Authority',
    '[Private] chess',
    '[Private] 中国南方电网有限责任公司',
    '[Private] 国家电网',
    '[Private] 西安风平能源科技有限公司',
    '[Private] 达宝智能',
    '[RWE GR] RWE AG',
    '电力公司',
  ],
  '电网设备': [
    'National grid',
    'Red Electrica',
    '[002028 CH] 思源电气',
    '[267260 KS] HD HYUNDAI ELECTRIC ORD',
    '[POWL US] Powell Industries Inc.',
    '[Private] Commercial Cash',
    '[Private] MR',
    '[Private] 江苏华鹏变压器有限公司',
  ],
  '风光储': [
    '[000725 CH] 京东方科技集团股份有限公司',
    '[002202 CH] 金风科技',
    '[066970 KS] L&F',
    '[300750 CH] 宁德时代',
    '[300751 CH] 迈为股份',
    '[605117 CH] 德业股份',
    '[688223 CH] 晶科能源股份有限公司',
    '[688390 CH] 固德威',
    '[ANE SM] Acciona Energía SA',
    '[CSIQ US] Canadian Solar Inc',
    '[CSIQ US] Canadian Solar Inc.',
    '[CWR LN] Ceres Power Holdings plc',
    '[FSLR US] FIRST SOLAR ORD',
    '[FSLR US] First Solar',
    '[Private] 中国长江三峡集团有限公司',
    '[Private] 发电集团',
    '[Private] 国家电网',
    '[Private] 欣界能源',
    '华电新能源',
  ],
  '互联网/大模型': [
    '[0700 HK] Tencent Holdings Ltd.',
    '[AMZN US] Amazon.com Inc',
    '[GOOGL US] Alphabet Inc.',
    '[MSFT US] Microsoft Corp.',
    '[NVDA US] NVIDIA Corp',
    '[Private] Anthropic',
    '[Private] MiniMax',
    '[Private] OpenAI',
    '[Private] 华为',
    '[Private] 字节跳动',
    '[ZI US] ZoomInfo Technologies Inc.',
  ],
  '工业软件': [
    '[ADBE US] Adobe Inc',
    '[Private] Georgia-Pacific',
  ],
  '数据中心设备': [
    'UBS',
    '[000338 CH] 潍柴动力',
    '[002518 CH] 科士达',
    '[002837 CH] 英维克',
    '[300870 CH] 深圳市欧陆通电子股份有限公司',
    '[601126 CH] 北京四方继保自动化股份有限公司',
    '[9698 HK] 万国数据控股有限公司',
    '[BE US] BLOOM ENERGY CL A ORD',
    '[CBRE US] CBRE Group Inc',
    '[DBRG US] DigitalBridge Group Inc',
    '[ETN US] EATON ORD',
    '[ETN US] Eaton Corp PLC',
    '[LBRT US] Liberty Energy Inc',
    '[MARA US] Marathon Digital Holdings Inc',
    '[NVDA US] NVIDIA Corp',
    '[NVDA US] NVIDIA Corporation',
    '[Private] Blue Owl Digital Infrastructure',
    '[Private] Sightline Research',
    '[SU FP] Schneider Electric SE',
    '[VRT US] Vertiv Holdings Co',
  ],
  'LNG': [
    '[BKR US] Baker Hughes Company',
    '[EQT US] EQT Corporation',
  ],
  '战略金属': [
    '[300856 CH] 赛恩斯',
    '[600549 CH] 厦门钨业股份有限公司',
  ],
  '稀土': [
    '[0769 HK] 中国稀土控股',
    '[LYC AU] Lynas Rare Earths Ltd',
    '[MP US] MP MATERIALS CL A ORD',
    '[NEO CN] Neo Performance Materials Inc',
  ],
  '铜金': [
    '[601899 CH] 紫金矿业集团股份有限公司',
    '[FM CN] First Quantum Minerals Ltd.',
  ],
  '铝': [
    '[601600 SS] 中国铝业股份有限公司',
    '[Private] Qatar Aluminium',
  ],
};

/** 每个小分类下需要创建的特殊子文件夹 */
export const INDUSTRY_SPECIAL_FOLDERS = ['行业研究', 'Expert', 'Sellside'];
