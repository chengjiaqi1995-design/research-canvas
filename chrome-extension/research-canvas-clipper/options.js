const DEFAULTS = {
  appUrl: 'https://research-canvas-jxycyus54a-as.a.run.app',
  autoProcess: true,
  includeImages: true,
  includeLinks: true,
  includeHtml: false,
  openAfterUpload: false,
  maxTextChars: 180000
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  await load();
  $('settingsForm').addEventListener('submit', save);
  $('testBtn').addEventListener('click', test);
  $('clearBtn').addEventListener('click', clearToken);
});

async function load() {
  const state = await send('GET_STATE');
  const config = { ...DEFAULTS, ...state.config };
  $('appUrl').value = config.appUrl;
  $('autoProcess').checked = Boolean(config.autoProcess);
  $('includeImages').checked = Boolean(config.includeImages);
  $('includeLinks').checked = Boolean(config.includeLinks);
  $('includeHtml').checked = Boolean(config.includeHtml);
  $('openAfterUpload').checked = Boolean(config.openAfterUpload);
  $('maxTextChars').value = config.maxTextChars;
}

async function save(event) {
  event.preventDefault();
  const config = {
    appUrl: $('appUrl').value.trim(),
    autoProcess: $('autoProcess').checked,
    includeImages: $('includeImages').checked,
    includeLinks: $('includeLinks').checked,
    includeHtml: $('includeHtml').checked,
    openAfterUpload: $('openAfterUpload').checked,
    maxTextChars: Number($('maxTextChars').value || DEFAULTS.maxTextChars)
  };
  try {
    await requestPermissionForUrl(config.appUrl);
    await send('SAVE_CONFIG', { config });
    show('已保存设置', 'success');
  } catch (error) {
    show(error.message || String(error), 'error');
  }
}

async function test() {
  try {
    const result = await send('TEST_CONNECTION');
    show(`连接正常：${result.apiBase}`, 'success');
  } catch (error) {
    show(error.message || String(error), 'error');
  }
}

async function clearToken() {
  try {
    await send('CLEAR_TOKEN');
    show('已清除本机 token。服务地址设置不受影响。', 'success');
  } catch (error) {
    show(error.message || String(error), 'error');
  }
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '操作失败');
  return response.result;
}

function show(text, type) {
  const el = $('message');
  el.hidden = false;
  el.textContent = text;
  el.className = `message wide ${type}`;
}

async function requestPermissionForUrl(value) {
  try {
    const url = new URL(normalizeApiBase(value));
    const pattern = `${url.protocol}//${url.host}/*`;
    const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
    if (!hasPermission) {
      await chrome.permissions.request({ origins: [pattern] });
    }
  } catch {
    // Ignore invalid or denied permission here. The background request will surface upload errors.
  }
}

function normalizeApiBase(value) {
  const raw = String(value || DEFAULTS.appUrl).trim().replace(/\/+$/, '');
  if (!raw) return `${DEFAULTS.appUrl}/api`;
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}
