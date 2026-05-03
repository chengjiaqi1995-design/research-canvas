const frontendOrigin = (process.env.SMOKE_FRONTEND_URL || 'https://research-canvas-iwuz3k44oa-as.a.run.app').replace(/\/+$/, '');
const apiOrigin = (process.env.SMOKE_API_URL || 'https://research-canvas-api-iwuz3k44oa-as.a.run.app').replace(/\/+$/, '');

async function assertOk(label, url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

await assertOk('API health', `${apiOrigin}/api/health`);
const frontend = await assertOk('frontend', frontendOrigin, { method: 'GET' });
const html = await frontend.text();
if (!html.includes('<div id="root"')) {
  throw new Error('frontend smoke failed: root mount node not found');
}

console.log(`Smoke test passed: ${frontendOrigin} -> ${apiOrigin}`);
