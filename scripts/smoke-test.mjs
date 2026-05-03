const frontendOrigin = (process.env.SMOKE_FRONTEND_URL || 'https://research-canvas-jxycyus54a-as.a.run.app').replace(/\/+$/, '');
const apiOrigin = (process.env.SMOKE_API_URL || 'https://research-canvas-api-jxycyus54a-as.a.run.app').replace(/\/+$/, '');

async function readJson(res) {
  const text = await res.text();
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: null, text };
  }
}

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

async function assertOAuthCallback() {
  const res = await fetch(`${apiOrigin}/api/auth/google`, {
    redirect: 'manual',
    headers: { Referer: 'http://127.0.0.1:5174/' },
  });
  if (![302, 303].includes(res.status)) {
    const text = await res.text();
    throw new Error(`OAuth redirect failed: ${res.status} ${text.slice(0, 240)}`);
  }
  const location = res.headers.get('location') || '';
  const expectedCallback = encodeURIComponent(`${apiOrigin}/api/auth/google/callback`);
  if (!location.includes(`redirect_uri=${expectedCallback}`)) {
    throw new Error(`OAuth redirect_uri mismatch: ${location.slice(0, 500)}`);
  }
}

async function assertAuthMeProxied() {
  const res = await fetch(`${apiOrigin}/api/auth/me`, {
    headers: { Authorization: 'Bearer dev-token' },
  });
  const { body, text } = await readJson(res);
  if (!res.ok || !body?.success) {
    throw new Error(`/api/auth/me proxy failed: ${res.status} ${text.slice(0, 240)}`);
  }
}

async function assertSignedUpload() {
  const url = `${apiOrigin}/api/upload/signed-url?fileName=smoke.ogg&model=qwen3-asr-flash-filetrans&contentType=audio%2Fogg`;
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer dev-token' },
  });
  const { body, text } = await readJson(res);
  if (!res.ok || !body?.success || !body?.data?.signedUrl || !body?.data?.fileUrl) {
    throw new Error(`signed upload smoke failed: ${res.status} ${text.slice(0, 240)}`);
  }

  const preflight = await fetch(body.data.signedUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: frontendOrigin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (!preflight.ok) {
    throw new Error(`signed upload CORS preflight failed: ${preflight.status} ${preflight.statusText}`);
  }
}

await assertOk('API health', `${apiOrigin}/api/health`);
const frontend = await assertOk('frontend', frontendOrigin, { method: 'GET' });
const html = await frontend.text();
if (!html.includes('<div id="root"')) {
  throw new Error('frontend smoke failed: root mount node not found');
}

await assertOAuthCallback();
await assertAuthMeProxied();
await assertSignedUpload();

await assertEodhdConfigured(
  'frontend API proxy + EODHD',
  `${frontendOrigin}/api/portfolio/market/symbol/AAPL.US/detail?days=10`,
);

console.log(`Smoke test passed: ${frontendOrigin} -> ${apiOrigin}`);
