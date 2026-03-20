// 批量创建文件夹脚本
// 使用方法：登录应用后，在浏览器控制台 (F12) 粘贴执行

(async () => {
  const folders = [
    'EPC', 'AI赋能', '五金工具', 'bitcoin miner', '全地形车',
    '其他工业', '军工', '卡车', '基建地产链条', '天然气',
    '战略小金属', '战略金属', '报废车拍卖', '数据中心设备',
    '核电', '煤', '煤电', '石油', '稀土', '航空航天',
    '车险', '钠电', '铜', '电力设备', '整车', '零部件',
    '锂电', '自动化', '电力运营商', '工程机械', '两轮车',
    '光伏和储能', '矿山机械', '轨道交通', '人型机器人',
    '检测服务', '自动驾驶', '轮胎', '工业MRO', '设备租赁',
    '天然气管道', '数据中心散热', 'ETF'
  ];

  // 获取 token
  const stored = localStorage.getItem('rc_auth_user');
  if (!stored) { console.error('❌ 未登录，请先登录'); return; }
  const parsed = JSON.parse(stored);
  const token = parsed._credential || parsed.sessionToken;
  if (!token) { console.error('❌ 找不到认证 token'); return; }

  // 获取已有文件夹，避免重复
  const existingRes = await fetch('/api/workspaces', {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const existing = await existingRes.json();
  const existingNames = new Set(existing.map(w => w.name));
  let maxOrder = existing.reduce((max, w) => Math.max(max, w.order || 0), -1);

  let created = 0, skipped = 0;

  for (const name of folders) {
    if (existingNames.has(name)) {
      console.log(`⏭️ 跳过已存在: ${name}`);
      skipped++;
      continue;
    }

    maxOrder++;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(9)))
      .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);

    const workspace = {
      id,
      name,
      icon: '📁',
      canvasIds: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: maxOrder,
    };

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(workspace),
      });
      if (res.ok) {
        console.log(`✅ 创建成功: ${name}`);
        created++;
      } else {
        console.error(`❌ 创建失败: ${name}`, await res.text());
      }
    } catch (err) {
      console.error(`❌ 请求失败: ${name}`, err);
    }

    // 稍微延迟避免过快
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n🎉 完成！创建 ${created} 个，跳过 ${skipped} 个已存在的文件夹`);
  console.log('刷新页面即可看到新文件夹');
})();
