// 批量设置文件夹分类脚本
// 使用方法：登录应用后，在浏览器控制台 (F12) 粘贴执行

(async () => {
  // 定义分类：overall=整体, personal=个人, 其余默认=industry(行业)
  const overallNames = [
    '值得长期看的票', '寻找新的idea', '研究框架', '对市场大的判断',
    '周报框架', 'DATA', 'ETF', '示例工作区'
  ];
  const personalNames = [
    '个人信息', '中转'
  ];
  // 不在上面两组的，默认归为 industry

  const stored = localStorage.getItem('rc_auth_user');
  if (!stored) { console.error('❌ 未登录'); return; }
  const parsed = JSON.parse(stored);
  const token = parsed._credential || parsed.sessionToken;
  if (!token) { console.error('❌ 找不到 token'); return; }

  const res = await fetch('/api/workspaces', {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  const workspaces = await res.json();

  let updated = 0;
  for (const ws of workspaces) {
    let category = 'industry';
    if (overallNames.includes(ws.name)) category = 'overall';
    else if (personalNames.includes(ws.name)) category = 'personal';

    if (ws.category === category) {
      console.log(`⏭️ 已是 ${category}: ${ws.name}`);
      continue;
    }

    try {
      const r = await fetch(`/api/workspaces/${ws.id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, updatedAt: Date.now() })
      });
      if (r.ok) {
        console.log(`✅ ${ws.name} → ${category}`);
        updated++;
      } else {
        console.error(`❌ ${ws.name}`, await r.text());
      }
    } catch (err) {
      console.error(`❌ ${ws.name}`, err);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n🎉 完成！更新了 ${updated} 个文件夹的分类`);
  console.log('刷新页面即可看到效果');
})();
