/**
 * 通过 API 同步原版 Portfolio 的 taxonomy 分类到新 Notebook
 *
 * 原版 API（无鉴权）: https://portfolio-manager-208594497704.asia-southeast1.run.app
 * 新版 API（JWT）: https://ai-notebook-208594497704.asia-southeast1.run.app
 *
 * 运行: npx tsx scripts/sync-via-api.ts
 */

const OLD_API = 'https://portfolio-manager-208594497704.asia-southeast1.run.app/api';
const NEW_API = 'https://ai-notebook-208594497704.asia-southeast1.run.app/api';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJkMWMzMWMwYy0wYWEzLTRhZDctOGY4NC1mOGMxYjJmYjE0NTQiLCJlbWFpbCI6ImNoZW5namlhcWkxOTk1QGdtYWlsLmNvbSIsIm5hbWUiOiLnqIvlrrbpupIiLCJpYXQiOjE3NzM1Nzk1OTcsImV4cCI6MTc3NDE4NDM5N30.C8hF36wYDRj2iOU84C4twNLS6l_jd2aYAFIxktbjl_U';

const newHeaders = {
  'Authorization': `Bearer ${JWT}`,
  'Content-Type': 'application/json',
};

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers });
  const data = await res.json();
  return data;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: newHeaders,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function putJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: newHeaders,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  // 1. 从原版拉数据
  console.log('📥 从原版 Portfolio 拉取数据...');
  const [oldPositions, oldTopdowns, oldSectors, oldThemes] = await Promise.all([
    fetchJson(`${OLD_API}/positions`),
    fetchJson(`${OLD_API}/taxonomy?type=topdown`),
    fetchJson(`${OLD_API}/taxonomy?type=sector`),
    fetchJson(`${OLD_API}/taxonomy?type=theme`),
  ]);
  console.log(`  ${oldPositions.length} positions, ${oldTopdowns.length} topdowns, ${oldSectors.length} sectors, ${oldThemes.length} themes`);

  // 2. 从新版拉现有 taxonomy
  console.log('\n📥 从新版 Notebook 拉取现有 taxonomy...');
  const newTaxRes = await fetchJson(`${NEW_API}/portfolio/taxonomies`, newHeaders as any);
  const newTaxonomies: any[] = newTaxRes?.data || newTaxRes || [];
  console.log(`  现有 ${newTaxonomies.length} 个 taxonomy`);

  // 3. 创建缺失的 taxonomy，建立 oldId → newId 映射
  const topdownMap = new Map<number, number>();
  const sectorMap = new Map<number, number>();
  const themeMap = new Map<number, number>();

  for (const t of oldTopdowns) {
    const existing = newTaxonomies.find((n: any) => n.type === 'topdown' && n.name === t.name);
    if (existing) {
      topdownMap.set(t.id, existing.id);
    } else {
      const res = await postJson(`${NEW_API}/portfolio/taxonomies`, { type: 'topdown', name: t.name });
      const created = res?.data || res;
      if (created?.id) {
        topdownMap.set(t.id, created.id);
        console.log(`  ✅ 创建 topdown: ${t.name}`);
      } else {
        console.error(`  ❌ 创建 topdown 失败: ${t.name}`, res);
      }
    }
  }

  for (const t of oldSectors) {
    const existing = newTaxonomies.find((n: any) => n.type === 'sector' && n.name === t.name);
    if (existing) {
      sectorMap.set(t.id, existing.id);
    } else {
      const res = await postJson(`${NEW_API}/portfolio/taxonomies`, { type: 'sector', name: t.name });
      const created = res?.data || res;
      if (created?.id) {
        sectorMap.set(t.id, created.id);
        console.log(`  ✅ 创建 sector: ${t.name}`);
      } else {
        console.error(`  ❌ 创建 sector 失败: ${t.name}`, res);
      }
    }
  }

  for (const t of oldThemes) {
    const existing = newTaxonomies.find((n: any) => n.type === 'theme' && n.name === t.name);
    if (existing) {
      themeMap.set(t.id, existing.id);
    } else {
      const res = await postJson(`${NEW_API}/portfolio/taxonomies`, { type: 'theme', name: t.name });
      const created = res?.data || res;
      if (created?.id) {
        themeMap.set(t.id, created.id);
        console.log(`  ✅ 创建 theme: ${t.name}`);
      } else {
        console.error(`  ❌ 创建 theme 失败: ${t.name}`, res);
      }
    }
  }

  console.log(`\n📊 映射: ${topdownMap.size} topdowns, ${sectorMap.size} sectors, ${themeMap.size} themes`);

  // 4. 从新版拉 positions
  const newPosRes = await fetchJson(`${NEW_API}/portfolio/positions`, newHeaders);
  const newPositions: any[] = newPosRes?.data || newPosRes || [];
  console.log(`\n📥 新版有 ${newPositions.length} 个 positions`);

  // 5. 按 ticker 匹配，更新分类
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const oldPos of oldPositions) {
    if (!oldPos.ticker) continue;

    const newPos = newPositions.find((p: any) => p.ticker === oldPos.ticker);
    if (!newPos) {
      notFound++;
      continue;
    }

    const updateData: any = {};
    let changed = false;

    if (oldPos.topdownId && topdownMap.has(oldPos.topdownId)) {
      const newId = topdownMap.get(oldPos.topdownId)!;
      if (newPos.topdownId !== newId) {
        updateData.topdownId = newId;
        changed = true;
      }
    }

    if (oldPos.sectorId && sectorMap.has(oldPos.sectorId)) {
      const newId = sectorMap.get(oldPos.sectorId)!;
      if (newPos.sectorId !== newId) {
        updateData.sectorId = newId;
        changed = true;
      }
    }

    if (oldPos.themeId && themeMap.has(oldPos.themeId)) {
      const newId = themeMap.get(oldPos.themeId)!;
      if (newPos.themeId !== newId) {
        updateData.themeId = newId;
        changed = true;
      }
    }

    if (oldPos.priority && oldPos.priority !== newPos.priority) {
      updateData.priority = oldPos.priority;
      changed = true;
    }

    if (changed) {
      const res = await putJson(`${NEW_API}/portfolio/positions/${newPos.id}`, updateData);
      if (res?.success || res?.data) {
        updated++;
      } else {
        console.error(`  ❌ 更新失败: ${oldPos.ticker}`, res);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ 同步完成:`);
  console.log(`  更新: ${updated}`);
  console.log(`  无变化: ${skipped}`);
  console.log(`  新版未找到: ${notFound}`);
}

main().catch(console.error);
