const DEFAULT_CONFIG = {
  appUrl: 'https://research-canvas-jxycyus54a-as.a.run.app',
  autoProcess: true,
  includeImages: true,
  includeLinks: true,
  includeHtml: false,
  openAfterUpload: false,
  maxTextChars: 180000
};

const LOCAL_KEYS = {
  authToken: 'authToken',
  connectedUser: 'connectedUser',
  connectedAt: 'connectedAt',
  lastUpload: 'lastUpload'
};

const DEFAULT_SUMMARY_PROMPT = '请基于以下转录文本智能生成一份总结，提炼关键信息和主要观点。使用清晰的结构化格式（例如标题、要点列表等），但不要使用任何分隔线或水平线。\n\n重要：使用与转录文本相同的语言。转录文本如果是中文则用中文总结，如果是英文则用英文总结。';

const MENU_IDS = {
  sendSelection: 'rc-send-selection',
  sendPage: 'rc-send-page',
  sendImage: 'rc-send-image',
  options: 'rc-options'
};

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU_IDS.options) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (info.menuItemId === MENU_IDS.sendSelection) {
    handleClipCommand('selection', tab, info).catch(() => {});
  }
  if (info.menuItemId === MENU_IDS.sendPage) {
    handleClipCommand('page', tab, info).catch(() => {});
  }
  if (info.menuItemId === MENU_IDS.sendImage) {
    handleClipCommand('image', tab, info).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'GET_STATE') return getState();
    if (message?.type === 'SAVE_CONFIG') return saveConfig(message.config || {});
    if (message?.type === 'CLEAR_TOKEN') return clearToken();
    if (message?.type === 'CONNECT_FROM_ACTIVE_TAB') return connectFromActiveTab();
    if (message?.type === 'SEND_SELECTION') return clipActiveTab('selection');
    if (message?.type === 'SEND_PAGE') return clipActiveTab('page');
    if (message?.type === 'TEST_CONNECTION') return testConnection();
    throw new Error(`Unknown message type: ${message?.type || '(empty)'}`);
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
  return true;
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.sendSelection,
      title: '发送选中文本到 Research Canvas',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.sendImage,
      title: '发送图片引用到 Research Canvas',
      contexts: ['image']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.sendPage,
      title: '发送本页文本到 Research Canvas',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_IDS.options,
      title: 'Research Canvas 设置',
      contexts: ['action']
    });
  });
}

async function clipActiveTab(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到当前标签页');
  return handleClipCommand(mode, tab, {});
}

async function handleClipCommand(mode, tab, info) {
  setBadge('...', '#475569');
  try {
    const clip = await collectClipFromTab(tab, mode, info);
    const uploadResult = await uploadClip(clip);
    setBadge('OK', '#16a34a');
    const warning = uploadResult.settingsWarning ? `；${uploadResult.settingsWarning}` : '';
    showPageToast(tab.id, `已发送到 Research Canvas: ${uploadResult.fileName || clip.title}${warning}`, 'success');
    return uploadResult;
  } catch (error) {
    setBadge('ERR', '#dc2626');
    showPageToast(tab.id, friendlyError(error), 'error');
    throw error;
  } finally {
    setTimeout(() => setBadge('', '#475569'), 3500);
  }
}

async function collectClipFromTab(tab, mode, info) {
  if (!tab.id || !/^https?:|^file:/.test(tab.url || '')) {
    throw new Error('当前页面不支持抓取。请在普通网页里选择内容后再试。');
  }

  const target = { tabId: tab.id };
  if (Number.isInteger(info?.frameId) && info.frameId >= 0) {
    target.frameIds = [info.frameId];
  }

  const [result] = await chrome.scripting.executeScript({
    target,
    func: collectClipInPage,
    args: [
      {
        mode,
        selectionText: info?.selectionText || '',
        srcUrl: info?.srcUrl || '',
        linkUrl: info?.linkUrl || '',
        pageUrl: info?.pageUrl || tab.url || ''
      }
    ]
  });

  const clip = result?.result;
  if (!clip) throw new Error('没有抓取到网页内容');
  if (!clip.text?.trim() && (!clip.images || clip.images.length === 0)) {
    throw new Error('没有抓取到选中文本或图片');
  }
  return clip;
}

function collectClipInPage(input) {
  const mode = input.mode || 'selection';
  const pageUrl = input.pageUrl || location.href;
  const title = document.title || pageUrl;
  const capturedAt = new Date().toISOString();

  function absoluteUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, document.baseURI || location.href).href;
    } catch {
      return value;
    }
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  function imagePayload(img, fallbackSrc) {
    const src = absoluteUrl(fallbackSrc || img?.currentSrc || img?.src || img?.getAttribute?.('src'));
    if (!src) return null;
    return {
      src,
      alt: img?.alt || img?.getAttribute?.('alt') || '',
      title: img?.title || img?.getAttribute?.('title') || '',
      width: Number(img?.naturalWidth || img?.width || 0) || null,
      height: Number(img?.naturalHeight || img?.height || 0) || null
    };
  }

  function uniqueImages(images) {
    const seen = new Set();
    return images.filter((image) => {
      if (!image?.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return true;
    }).slice(0, 30);
  }

  function selectedRanges() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
    const ranges = [];
    for (let i = 0; i < selection.rangeCount; i += 1) {
      ranges.push(selection.getRangeAt(i));
    }
    return ranges;
  }

  function rangeHtmlAndText(ranges) {
    const htmlParts = [];
    const textParts = [];
    for (const range of ranges) {
      const wrapper = document.createElement('div');
      wrapper.appendChild(range.cloneContents());
      htmlParts.push(wrapper.innerHTML);
      textParts.push(wrapper.textContent || '');
    }
    return {
      html: htmlParts.join('\n').trim(),
      text: cleanText(textParts.join('\n'))
    };
  }

  function imagesIntersecting(ranges) {
    if (!ranges.length) return [];
    const images = [];
    for (const img of Array.from(document.images || [])) {
      try {
        if (ranges.some((range) => range.intersectsNode(img))) {
          const payload = imagePayload(img);
          if (payload) images.push(payload);
        }
      } catch {
        // Some detached or cross-boundary nodes can throw. Ignore them.
      }
    }
    return uniqueImages(images);
  }

  function linksIntersecting(ranges) {
    if (!ranges.length) return [];
    const links = [];
    const seen = new Set();
    for (const anchor of Array.from(document.links || [])) {
      try {
        if (!ranges.some((range) => range.intersectsNode(anchor))) continue;
        const href = absoluteUrl(anchor.getAttribute('href'));
        if (!href || seen.has(href)) continue;
        seen.add(href);
        links.push({ href, text: cleanText(anchor.textContent || href).slice(0, 160) });
      } catch {
        // Ignore links that cannot be tested against the current range.
      }
    }
    return links.slice(0, 40);
  }

  if (mode === 'image') {
    const srcUrl = absoluteUrl(input.srcUrl);
    const matchedImage = Array.from(document.images || []).find((img) => {
      const candidates = [img.currentSrc, img.src, img.getAttribute('src')].map(absoluteUrl);
      return candidates.includes(srcUrl);
    });
    const image = imagePayload(matchedImage, srcUrl) || { src: srcUrl, alt: '', title: '', width: null, height: null };
    const images = uniqueImages([image]);
    return {
      mode,
      title,
      url: pageUrl,
      capturedAt,
      text: cleanText(input.selectionText || ''),
      html: '',
      images,
      links: input.linkUrl ? [{ href: absoluteUrl(input.linkUrl), text: '' }] : []
    };
  }

  if (mode === 'page') {
    const ogImage = document.querySelector('meta[property="og:image"], meta[name="twitter:image"]');
    const ogImageUrl = ogImage ? absoluteUrl(ogImage.getAttribute('content')) : '';
    const images = ogImageUrl
      ? [{ src: ogImageUrl, alt: 'Open Graph image', title: '', width: null, height: null }]
      : [];
    return {
      mode,
      title,
      url: pageUrl,
      capturedAt,
      text: cleanText(document.body?.innerText || document.documentElement?.innerText || ''),
      html: '',
      images,
      links: []
    };
  }

  const ranges = selectedRanges();
  const selected = rangeHtmlAndText(ranges);
  return {
    mode: 'selection',
    title,
    url: pageUrl,
    capturedAt,
    text: selected.text || cleanText(input.selectionText || ''),
    html: selected.html,
    images: imagesIntersecting(ranges),
    links: linksIntersecting(ranges)
  };
}

async function uploadClip(clip) {
  const state = await getState();
  const config = state.config;
  const token = state.authToken;
  if (!token) {
    throw new Error('还没有连接 Research Canvas。先打开已登录的 Research Canvas 标签页，再点扩展里的“连接当前标签页”。');
  }

  const apiBase = normalizeApiBase(config.appUrl);
  const text = buildClipText(clip, config);
  const enhancement = await loadAIEnhancement(apiBase, token, config);
  const payload = {
    text,
    sourceUrl: clip.url,
    sourceTitle: clip.title,
    ...enhancement.payload
  };

  const response = await fetchJsonWithRetry(`${apiBase}/transcriptions/from-text`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  });

  const transcription = response?.data || {};
  await chrome.storage.local.set({
    [LOCAL_KEYS.lastUpload]: {
      id: transcription.id,
      fileName: transcription.fileName,
      url: clip.url,
      uploadedAt: new Date().toISOString(),
      autoProcess: Boolean(enhancement.payload.customPrompt || enhancement.payload.metadataFillPrompt),
      settingsWarning: enhancement.warning || ''
    }
  });

  if (config.openAfterUpload) {
    chrome.tabs.create({ url: normalizeAppUrl(config.appUrl) });
  }

  return {
    id: transcription.id,
    fileName: transcription.fileName,
    status: transcription.status,
    settingsWarning: enhancement.warning || ''
  };
}

function buildClipText(clip, config) {
  const lines = [];
  lines.push(`标题：${clip.title || 'Untitled'}`);
  lines.push(`来源网页：${clip.url || ''}`);
  lines.push(`抓取时间：${formatDateTime(clip.capturedAt)}`);
  lines.push(`抓取方式：${clip.mode === 'page' ? '整页文本' : clip.mode === 'image' ? '图片引用' : '网页选区'}`);
  lines.push('');

  if (clip.text?.trim()) {
    lines.push('正文：');
    lines.push(truncateText(clip.text.trim(), Number(config.maxTextChars) || DEFAULT_CONFIG.maxTextChars));
    lines.push('');
  }

  if (config.includeImages && Array.isArray(clip.images) && clip.images.length > 0) {
    lines.push('图片：');
    for (const [index, image] of clip.images.entries()) {
      const alt = image.alt || image.title || `image-${index + 1}`;
      lines.push(`${index + 1}. ![${escapeMarkdown(alt)}](${image.src})`);
      const meta = [
        image.alt ? `alt=${image.alt}` : '',
        image.title ? `title=${image.title}` : '',
        image.width && image.height ? `${image.width}x${image.height}` : ''
      ].filter(Boolean).join('；');
      if (meta) lines.push(`   ${meta}`);
    }
    lines.push('');
  }

  if (config.includeLinks && Array.isArray(clip.links) && clip.links.length > 0) {
    lines.push('选区链接：');
    for (const [index, link] of clip.links.entries()) {
      lines.push(`${index + 1}. ${link.text || link.href} - ${link.href}`);
    }
    lines.push('');
  }

  if (config.includeHtml && clip.html?.trim()) {
    lines.push('选区 HTML：');
    lines.push('```html');
    lines.push(truncateText(clip.html.trim(), 50000));
    lines.push('```');
  }

  return lines.join('\n').trim();
}

async function loadAIEnhancement(apiBase, token, config) {
  if (!config.autoProcess) return { payload: {} };
  try {
    const settings = await fetchJsonWithRetry(`${apiBase}/ai/settings?revealKeys=1`, {
      method: 'GET',
      headers: authHeaders(token, false)
    }, { retries: 1, timeoutMs: 45000 });

    const keys = settings?.keys || {};
    const apiConfig = settings?.apiConfig || {};
    const metadataFillPrompt = await fillMetadataPrompt(apiBase, token, settings?.metadataFillPrompt || '');
    const payload = {
      providerKeys: keys,
      geminiApiKey: keys.google || keys.gemini || undefined,
      customPrompt: settings?.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
      metadataFillPrompt: metadataFillPrompt || undefined,
      summaryModel: apiConfig.summaryModel || settings?.defaultModel || undefined
    };

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined || payload[key] === '') delete payload[key];
    }
    return { payload };
  } catch (error) {
    return {
      payload: {},
      warning: `已上传原文，但没有自动总结/元数据：${friendlyError(error)}`
    };
  }
}

async function fillMetadataPrompt(apiBase, token, prompt) {
  if (!prompt) return '';
  if (!prompt.includes('{industryOptions}') && !prompt.includes('{sampleCompanies}')) return prompt;

  let industryOptions = '其他';
  try {
    const categoryData = await fetchJsonWithRetry(`${apiBase}/industry-categories`, {
      method: 'GET',
      headers: authHeaders(token, false)
    }, { retries: 0, timeoutMs: 20000 });
    const categories = Array.isArray(categoryData?.categories) ? categoryData.categories : [];
    const subCategories = categories.flatMap((category) => Array.isArray(category.subCategories) ? category.subCategories : []);
    if (subCategories.length > 0) industryOptions = subCategories.join('、');
  } catch {
    // Keep the fallback category list.
  }

  return prompt
    .replace('{industryOptions}', industryOptions)
    .replace('{sampleCompanies}', '');
}

async function connectFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到当前标签页');
  if (!/^https?:\/\/|^http:\/\/localhost|^http:\/\/127\.0\.0\.1/.test(tab.url || '')) {
    throw new Error('请先打开已登录的 Research Canvas 网页标签页');
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: readResearchCanvasSession
  });

  const session = result?.result;
  if (!session?.token) {
    throw new Error('当前标签页没有找到 Research Canvas 登录 token。请确认已经登录 Research Canvas。');
  }

  await chrome.storage.local.set({
    [LOCAL_KEYS.authToken]: session.token,
    [LOCAL_KEYS.connectedUser]: session.user || null,
    [LOCAL_KEYS.connectedAt]: new Date().toISOString()
  });
  await saveConfig({ appUrl: session.origin || normalizeAppUrl((await getConfig()).appUrl) });
  await ensureHostPermission(normalizeApiBase(session.origin || (await getConfig()).appUrl));
  setBadge('ON', '#2563eb');
  setTimeout(() => setBadge('', '#2563eb'), 2500);
  return getState();
}

function readResearchCanvasSession() {
  function parse(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  const stored = parse(localStorage.getItem('rc_auth_user'));
  const token =
    stored?._credential ||
    stored?.sessionToken ||
    localStorage.getItem('auth_token') ||
    '';

  return {
    token,
    origin: location.origin,
    user: stored ? {
      email: stored.email || '',
      name: stored.name || '',
      googleId: stored.googleId || ''
    } : null
  };
}

async function testConnection() {
  const state = await getState();
  const token = state.authToken;
  if (!token) throw new Error('还没有连接 Research Canvas');
  const apiBase = normalizeApiBase(state.config.appUrl);
  const health = await fetchJsonWithRetry(`${apiBase}/health`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  }, { retries: 1, timeoutMs: 20000 });
  const list = await fetchJsonWithRetry(`${apiBase}/transcriptions?page=1&pageSize=1`, {
    method: 'GET',
    headers: authHeaders(token, false)
  }, { retries: 1, timeoutMs: 45000 });
  return {
    apiBase,
    health: health?.status || health?.message || 'ok',
    authenticated: Boolean(list?.success)
  };
}

async function getState() {
  const config = await getConfig();
  const local = await chrome.storage.local.get(Object.values(LOCAL_KEYS));
  return {
    config,
    authToken: local[LOCAL_KEYS.authToken] || '',
    connectedUser: local[LOCAL_KEYS.connectedUser] || null,
    connectedAt: local[LOCAL_KEYS.connectedAt] || '',
    lastUpload: local[LOCAL_KEYS.lastUpload] || null
  };
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    appUrl: normalizeAppUrl(stored.appUrl || DEFAULT_CONFIG.appUrl)
  };
}

async function saveConfig(configPatch) {
  const next = {};
  for (const [key, value] of Object.entries(configPatch || {})) {
    if (!(key in DEFAULT_CONFIG)) continue;
    next[key] = key === 'appUrl' ? normalizeAppUrl(value) : value;
  }
  if (next.appUrl) await ensureHostPermission(normalizeApiBase(next.appUrl));
  await chrome.storage.sync.set(next);
  return getState();
}

async function clearToken() {
  await chrome.storage.local.remove([
    LOCAL_KEYS.authToken,
    LOCAL_KEYS.connectedUser,
    LOCAL_KEYS.connectedAt
  ]);
  return getState();
}

async function ensureHostPermission(apiBase) {
  try {
    const pattern = originPattern(apiBase);
    const hasPermission = await chrome.permissions.contains({ origins: [pattern] });
    if (!hasPermission) {
      await chrome.permissions.request({ origins: [pattern] });
    }
  } catch {
    // Permission request can be ignored when not triggered by a user gesture.
  }
}

function authHeaders(token, json = true) {
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Auth-Token': token
  };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

async function fetchJsonWithRetry(url, options = {}, controls = {}) {
  const retries = Number.isInteger(controls.retries) ? controls.retries : 2;
  const timeoutMs = controls.timeoutMs || 120000;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        const body = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
        const message = body?.error || body?.message || `${response.status} ${response.statusText}`;
        const error = new Error(message);
        error.status = response.status;
        if ([502, 503, 504].includes(response.status) && attempt < retries) {
          lastError = error;
          await delay((attempt + 1) * 2500);
          continue;
        }
        throw error;
      }
      return response.json().catch(() => ({}));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries && (error.name === 'AbortError' || !error.status || [502, 503, 504].includes(error.status))) {
        await delay((attempt + 1) * 2500);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAppUrl(value) {
  const raw = String(value || DEFAULT_CONFIG.appUrl).trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_CONFIG.appUrl;
  if (raw.endsWith('/api')) return raw.slice(0, -4);
  return raw;
}

function normalizeApiBase(value) {
  const raw = normalizeAppUrl(value);
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

function originPattern(apiBase) {
  const url = new URL(apiBase);
  return `${url.protocol}//${url.host}/*`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toLocaleString('zh-CN', { hour12: false });
}

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text || '';
  return `${text.slice(0, maxChars)}\n\n[内容已截断：原始长度 ${text.length} 字符，当前保留 ${maxChars} 字符]`;
}

function escapeMarkdown(value) {
  return String(value || '').replace(/[[\]()`]/g, '\\$&').replace(/\n/g, ' ');
}

function friendlyError(error) {
  const message = error?.message || String(error || '未知错误');
  if (error?.status === 401) return 'Research Canvas 登录已过期，请重新连接当前标签页。';
  if (error?.name === 'AbortError') return '请求超时，请稍后重试。';
  return message;
}

function setBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

function showPageToast(tabId, message, type) {
  if (!tabId) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: (text, toastType) => {
      const old = document.getElementById('__rc_clipper_toast');
      if (old) old.remove();
      const el = document.createElement('div');
      el.id = '__rc_clipper_toast';
      el.textContent = text;
      Object.assign(el.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: 2147483647,
        maxWidth: '360px',
        padding: '10px 12px',
        borderRadius: '8px',
        font: '13px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        color: toastType === 'error' ? '#7f1d1d' : '#064e3b',
        background: toastType === 'error' ? '#fee2e2' : '#dcfce7',
        border: `1px solid ${toastType === 'error' ? '#fecaca' : '#bbf7d0'}`,
        boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)'
      });
      document.documentElement.appendChild(el);
      window.setTimeout(() => el.remove(), 4200);
    },
    args: [message, type]
  }).catch(() => {});
}
