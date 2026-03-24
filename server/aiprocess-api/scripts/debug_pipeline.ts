import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const buildPortfolioMap = async () => {
  const positions = await prisma.portfolioPosition.findMany();
  const mapping: Record<string, string> = {};
  for (const pos of positions) {
    let ticker = pos.tickerBbg || '';
    ticker = ticker.replace(/\s*Equity$/i, '').trim();
    
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
};

const isWholeWordMatch = (fullStr: string, subStr: string) => {
  if (!subStr || !fullStr) return false;
  if (/[\u4e00-\u9fa5]/.test(subStr) || /[\u4e00-\u9fa5]/.test(fullStr)) {
    return fullStr.includes(subStr);
  }
  try {
    const escaped = subStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(fullStr);
  } catch (e) {
    return false;
  }
};

async function main() {
  const transcriptions = await prisma.transcription.findMany({
    select: { id: true, organization: true }
  });

  const toProcess = transcriptions.filter(t => 
    t.organization && 
    !t.organization.includes('(') && 
    !t.organization.includes('（') && 
    !t.organization.includes('[') && 
    !t.organization.includes('【') && 
    t.organization.length > 1
  );

  const orgGroups: Record<string, string[]> = {};
  for (const t of toProcess) {
    const org = t.organization!.trim();
    if (!orgGroups[org]) orgGroups[org] = [];
    orgGroups[org].push(t.id);
  }

  const portfolioMap = await buildPortfolioMap();
  const uniqueOrgs = Object.keys(orgGroups);
  const directMatches = [];
  const unmatchedOrgs = [];

  for (const org of uniqueOrgs) {
    const lowerOrg = org.toLowerCase();
    let matched = false;

    if (portfolioMap[lowerOrg]) {
      directMatches.push(org + " -> " + portfolioMap[lowerOrg]);
      matched = true;
    } else {
      for (const [key, standardName] of Object.entries(portfolioMap)) {
         if (isWholeWordMatch(lowerOrg, key) || isWholeWordMatch(key, lowerOrg)) {
           directMatches.push(org + " -> " + standardName + " (fuzzy key: " + key + ")");
           matched = true;
           break;
         }
      }
    }
    if (!matched) unmatchedOrgs.push(org);
  }

  console.log("=== SIMULATION RESULTS ===");
  console.log(`Total DB records: ${transcriptions.length}`);
  console.log(`Records passed filter: ${toProcess.length}`);
  console.log(`Unique Orgs passed filter: ${uniqueOrgs.length}`);
  console.log(`Matched by Portfolio (${directMatches.length}):`, directMatches);
  console.log(`Sent to Gemini (${unmatchedOrgs.length}):`, unmatchedOrgs);

  // Specific check for problem children
  const targets = ["BP", "Chevron", "Baker Hughes", "Jefferies"];
  for (const target of targets) {
    if (unmatchedOrgs.includes(target)) console.log(`SUCCESS: ${target} survived correctly to AI phase.`);
    else if (uniqueOrgs.includes(target)) console.log(`FAIL: ${target} swallowed by Portfolio phase.`);
    else {
      const match = transcriptions.find(t => t.organization === target);
      if (!match) console.log(`FAIL: ${target} DOES NOT EXIST in database as exact string.`);
      else console.log(`FAIL: ${target} was dropped by the initial toProcess filter.`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
