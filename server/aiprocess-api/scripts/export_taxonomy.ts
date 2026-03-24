require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const SUPER_CATEGORIES = [
    {
      name: '电力',
      color: '#fadb14',
      industries: ['核电', '煤电', '天然气发电', '风光储', '电网设备', '电力运营商', 'bitcoin miner', '非电消纳'],
    },
    {
      name: '能源',
      color: '#fa8c16',
      industries: ['LNG', '煤', '石油', '天然气管道'],
    },
    {
      name: '资源',
      color: '#13c2c2',
      industries: ['稀土', '战略金属', '铜金', '铁', '铝'],
    },
    {
      name: '工业',
      color: '#1677ff',
      industries: [
        '航空航天', '五金工具', '泛工业', '军工', '卡车', '基建地产链条',
        '零部件', '自动化', '工程机械/矿山机械', '轨道交通',
        '机器人/工业自动化', '检测服务', '自动驾驶', '轮胎', '工业MRO',
        '锂电', '钠电', '暖通空调/楼宇设备'
      ],
    },
    {
      name: '科技和互联网',
      color: '#722ed1',
      industries: ['工业软件', '互联网/大模型', '数据中心设备'],
    },
    {
      name: '消费',
      color: '#52c41a',
      industries: ['车险', '汽车', '两轮车/全地形车', '报废车', '创新消费品'],
    },
    {
      name: '物流和运输',
      color: '#08979c',
      industries: ['航运', '海运', '铁路', '车运/货代', '造船'],
    },
    {
      name: '建设',
      color: '#eb2f96',
      industries: ['EPC', '设备租赁'],
    },
    {
      name: '农业',
      color: '#a0d911',
      industries: ['农用机械'],
    },
    {
      name: '金融业',
      color: '#d48806',
      industries: [],
    },
    {
      name: '政治',
      color: '#cf1322',
      industries: ['政治', '宏观'],
    }
  ];

const getSuperCategory = (industry: string) => {
  if (!industry) return '未分大类 (General)';
  for (const cat of SUPER_CATEGORIES) {
    if (cat.industries.includes(industry)) return cat.name;
  }
  return '未分大类 (General)';
};

async function main() {
  const records = await prisma.transcription.findMany({
    select: { industry: true, organization: true },
    where: { organization: { not: '' } }
  });

  const hierarchy: Record<string, Record<string, Set<string>>> = {};

  for (const record of records) {
    const orgRaw = record.organization || '';
    if (!orgRaw || orgRaw === '未知机构' || orgRaw === 'Private' || orgRaw === '未分公司') continue;
    
    // Some organizations could be multiple separated by comma? The schema says String. Generally it is one unified company after aliasing.
    const orgs = orgRaw.split(',').map(o => o.trim()).filter(Boolean);
    const ind = record.industry || '未归类';
    const superCat = getSuperCategory(ind);

    for (const org of orgs) {
      if (!hierarchy[superCat]) hierarchy[superCat] = {};
      if (!hierarchy[superCat][ind]) hierarchy[superCat][ind] = new Set();
      
      hierarchy[superCat][ind].add(org);
    }
  }

  let markdown = '# 公司行业分类树状图\n\n该列表反映了当前数据库中所有“已被归一化/识别过”的公司图谱。\n\n';
  
  for (const superCat of Object.keys(hierarchy).sort()) {
    markdown += `## 📁 ${superCat}\n`;
    for (const ind of Object.keys(hierarchy[superCat]).sort()) {
      const companies = Array.from(hierarchy[superCat][ind]).sort();
      markdown += `- **${ind}** (${companies.length} 家公司)\n`;
      for (const comp of companies) {
         markdown += `  - ${comp}\n`;
      }
    }
    markdown += '\n';
  }

  fs.writeFileSync('/Users/jiaqi/.gemini/antigravity/brain/988c1779-ad51-433e-8ced-003d71ca1370/taxonomy_export.md', markdown);
  console.log('Export Complete! Saved to taxonomy_export.md artifact.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
