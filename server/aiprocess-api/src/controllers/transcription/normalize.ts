import { Request, Response } from 'express';
import prisma from '../../utils/db';
import type { ApiResponse } from '../../types';
const axios = require('axios');

// 构建基于 Portfolio 的映射字典
async function buildPortfolioMap(userId: string) {
  // @ts-ignore
  const positions = await prisma.portfolioPosition.findMany({
    where: { userId },
    select: { nameCn: true, nameEn: true, tickerBbg: true }
  });
  
  const mapping: Record<string, string> = {};
  for (const pos of positions) {
    let ticker = pos.tickerBbg || '';
    ticker = ticker.replace(/\s*Equity$/i, '').trim();
    
    // 智能地域识别：如果是大中华区股票，使用中文名；否则强制使用英文官方名
    const tLower = ticker.toLowerCase();
    const isDomestic = tLower.endsWith(' ch') || tLower.endsWith(' hk') || tLower.endsWith(' ss') || tLower.endsWith(' sz') || tLower.endsWith(' c1');
    
    let bestName = '';
    if (isDomestic) {
      bestName = pos.nameCn || pos.nameEn || '';
    } else {
      bestName = pos.nameEn || pos.nameCn || '';
    }
    
    const standardName = ticker ? `[${ticker}] ${bestName}` : bestName;
    if (pos.nameCn) mapping[pos.nameCn.toLowerCase()] = standardName;
    if (pos.nameEn) mapping[pos.nameEn.toLowerCase()] = standardName;
  }
  return mapping;
}

export async function normalizeCompanies(req: Request, res: Response) {
  const userId = req.userId!;
  
  try {
    const transcriptions = await prisma.transcription.findMany({
      where: {
        userId,
        organization: {
          not: null,
          notIn: ['未知', '未提取', ''],
        }
      },
      select: { id: true, organization: true, transcriptText: true }
    });

    // 过滤掉已经规范化过（带有圆括号()或方括号[]）的和纯字母短词
    const toProcess = transcriptions.filter(t => 
      t.organization && 
      !t.organization.includes('(') && 
      !t.organization.includes('（') && 
      !t.organization.includes('[') && 
      !t.organization.includes('【') && 
      t.organization.length > 1
    );

    if (toProcess.length === 0) {
      return res.json({ success: true, message: '没有需要规范化的散装公司名字', data: [] });
    }

    const portfolioMap = await buildPortfolioMap(userId);

    // 按当前 organization 分组，合并处理以节省 API 和 Database 次数
    const orgGroups: Record<string, string[]> = {};
    const orgContexts: Record<string, string> = {};

    for (const t of toProcess) {
      const org = t.organization!.trim();
      if (!orgGroups[org]) {
        orgGroups[org] = [];
        const text = t.transcriptText || '';
        const len = text.length;
        if (len < 400) {
          orgContexts[org] = text;
        } else {
          const mid = Math.floor(len / 2);
          orgContexts[org] = text.substring(0, 200) + ' ... ' + text.substring(mid, mid + 200);
        }
      }
      orgGroups[org].push(t.id);
    }

    const uniqueOrgs = Object.keys(orgGroups);
    const results = [];
    
    const { geminiApiKey, geminiModel, dryRun = true, approvedMapping } = req.body || {};

    // 如果前端直接传了审核过的 mapping，直接写入数据库即可
    if (!dryRun && approvedMapping && Object.keys(approvedMapping).length > 0) {
      let appliedCount = 0;
      for (const [oldOrg, newOrg] of Object.entries(approvedMapping)) {
        if (orgGroups[oldOrg] && typeof newOrg === 'string' && newOrg !== oldOrg) {
          await prisma.transcription.updateMany({
            where: { id: { in: orgGroups[oldOrg] } },
            data: { organization: newOrg }
          });
          appliedCount++;
        }
      }
      return res.json({ success: true, message: `成功应用 ${appliedCount} 组改动` });
    }

    const apiKey = geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
    
    if (!geminiModel) throw new Error('未指定 Gemini 模型，请在前端设置中选择模型');
    const targetModel = geminiModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    
    const unmatchedOrgs: string[] = [];
    const directMatches: Record<string, string> = {};

    // 辅助函数：如果是英文缩写或单词，必须匹配完整的单词边界
    const isWholeWordMatch = (fullStr: string, subStr: string) => {
      if (!subStr || !fullStr) return false;
      // 如果包含中文字符，直接做包含匹配
      if (/[\u4e00-\u9fa5]/.test(subStr) || /[\u4e00-\u9fa5]/.test(fullStr)) {
        return fullStr.includes(subStr);
      }
      // 英文则必须在单词边界匹配
      try {
        const escaped = subStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(fullStr);
      } catch (e) {
        return false;
      }
    };

    // 阶段一：使用 Portfolio 词典强行匹配
    for (const org of uniqueOrgs) {
      const lowerOrg = org.toLowerCase();
      let matched = false;
      for (const [key, standard] of Object.entries(portfolioMap)) {
        if (lowerOrg === key) {
          directMatches[org] = standard;
          matched = true;
          break;
        } else if (key.length >= 2 && lowerOrg.length >= 2) {
          // 双向检测：A包含B或B包含A，并且符合单词边界要求
          if ((lowerOrg.includes(key) && isWholeWordMatch(lowerOrg, key)) || 
              (key.includes(lowerOrg) && isWholeWordMatch(key, lowerOrg))) {
            directMatches[org] = standard;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        unmatchedOrgs.push(org);
      }
    }

    // 记录命中 Portfolio 的变更
    for (const [oldOrg, newOrg] of Object.entries(directMatches)) {
       const ids = orgGroups[oldOrg];
       if (!dryRun) {
         await prisma.transcription.updateMany({
           where: { id: { in: ids } },
           data: { organization: newOrg }
         });
       }
       results.push({ old: oldOrg, new: newOrg, count: ids.length, method: 'portfolio' });
    }

    // 辅助函数：延迟函数防封控
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    console.log("[DEBUG] Unmatched orgs going to AI:", unmatchedOrgs);

    // 阶段二：交给 AI 的世界知识进行聚类匹配
    for (let i = 0; i < unmatchedOrgs.length; i += 10) {
      if (i > 0) {
        console.log(`[DEBUG] Pausing for 3 seconds to respect rate limits...`);
        await delay(3000); 
      }
      
      const batch = unmatchedOrgs.slice(i, i + 10).map(o => `公司简称: "${o}" | 摘要上下文: "${orgContexts[o].replace(/\n/g, ' ')}"`);
      const prompt = `你是一个顶级卖方数据分析师。
请将以下提取出的非标准公司口语化简称，结合我提供的一小段原文上下文，精准映射为【标准名称】并附上 Bloomberg Ticker。

要求：
1. Ticker 格式放在名称左侧方括号内，且【绝不能带有 "Equity" 字样】！
例如：将 "潍柴" 映射为 "[000338 CH] 潍柴动力"，将 "Jefferies" 映射为 "[JEF US] Jefferies"。
2. 名称中英规则严格：
- 如果 Ticker 对应的官方实体是海外英文公司（如 FLNC US 对应 Fluence Energy），则名称必须【保持纯正英文原名】"Fluence Energy"，【绝对禁止】将其翻译成任何中文（例如绝对不能把 Fluence 写成 "福特"）。
- 相反的，对于所有以 " CH", " HK", " SS", " SZ" 结尾的大中华区股票，无论它的输入是英文缩写还是中文，你都【必须强制】使用它的【纯正中文官方名称】（例如：输入 "CATL" 必须映射为 "[300750 CH] 宁德时代"，绝对不能写出任何诸如 "Contemporary Amperex" 的英文或拼音）。
3. 如果完全查不到真实实体或它未上市，请使用 "[Private] 公司名"，例如 "[Private] Enchanted Rock"。
4. 哪怕输入的名称已经非常著名或标准（例如输入 "Chevron"、"BP" 或 "Apple"），你也【必须】为其补齐完整的 Ticker 格式输出（例如 "[CVX US] Chevron" 或 "[BP LN] BP plc"），【绝不能认为它已经很标准就不加 Ticker 甚至直接跳过它】！
5. 不要被零碎的字母误导，务必结合我提供的上下文判断它到底在指代哪家公司。如果看完上下文实在看不出是哪家公司，宁可保持原样也不要瞎编。

输入数据：
${batch.join('\n')}

你必须返回一个严格合法的 JSON 字典，键是"公司简称"（原样返回），值是你推断出来的 "[Ticker] 规范名称"。
确保【输入数据中的每一个公司】都在 JSON 的键里出现，【绝不能遗漏任何一个】！
只返回合法的 JSON 字典结构，不要有任何多余的废话。`;

      try {
        console.log(`[DEBUG] Sending batch ${i / 10 + 1} to Gemini...`);
        const aiResponse = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          }
        });
        
        let text = aiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        console.log(`[DEBUG] Gemini Response Text:`, text);
        
        if (text) {
          const mapping = JSON.parse(text);
          console.log(`[DEBUG] Gemini Parsed Mapping:`, mapping);
          
          const orgGroupsLower: Record<string, string> = {};
          for (const key of Object.keys(orgGroups)) {
            orgGroupsLower[key.toLowerCase()] = key;
          }

          for (const [aiKey, newOrg] of Object.entries(mapping)) {
             const originalKey = orgGroupsLower[aiKey.toLowerCase()];
             if (originalKey && typeof newOrg === 'string' && newOrg !== originalKey) {
               if (!dryRun) {
                 await prisma.transcription.updateMany({
                   where: { id: { in: orgGroups[originalKey] } },
                   data: { organization: newOrg }
                 });
               } else {
                 results.push({ old: originalKey, new: newOrg, count: orgGroups[originalKey].length, method: 'ai' });
               }
             }
          }
        }
      } catch (err: any) {
        console.error(`[ERROR] Gemini API Error for batch ${i / 10 + 1}:`, err.response?.status, err.response?.data || err.message);
      }
    }

    return res.json({ success: true, message: '公司列表归一化完成', data: results });
  } catch (error: any) {
    console.error('归一化失败:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export const updateOrganizationIndustry = async (req: Request, res: Response) => {
  try {
    const { organization, newIndustry, newOrganization } = req.body;
    if (!organization || !newIndustry) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    const updateData: any = { industry: newIndustry };
    if (newOrganization && newOrganization.trim() !== '' && newOrganization !== organization) {
      updateData.organization = newOrganization.trim();
    }
    
    const result = await prisma.transcription.updateMany({
      where: { organization },
      data: updateData
    });
    return res.json({ success: true, count: result.count });
  } catch (error) {
    console.error('Update industry error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
