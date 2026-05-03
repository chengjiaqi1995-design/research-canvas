const frontendOrigin = (process.env.SMOKE_FRONTEND_URL || 'https://research-canvas-jxycyus54a-as.a.run.app').replace(/\/+$/, '');
const apiOrigin = (process.env.SMOKE_API_URL || 'https://research-canvas-api-jxycyus54a-as.a.run.app').replace(/\/+$/, '');

async function assertOk(label, url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

async function assertEodhdConfigured(label, url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer dev-token' } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!res.ok) {
    if (text.includes('EODHD_API_TOKEN is not configured') || text.includes('ECONNREFUSED')) {
      throw new Error(`${label} failed: ${res.status} ${text.slice(0, 240)}`);
    }
    console.warn(`${label} warning: ${res.status} ${text.slice(0, 160)}`);
    return;
  }

  if (!body?.success || !body?.data?.history?.length) {
    throw new Error(`${label} failed: missing symbol history`);
  }
}

await assertOk('API health', `${apiOrigin}/api/health`);
const frontend = await assertOk('frontend', frontendOrigin, { method: 'GET' });
const html = await frontend.text();
if (!html.includes('<div id="root"')) {
  throw new Error('frontend smoke failed: root mount node not found');
}

await assertEodhdConfigured(
  'frontend API proxy + EODHD',
  `${frontendOrigin}/api/portfolio/market/symbol/AAPL.US/detail?days=10`,
);

console.log(`Smoke test passed: ${frontendOrigin} -> ${apiOrigin}`);
