// v2026.03.30 - nodeCount excludes isMain nodes
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createProxyMiddleware } from 'http-proxy-middleware';
import http from 'http';

const app = express();

// ─── Global request logger (debug) ──────────────────────────────
app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.includes('canvas') || req.path.includes('move')) {
        console.log(`[0] 📥 ${req.method} ${req.path} (url: ${req.url})`);
    }
    next();
});

// ─── AI Process API Proxy ──────────────────────────────────────
// pathFilter 用 Function（而非字符串/glob），确保 v3 下可靠转发
const aiPrefixes = [
    '/api/transcriptions',
    '/api/projects',
    '/api/knowledge-base',
    '/api/translation',
    '/api/share',
    '/api/wechat-work',
    '/api/upload',
    '/api/backup',
    '/api/portfolio',
    '/api/feed',
    '/api/user'
];
app.use(createProxyMiddleware({
    target: 'http://localhost:8081',
    changeOrigin: true,
    timeout: 120000,       // proxy → backend: 120s（翻译、音频处理等耗时操作）
    proxyTimeout: 120000,  // backend → proxy: 120s
    pathFilter: (path) => {
        const matched = aiPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?'));
        if (path.includes('canvas') || path.includes('move')) {
            console.log(`[0] 🔍 Proxy pathFilter: path="${path}" matched=${matched}`);
        }
        return matched;
    },
    on: {
        error: (err, req, res) => {
            console.error(`⚠️ Proxy error for ${req.method} ${req.url}:`, err.message);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: `Proxy error: ${err.message}` }));
            }
        },
    },
}));

app.use(cors());
app.use(express.json({ limit: '200mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const GOOGLE_CLIENT_ID = '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Session JWT secret — generated once per server start (or use env var for persistence across restarts)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SESSION_EXPIRY = '7d'; // 7 days

// ─── Allowed Users Whitelist ─────────────────────────────────
// Only these Google accounts can log in. Add emails here to grant access.
const ALLOWED_EMAILS = new Set((process.env.ALLOWED_EMAILS || 'chengjiaqi1995@gmail.com,catherinefkd@gmail.com').split(',').map(e => e.trim().toLowerCase()));

// ─── Auth Login Route (exchange Google token for session token) ───
app.post('/api/auth/login', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Missing Google credential' });
    }
    try {
        const ticket = await oauthClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        // ── Whitelist check ──
        const email = (payload.email || '').toLowerCase();
        if (!ALLOWED_EMAILS.has(email)) {
            console.warn(`🚫 Login blocked: ${email} (not in whitelist)`);
            return res.status(403).json({ error: '该账号未获授权，请联系管理员' });
        }

        const sessionToken = jwt.sign(
            { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture },
            JWT_SECRET,
            { expiresIn: SESSION_EXPIRY }
        );
        console.log(`✅ Login: ${email}`);
        res.json({ token: sessionToken });
    } catch (err) {
        console.error('Google token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

// ─── Auth Middleware (verify session JWT) ───────────────────
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.userId = payload.sub;
        req.userEmail = payload.email;
        next();
    } catch (err) {
        console.error('Token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

app.use('/api', (req, res, next) => {
    // Skip auth for login, rebuild-industries, and health check
    if (req.path === '/auth/login' || req.path === '/rebuild-industries' || req.path === '/health') return next();
    const authHeader = req.headers.authorization;
    // OpenClaw API key: 映射到 Jiaqi 的真实 Google 账号
    const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || 'oc-api-jiaqi-2026-f8a3b7c1d9e2';
    const OPENCLAW_USER_ID = process.env.OPENCLAW_USER_ID || '104921709359061938941';
    if (authHeader === `Bearer ${OPENCLAW_API_KEY}`) {
        req.userId = OPENCLAW_USER_ID;
        req.userEmail = 'jiaqi@openclaw';
        return next();
    }
    // Local dev: skip auth when token is 'dev-token'
    if (authHeader === 'Bearer dev-token') {
        req.userId = 'dev-local';
        req.userEmail = 'dev@localhost';
        return next();
    }
    authenticate(req, res, next);
});

// ─── One-time Migration Endpoint ───
app.get('/api/migrate', async (req, res) => {
    try {
        const userId = req.userId;
        const workspaces = await readIndex(userId, 'workspaces');
        let canvases = await readIndex(userId, 'canvases');

        const subFolders = workspaces.filter(w => w.parentId);
        if (subFolders.length === 0) {
            return res.json({ message: 'No subfolders found to migrate.' });
        }

        let newWorkspaces = workspaces.filter(w => !w.parentId);
        let migratedCount = 0;

        for (const sub of subFolders) {
            const children = canvases.filter(c => c.workspaceId === sub.id);
            if (children.length === 0) {
                // Create empty canvas for this subfolder
                const newCanvasId = `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const newCanvasMeta = {
                    id: newCanvasId,
                    title: sub.name,
                    workspaceId: sub.parentId,
                    createdAt: sub.createdAt || Date.now(),
                    updatedAt: sub.updatedAt || Date.now(),
                    nodeCount: 0
                };
                canvases.push(newCanvasMeta);
                // We should also initialize the node bundle
                await writeJSON(`${userId}/canvas-data/${newCanvasId}.json`, {});
            } else if (children.length === 1) {
                // Move and rename
                const idx = canvases.findIndex(c => c.id === children[0].id);
                if (idx >= 0) {
                    canvases[idx].workspaceId = sub.parentId;
                    canvases[idx].title = sub.name;
                }
            } else {
                // Multiple
                for (const child of children) {
                    const idx = canvases.findIndex(c => c.id === child.id);
                    if (idx >= 0) {
                        canvases[idx].workspaceId = sub.parentId;
                        canvases[idx].title = `${sub.name} - ${child.title}`;
                    }
                }
            }
            migratedCount++;
        }

        // Save everything
        await writeIndex(userId, 'workspaces', newWorkspaces);
        await writeIndex(userId, 'canvases', canvases);

        // Clear caches just in case
        invalidateUserCache(userId);

        res.json({ message: `Successfully migrated ${migratedCount} subfolders to canvases.` });
    } catch (e) {
        console.error('Migration failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─── Bulk Rebuild Industries Endpoint ───
app.post('/api/rebuild-industries', async (req, res) => {
    try {
        const { categoryMap, companiesMap, specialFolders, userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });

        let workspaces = await readIndex(userId, 'workspaces');
        let canvases = await readIndex(userId, 'canvases');

        // 1. Delete old Industry workspaces & their canvases
        const oldIndustryWsIds = new Set(workspaces.filter(w => !w.category || w.category === 'industry').map(w => w.id));

        const deletePromises = [];
        const canvasesToDelete = canvases.filter(c => oldIndustryWsIds.has(c.workspaceId) || !c.workspaceId);
        for (const c of canvasesToDelete) {
            deletePromises.push(deleteByPrefix(`${userId}/canvas-data/${c.id}/`));
            deletePromises.push(deleteFile(`${userId}/canvases/${c.id}.json`));
        }
        canvases = canvases.filter(c => !oldIndustryWsIds.has(c.workspaceId) && !!c.workspaceId);

        for (const wid of oldIndustryWsIds) {
            deletePromises.push(deleteFile(`${userId}/workspaces/${wid}.json`));
        }
        await Promise.all(deletePromises);
        workspaces = workspaces.filter(w => w.category === 'overall' || w.category === 'personal');

        // 2. Rebuild
        const now = Date.now();
        const writePromises = [];

        for (const category of categoryMap) {
            for (const sub of category.subCategories) {
                // Create Workspace
                const wsId = `ws-${now}-${Math.random().toString(36).slice(2, 8)}`;
                const ws = { id: wsId, name: sub, icon: category.icon || '📁', category: 'industry', createdAt: now, updatedAt: now };
                workspaces.push(ws);
                writePromises.push(writeJSON(`${userId}/workspaces/${wsId}.json`, ws));

                // Create Special Folders
                for (const sf of specialFolders) {
                    const cid = `canvas-${now}-${Math.random().toString(36).slice(2, 8)}`;
                    const cv = { id: cid, title: sf, workspaceId: wsId, createdAt: now, updatedAt: now, nodeCount: 0 };
                    canvases.push(cv);
                    writePromises.push(writeJSON(`${userId}/canvases/${cid}.json`, { ...cv, nodes: [] }));
                    writePromises.push(writeJSON(`${userId}/canvas-data/${cid}.json`, {}));
                }

                // Create Companies
                const companies = companiesMap[sub] || [];
                for (const comp of companies) {
                    const cid = `canvas-${now}-${Math.random().toString(36).slice(2, 8)}`;
                    const cv = { id: cid, title: comp, workspaceId: wsId, createdAt: now, updatedAt: now, nodeCount: 0 };
                    canvases.push(cv);
                    writePromises.push(writeJSON(`${userId}/canvases/${cid}.json`, { ...cv, nodes: [] }));
                    writePromises.push(writeJSON(`${userId}/canvas-data/${cid}.json`, {}));
                }
            }
        }
        await Promise.all(writePromises);

        // Save indexes
        await writeIndex(userId, 'workspaces', workspaces);
        await writeIndex(userId, 'canvases', canvases);
        invalidateUserCache(userId);

        res.json({ ok: true, message: 'Rebuild complete' });
    } catch (e) {
        console.error('Rebuild failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// ─── GCS Storage Layer ─────────────────────────────────────
const PROJECT_ID = 'gen-lang-client-0634831802';
const VERTEX_LOCATION = 'us-central1';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const UPLOAD_BUCKET = `${PROJECT_ID}-uploads-asia`;

let storage;
try {
    const { Storage } = await import('@google-cloud/storage');
    storage = new Storage();
} catch (err) {
    console.warn('Google Cloud Storage not available:', err.message);
}

let _bucket = null;
async function getBucket() {
    if (_bucket) return _bucket;
    if (!storage) throw new Error('Storage not initialized');
    const bucket = storage.bucket(UPLOAD_BUCKET);
    try {
        const [exists] = await bucket.exists();
        if (!exists) {
            await bucket.create({ location: 'asia-southeast1' });
        }
    } catch (e) {
        console.warn('Bucket check/create failed:', e.message);
    }
    _bucket = bucket;
    return _bucket;
}

// ─── GCS Helper Functions & Cache ─────────────────────────

const jsonCache = new Map();

async function readJSON(path) {
    if (jsonCache.has(path)) return jsonCache.get(path);
    const bucket = await getBucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    const data = JSON.parse(content.toString());
    
    // Prevent unbound memory growth by dropping oldest 10% when hitting 2000 items
    if (jsonCache.size > 2000) {
        const keysToDelete = Array.from(jsonCache.keys()).slice(0, 200);
        keysToDelete.forEach(k => jsonCache.delete(k));
    }
    jsonCache.set(path, data);
    return data;
}

async function writeJSON(path, data) {
    jsonCache.set(path, data);
    const bucket = await getBucket();
    const file = bucket.file(path);
    await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        resumable: false,
    });
}

async function deleteFile(path) {
    jsonCache.delete(path);
    const bucket = await getBucket();
    await bucket.file(path).delete({ ignoreNotFound: true });
}

async function deleteByPrefix(prefix) {
    for (const key of jsonCache.keys()) {
        if (key.startsWith(prefix)) jsonCache.delete(key);
    }
    const bucket = await getBucket();
    await bucket.deleteFiles({ prefix, force: true });
}

async function listJSONFiles(prefix) {
    const bucket = await getBucket();
    const [files] = await bucket.getFiles({ prefix });
    const results = await Promise.all(
        files
            .filter(f => f.name.endsWith('.json'))
            .map(async (f) => {
                try {
                    const [content] = await f.download();
                    return JSON.parse(content.toString());
                } catch {
                    return null;
                }
            })
    );
    return results.filter(Boolean);
}

// ─── In-Memory Cache ───────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 60_000; // 60 seconds

function getCached(key) {
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.t < CACHE_TTL) return entry.d;
    return null;
}

function setCache(key, data) {
    _cache.set(key, { d: data, t: Date.now() });
}

function invalidateUserCache(userId) {
    for (const key of _cache.keys()) {
        if (key.startsWith(userId)) _cache.delete(key);
    }
}

// ─── Index File Helpers ────────────────────────────────────
// Index files store all metadata in a single JSON array,
// so listing operations only require 1 GCS read, regardless of data volume.

async function readIndex(userId, type) {
    // type = 'workspaces' or 'canvases'
    const cacheKey = `${userId}/${type}-index`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    const data = await readJSON(`${userId}/${type}-index.json`) || [];
    setCache(cacheKey, data);
    return data;
}

async function writeIndex(userId, type, items) {
    await writeJSON(`${userId}/${type}-index.json`, items);
    setCache(`${userId}/${type}-index`, items);
}

async function upsertIndex(userId, type, item, idField = 'id') {
    const items = await readIndex(userId, type);
    const idx = items.findIndex(i => i[idField] === item[idField]);
    if (idx >= 0) items[idx] = item;
    else items.push(item);
    await writeIndex(userId, type, items);
}

async function removeFromIndex(userId, type, id, idField = 'id') {
    const items = await readIndex(userId, type);
    const filtered = items.filter(i => i[idField] !== id);
    await writeIndex(userId, type, filtered);
}

// Extract lightweight canvas metadata for index (no nodes/edges detail)
function canvasMetaForIndex(canvas) {
    return {
        id: canvas.id,
        title: canvas.title,
        workspaceId: canvas.workspaceId,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        nodeCount: canvas.nodes?.filter(n => !n.isMain)?.length || 0,
    };
}

// ─── Node Data Offload/Hydrate ─────────────────────────────
// All node data for a canvas is stored in a SINGLE bundled file:
//   {userId}/canvas-data/{canvasId}.json  →  { nodeId1: data1, nodeId2: data2, ... }
// This means loading a canvas = 2 GCS reads (metadata + node bundle),
// regardless of how many nodes exist.

async function offloadNodeData(nodes, userId, canvasId) {
    if (!nodes || !Array.isArray(nodes)) return;

    // Read existing bundle first to preserve data of nodes not in this update
    const bundlePath = `${userId}/canvas-data/${canvasId}.json`;
    const existingBundle = await readJSON(bundlePath) || {};

    const newBundle = { ...existingBundle };
    for (const node of nodes) {
        if (node.data) {
            newBundle[node.id] = node.data;
            delete node.data;
        }
    }

    // Clean up: remove entries for nodes that no longer exist in the canvas
    const nodeIds = new Set(nodes.map(n => n.id));
    for (const key of Object.keys(newBundle)) {
        if (!nodeIds.has(key)) delete newBundle[key];
    }

    if (Object.keys(newBundle).length > 0) {
        await writeJSON(bundlePath, newBundle);
    }
}

async function hydrateNodeData(nodes, userId, canvasId) {
    if (!nodes || !Array.isArray(nodes)) return;
    // Try new bundled format first
    const bundle = await readJSON(`${userId}/canvas-data/${canvasId}.json`);
    if (bundle) {
        for (const node of nodes) {
            if (bundle[node.id]) {
                node.data = bundle[node.id];
            } else if (!node.data) {
                node.data = { type: 'text', title: '', content: '' };
            }
        }
        return;
    }
    // Fallback: old per-node format (backward compat)
    await Promise.all(nodes.map(async (node) => {
        if (node._dataRef) {
            try {
                node.data = await readJSON(node._dataRef);
                delete node._dataRef;
            } catch (e) {
                console.error(`Failed to load node data for ${node.id}:`, e.message);
                if (!node.data) node.data = { type: 'text', title: '(数据加载失败)', content: '' };
            }
        }
    }));
}

// ─── Workspace Routes ──────────────────────────────────────
app.get('/api/workspaces', async (req, res) => {
    try {
        const workspaces = await readIndex(req.userId, 'workspaces');
        workspaces.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        res.json(workspaces);
    } catch (err) {
        console.error('GET /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Industry Categories (user-configurable) ──────────────
app.get('/api/industry-categories', async (req, res) => {
    try {
        const data = await readJSON(`${req.userId}/industry-categories.json`);
        res.json(data || null);
    } catch {
        res.json(null);
    }
});

app.put('/api/industry-categories', async (req, res) => {
    try {
        const config = req.body;
        config.updatedAt = Date.now();
        await writeJSON(`${req.userId}/industry-categories.json`, config);
        invalidateUserCache(req.userId);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/industry-categories error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Industry Wiki Data (user-configurable) ──────────────
app.get('/api/industry-wiki', async (req, res) => {
    try {
        const data = await readJSON(`${req.userId}/industry-wiki.json`);
        res.json(data || null);
    } catch {
        res.json(null);
    }
});

app.put('/api/industry-wiki', async (req, res) => {
    try {
        const config = req.body;
        config.updatedAt = Date.now();
        await writeJSON(`${req.userId}/industry-wiki.json`, config);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/industry-wiki error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Industry Wiki Bundles (per-industry storage) ────────
// Layout:
//   {userId}/wiki-settings.json          — global config (page types, multi-scope rules, lint, industryConfigs)
//   {userId}/wiki-bundles-index.json     — [{industry, articleCount, updatedAt}]
//   {userId}/wiki-bundles/{industry}.json — { industry, articles, actions, updatedAt }
// Bundle filenames use encodeURIComponent(industry) for safety. Articles inside a bundle may have
// sub-scope industryCategory like "铝::公司A" but are grouped by the top-level "铝".

const wikiSettingsPath = (userId) => `${userId}/wiki-settings.json`;
const wikiIndexFilePath = (userId) => `${userId}/wiki-bundles-index.json`;
const wikiBundleFilePath = (userId, industry) =>
    `${userId}/wiki-bundles/${encodeURIComponent(industry)}.json`;
const oldWikiBlobPath = (userId) => `${userId}/industry-wiki.json`;

function topLevelIndustry(industryCategory) {
    if (!industryCategory || typeof industryCategory !== 'string') return '__uncategorized';
    const top = industryCategory.split('::')[0].trim();
    return top || '__uncategorized';
}

// Lazy migration helpers: if new layout file absent, derive from old single blob.
async function lazyReadWikiSettings(userId) {
    const existing = await readJSON(wikiSettingsPath(userId));
    if (existing) return existing;
    const old = await readJSON(oldWikiBlobPath(userId));
    if (!old) return null;
    return {
        wikiPageTypes: old.wikiPageTypes || '',
        wikiMultiScopeRules: old.wikiMultiScopeRules || '',
        wikiLintDimensions: old.wikiLintDimensions || '',
        industryConfigs: old.industryConfigs || {},
        updatedAt: old.updatedAt || 0,
    };
}

async function lazyReadWikiIndex(userId) {
    const existing = await readJSON(wikiIndexFilePath(userId));
    if (existing) return existing;
    const old = await readJSON(oldWikiBlobPath(userId));
    if (!old || !Array.isArray(old.articles)) return [];
    const groups = new Map();
    for (const a of old.articles) {
        const top = topLevelIndustry(a.industryCategory);
        const g = groups.get(top) || { industry: top, articleCount: 0, updatedAt: 0 };
        g.articleCount++;
        g.updatedAt = Math.max(g.updatedAt, a.updatedAt || a.createdAt || 0);
        groups.set(top, g);
    }
    return Array.from(groups.values());
}

async function lazyReadWikiBundle(userId, industry) {
    const existing = await readJSON(wikiBundleFilePath(userId, industry));
    if (existing) return existing;
    const old = await readJSON(oldWikiBlobPath(userId));
    if (!old) return null;
    const articles = (old.articles || []).filter(
        (a) => topLevelIndustry(a.industryCategory) === industry
    );
    const actions = (old.actions || []).filter(
        (a) => topLevelIndustry(a.industryCategory) === industry
    );
    if (articles.length === 0 && actions.length === 0) return null;
    return { industry, articles, actions, updatedAt: old.updatedAt || Date.now() };
}

async function upsertWikiIndexEntry(userId, industry, bundle) {
    const index = (await readJSON(wikiIndexFilePath(userId))) || (await lazyReadWikiIndex(userId));
    const entry = {
        industry,
        articleCount: Array.isArray(bundle.articles) ? bundle.articles.length : 0,
        updatedAt: bundle.updatedAt || Date.now(),
    };
    const idx = index.findIndex((e) => e.industry === industry);
    if (idx >= 0) index[idx] = entry;
    else index.push(entry);
    await writeJSON(wikiIndexFilePath(userId), index);
}

async function removeWikiIndexEntry(userId, industry) {
    const index = (await readJSON(wikiIndexFilePath(userId))) || (await lazyReadWikiIndex(userId));
    const filtered = index.filter((e) => e.industry !== industry);
    await writeJSON(wikiIndexFilePath(userId), filtered);
}

// GET global wiki settings (lazy-migrated from old blob on first read if absent).
app.get('/api/wiki-settings', async (req, res) => {
    try {
        const data = await lazyReadWikiSettings(req.userId);
        res.json(data || null);
    } catch (err) {
        console.error('GET /api/wiki-settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/wiki-settings', async (req, res) => {
    try {
        const body = req.body || {};
        const payload = {
            wikiPageTypes: body.wikiPageTypes || '',
            wikiMultiScopeRules: body.wikiMultiScopeRules || '',
            wikiLintDimensions: body.wikiLintDimensions || '',
            industryConfigs: body.industryConfigs || {},
            updatedAt: Date.now(),
        };
        await writeJSON(wikiSettingsPath(req.userId), payload);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/wiki-settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET industry index — used by client to know what bundles exist.
app.get('/api/wiki-index', async (req, res) => {
    try {
        const data = await lazyReadWikiIndex(req.userId);
        res.json(data);
    } catch (err) {
        console.error('GET /api/wiki-index error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET single industry bundle (lazy-migrated).
app.get('/api/wiki-bundle/:industry', async (req, res) => {
    try {
        const industry = decodeURIComponent(req.params.industry);
        const bundle = await lazyReadWikiBundle(req.userId, industry);
        res.json(bundle || null);
    } catch (err) {
        console.error('GET /api/wiki-bundle error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT single industry bundle. Body = { articles, actions }. Server stamps updatedAt + updates index.
app.put('/api/wiki-bundle/:industry', async (req, res) => {
    try {
        const industry = decodeURIComponent(req.params.industry);
        const body = req.body || {};
        const articles = Array.isArray(body.articles) ? body.articles : [];
        const actions = Array.isArray(body.actions) ? body.actions : [];

        // Defensive: reject if any article's top-level industry mismatches the bundle.
        // (Warning only; we still store — this helps surface client bugs early.)
        for (const a of articles) {
            const top = topLevelIndustry(a.industryCategory);
            if (top !== industry) {
                console.warn(
                    `[wiki-bundle] article ${a.id} has industryCategory="${a.industryCategory}" ` +
                    `but bundle is "${industry}" — storing anyway`
                );
            }
        }

        const bundle = {
            industry,
            articles,
            actions,
            updatedAt: Date.now(),
        };
        await writeJSON(wikiBundleFilePath(req.userId, industry), bundle);
        await upsertWikiIndexEntry(req.userId, industry, bundle);
        res.json({ ok: true, updatedAt: bundle.updatedAt });
    } catch (err) {
        console.error('PUT /api/wiki-bundle error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE single industry bundle (also removes from index).
app.delete('/api/wiki-bundle/:industry', async (req, res) => {
    try {
        const industry = decodeURIComponent(req.params.industry);
        await deleteFile(wikiBundleFilePath(req.userId, industry));
        await removeWikiIndexEntry(req.userId, industry);
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/wiki-bundle error:', err);
        res.status(500).json({ error: err.message });
    }
});

// One-shot eager migration: split old {userId}/industry-wiki.json into per-industry bundles
// + wiki-settings.json + wiki-bundles-index.json. Idempotent. Old blob is NOT deleted.
// Call with POST /api/migrate/split-wiki-bundles (optionally ?dry=1 to preview).
app.post('/api/migrate/split-wiki-bundles', async (req, res) => {
    try {
        const userId = req.userId;
        const dry = req.query.dry === '1' || req.query.dry === 'true';
        const old = await readJSON(oldWikiBlobPath(userId));
        if (!old) {
            return res.json({ ok: true, message: 'No old industry-wiki.json to migrate.' });
        }

        // Build settings
        const settings = {
            wikiPageTypes: old.wikiPageTypes || '',
            wikiMultiScopeRules: old.wikiMultiScopeRules || '',
            wikiLintDimensions: old.wikiLintDimensions || '',
            industryConfigs: old.industryConfigs || {},
            updatedAt: old.updatedAt || Date.now(),
        };

        // Group articles + actions by top-level industry
        const groups = new Map(); // industry -> { articles, actions }
        for (const a of old.articles || []) {
            const top = topLevelIndustry(a.industryCategory);
            const g = groups.get(top) || { articles: [], actions: [] };
            g.articles.push(a);
            groups.set(top, g);
        }
        for (const log of old.actions || []) {
            const top = topLevelIndustry(log.industryCategory);
            const g = groups.get(top) || { articles: [], actions: [] };
            g.actions.push(log);
            groups.set(top, g);
        }

        const summary = {
            settingsBytes: JSON.stringify(settings).length,
            bundles: [],
        };
        for (const [industry, g] of groups.entries()) {
            summary.bundles.push({
                industry,
                articles: g.articles.length,
                actions: g.actions.length,
            });
        }

        if (dry) {
            return res.json({ ok: true, dryRun: true, summary });
        }

        // Write settings
        await writeJSON(wikiSettingsPath(userId), settings);

        // Write each bundle + build index
        const index = [];
        for (const [industry, g] of groups.entries()) {
            const bundle = {
                industry,
                articles: g.articles,
                actions: g.actions,
                updatedAt: Date.now(),
            };
            await writeJSON(wikiBundleFilePath(userId, industry), bundle);
            index.push({
                industry,
                articleCount: g.articles.length,
                updatedAt: bundle.updatedAt,
            });
        }
        await writeJSON(wikiIndexFilePath(userId), index);

        res.json({ ok: true, summary });
    } catch (err) {
        console.error('POST /api/migrate/split-wiki-bundles error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Wiki LLM tool-use (Phase 2: Claude-Code style ingest) ───
// Design: the LLM is given a handful of tools for reading and writing wiki articles.
// Each tool call is executed server-side against the per-industry bundle files
// (created in Phase 1). No XML DSL parsing on the server side — the model either
// emits a functionCall or plain text, and we loop until `finish` is called (or max
// rounds hit). Every mutating tool call persists to GCS immediately and appends an
// action log to the affected bundle, so there is no "end-of-run batch apply" step
// that can silently lose articles.
//
// Tools (scope = industry or "industry::entity" sub-scope):
//   list_articles({scope?}) → [{id, title, summary, updatedAt, industryCategory}]
//   read_article({id})      → {id, title, content, summary, industryCategory, tags}
//   create_article({scope, title, content, summary?, tags?}) → {id}
//   write_article({id, content, title?, summary?})           → {ok}    // full replace
//   edit_article({id, old_string, new_string, expected_occurrences?}) → {ok}
//         Universal string-replace primitive. Claude-Code / str_replace_editor /
//         Aider SEARCH/REPLACE style. `old_string` MUST match the article content
//         verbatim (including whitespace). On no-match we return the top-3 near
//         candidates so the model can try again with better context.
//   finish({note?}) — signals the LLM is done; loop exits.
//
// Tools are defined once in Gemini `functionDeclarations` shape; a small adapter maps
// the same shapes to the OpenAI `tools` format for Qwen/DashScope (Phase 2c).

const WIKI_TOOL_DECLS = [
    {
        name: 'list_articles',
        description:
            'List existing wiki articles under a scope. Returns compact summaries (no full content). ' +
            'Use this first to see what is already in the wiki, then read_article to fetch full content ' +
            'only for articles you intend to update.',
        parameters: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string',
                    description:
                        'Optional scope filter. Either a top-level industry (e.g. "铝") or sub-scope ' +
                        '("铝::公司A"). Omit to list every article in the current bundle.',
                },
            },
        },
    },
    {
        name: 'read_article',
        description:
            'Read the full content of one article by id. Content is returned in `cat -n` format: ' +
            'each line is prefixed with `<lineNumber>\\t` (e.g. `  42\\tSome text here`). ' +
            'The line numbers are for visual anchoring only — when you construct `old_string` for ' +
            'edit_article, you MUST strip the `<N>\\t` prefix and copy only the raw line content. ' +
            'You MUST call read_article before calling edit_article on that article.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Article id from list_articles.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'create_article',
        description:
            'Create a new wiki article. Pick scope carefully: use the industry alone (e.g. "铝") for ' +
            'industry-wide analysis; use "industry::entity" sub-scope (e.g. "铝::公司A") when the ' +
            'material is specific to one company/asset/project under that industry.',
        parameters: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string',
                    description: 'Target scope, e.g. "铝" or "铝::公司A".',
                },
                title: { type: 'string', description: 'Article title (unique within scope).' },
                content: {
                    type: 'string',
                    description: 'Full markdown content. Use `## heading` for sections.',
                },
                summary: {
                    type: 'string',
                    description: 'One-sentence description used in list_articles / search.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional tags.',
                },
            },
            required: ['scope', 'title', 'content'],
        },
    },
    {
        name: 'edit_article',
        description:
            'Replace an exact substring inside an existing article. This is the preferred way to make ' +
            'targeted changes (add a bullet, update a figure, rewrite one section) because it keeps ' +
            'the rest of the article untouched. ' +
            'REQUIREMENTS: ' +
            '(1) You MUST have called read_article for this id in this ingest run first, so you can ' +
            'copy `old_string` verbatim from the actual content. ' +
            '(2) `old_string` must match the article content EXACTLY, including every space, newline, ' +
            'and punctuation mark. ' +
            '(3) `old_string` and `new_string` must differ. ' +
            '(4) If `old_string` appears more than once, you MUST pass `expected_occurrences` equal ' +
            'to the count, otherwise the call fails (to prevent accidentally rewriting the wrong spot). ' +
            'To add a whole new section at the end, pass the article\'s current trailing text as ' +
            '`old_string` and `old_string + "\\n\\n## newHeading\\n...` as `new_string`. ' +
            'If you need to rewrite the whole article, use write_article instead.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Article id.' },
                old_string: {
                    type: 'string',
                    description: 'Exact substring to find in the current article content.',
                },
                new_string: {
                    type: 'string',
                    description: 'Replacement text. Can be empty to delete `old_string`.',
                },
                expected_occurrences: {
                    type: 'integer',
                    description:
                        'Required if `old_string` may match more than once in the article. Must equal ' +
                        'the exact number of non-overlapping matches. Defaults to 1.',
                },
            },
            required: ['id', 'old_string', 'new_string'],
        },
    },
    {
        name: 'append_to_article',
        description:
            'Append new content to the END of an existing article. This is the PREFERRED tool when ' +
            'the source adds a genuinely new topic/section to an article — it needs no string matching, ' +
            'so it cannot fail on whitespace or punctuation. ' +
            'The `content` you pass is appended verbatim (with a blank-line separator inserted if ' +
            'needed). If you want a new `## heading` section, include the `## heading` line at the ' +
            'top of `content` yourself — nothing is auto-prepended. ' +
            'Use this over edit_article whenever you are ONLY adding material and not changing or ' +
            'removing existing text.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                content: {
                    type: 'string',
                    description:
                        'Markdown to append. Include your own `## heading` line if you want a new ' +
                        'section. Do not repeat text that is already in the article.',
                },
            },
            required: ['id', 'content'],
        },
    },
    {
        name: 'write_article',
        description:
            'Replace the full content of an existing article. Use this only when more than half the ' +
            'article needs to change, or when edit_article has failed twice in a row on the same ' +
            'article. For small targeted changes prefer edit_article; for pure additions at the end ' +
            'prefer append_to_article.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                content: { type: 'string', description: 'Full new markdown content for the article.' },
                title: { type: 'string', description: 'Optional new title.' },
                summary: { type: 'string', description: 'Optional new one-line summary.' },
            },
            required: ['id', 'content'],
        },
    },
    {
        name: 'finish',
        description:
            'Signal that ingestion is complete. Always call this at the end, even if no writes were ' +
            'needed, with a short note describing what was done or why nothing changed.',
        parameters: {
            type: 'object',
            properties: {
                note: { type: 'string' },
            },
        },
    },
];

// Map Gemini-shaped declarations to OpenAI-style tools (for Qwen/DashScope).
function wikiToolsOpenAIShape() {
    return WIKI_TOOL_DECLS.map((d) => ({
        type: 'function',
        function: {
            name: d.name,
            description: d.description,
            parameters: d.parameters,
        },
    }));
}

// ─── Tool executor ─────────────────────────────────────────
// All mutations go through lazyReadWikiBundle → mutate → writeJSON → upsertWikiIndexEntry.
// Returns a JSON-serialisable result object that the LLM sees as functionResponse.

function articleSummaryView(a) {
    return {
        id: a.id,
        title: a.title,
        summary: a.description || '',
        industryCategory: a.industryCategory,
        updatedAt: a.updatedAt || a.createdAt || 0,
        tags: a.tags || [],
    };
}

// Claude-Code / `cat -n` style line numbering. Lines are 1-indexed and padded
// so numbers align for the model's visual anchoring. The exact format is
// echoed in read_article's tool description so the model knows to strip the
// `   N\t` prefix when copying text into edit_article's old_string.
function numberLines(content) {
    const lines = String(content || '').split('\n');
    const width = String(lines.length).length;
    return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}\t${line}`).join('\n');
}

// Count non-overlapping occurrences of `needle` in `haystack`.
function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
        count++;
        idx += needle.length;
    }
    return count;
}

// When edit_article's `old_string` is not found verbatim, return a handful of
// candidate substrings so the model can see what's actually there. Score is a
// simple line-level token-overlap on trimmed non-empty lines.
function findNearMatchesForEdit(content, target, topN = 3) {
    const contentLines = String(content || '').split('\n');
    const targetLines = String(target || '').split('\n');
    const windowSize = Math.max(1, Math.min(targetLines.length, 40));
    const targetNorm = targetLines.map((l) => l.trim()).filter((l) => l);
    if (targetNorm.length === 0 || contentLines.length < windowSize) return [];
    const targetSet = new Set(targetNorm);
    const candidates = [];
    for (let i = 0; i <= contentLines.length - windowSize; i++) {
        const window = contentLines.slice(i, i + windowSize);
        const windowNorm = window.map((l) => l.trim()).filter((l) => l);
        if (windowNorm.length === 0) continue;
        const overlap = windowNorm.filter((l) => targetSet.has(l)).length;
        const denom = Math.max(windowNorm.length, targetNorm.length);
        const score = overlap / denom;
        if (score > 0) {
            candidates.push({ score, startLine: i, window });
        }
    }
    candidates.sort((a, b) => b.score - a.score);
    // De-dup overlapping windows: keep the best, skip any that overlap it by >60%.
    const picked = [];
    for (const c of candidates) {
        const overlapsExisting = picked.some((p) => Math.abs(p.startLine - c.startLine) < windowSize * 0.6);
        if (!overlapsExisting) picked.push(c);
        if (picked.length >= topN) break;
    }
    return picked.map((c) => ({
        similarity: Number(c.score.toFixed(2)),
        startLine: c.startLine,
        snippet: c.window.join('\n').slice(0, 500),
    }));
}

// Persist a mutated bundle and record an action.
async function persistWikiBundle(userId, industry, bundle) {
    bundle.updatedAt = Date.now();
    await writeJSON(wikiBundleFilePath(userId, industry), bundle);
    await upsertWikiIndexEntry(userId, industry, bundle);
}

function appendBundleAction(bundle, action, articleTitle, description, industryCategory) {
    bundle.actions = bundle.actions || [];
    bundle.actions.unshift({
        id: `act_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
        industryCategory,
        action,
        articleTitle,
        description: description || '',
        timestamp: Date.now(),
    });
    // Cap per-bundle action log at 500
    if (bundle.actions.length > 500) bundle.actions.length = 500;
}

async function executeWikiTool(userId, toolName, args, ctx) {
    // ctx: { industry, scope } — industry is the top-level bundle key for this ingest run.
    const { industry } = ctx;
    const bundle =
        (await lazyReadWikiBundle(userId, industry)) ||
        { industry, articles: [], actions: [], updatedAt: Date.now() };

    switch (toolName) {
        case 'list_articles': {
            const scope = args?.scope;
            let list = bundle.articles;
            if (scope) {
                list = list.filter(
                    (a) => a.industryCategory === scope ||
                           a.industryCategory.startsWith(scope + '::')
                );
            }
            return {
                ok: true,
                count: list.length,
                articles: list.map(articleSummaryView),
            };
        }
        case 'read_article': {
            const a = bundle.articles.find((x) => x.id === args?.id);
            if (!a) return { ok: false, error: `Article not found: ${args?.id}` };
            const plain = a.content || '';
            return {
                ok: true,
                article: {
                    id: a.id,
                    title: a.title,
                    summary: a.description || '',
                    // Line-numbered view (cat -n style). Each line is prefixed with
                    // `<N>\t`, numbers right-padded so they align. When you use this
                    // text in edit_article's old_string, strip the `<N>\t` prefix —
                    // old_string must be the raw content without line numbers.
                    content: numberLines(plain),
                    lineCount: plain === '' ? 0 : plain.split('\n').length,
                    charCount: plain.length,
                    industryCategory: a.industryCategory,
                    tags: a.tags || [],
                    updatedAt: a.updatedAt || a.createdAt || 0,
                },
            };
        }
        case 'create_article': {
            const scope = args?.scope;
            if (!scope) return { ok: false, error: 'scope is required' };
            const top = topLevelIndustry(scope);
            if (top !== industry) {
                return {
                    ok: false,
                    error: `scope "${scope}" has top-level "${top}" but this ingest run is locked to "${industry}"`,
                };
            }
            if (!args.title || !args.content) {
                return { ok: false, error: 'title and content are required' };
            }
            // De-dupe by title within same scope
            const dup = bundle.articles.find(
                (a) => a.industryCategory === scope && a.title === args.title
            );
            if (dup) {
                return {
                    ok: false,
                    error: `Article with title "${args.title}" already exists in scope "${scope}" (id=${dup.id}). Use edit_article or write_article instead.`,
                    existingId: dup.id,
                };
            }
            const id = `a_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
            const article = {
                id,
                industryCategory: scope,
                title: args.title,
                description: args.summary || '',
                content: String(args.content || ''),
                tags: Array.isArray(args.tags) ? args.tags : [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            bundle.articles.push(article);
            appendBundleAction(bundle, 'create', article.title, 'Created via tool-use', scope);
            await persistWikiBundle(userId, industry, bundle);
            return { ok: true, id, industryCategory: scope };
        }
        case 'write_article': {
            const a = bundle.articles.find((x) => x.id === args?.id);
            if (!a) return { ok: false, error: `Article not found: ${args?.id}` };
            if (typeof args.content !== 'string') {
                return { ok: false, error: 'content (full markdown string) is required' };
            }
            a.content = args.content;
            if (args.title) a.title = args.title;
            if (typeof args.summary === 'string') a.description = args.summary;
            a.updatedAt = Date.now();
            appendBundleAction(bundle, 'update', a.title, 'write_article (full replace)', a.industryCategory);
            await persistWikiBundle(userId, industry, bundle);
            return { ok: true };
        }
        case 'edit_article': {
            const a = bundle.articles.find((x) => x.id === args?.id);
            if (!a) return { ok: false, error: `Article not found: ${args?.id}` };
            const oldStr = typeof args.old_string === 'string' ? args.old_string : '';
            const newStr = typeof args.new_string === 'string' ? args.new_string : '';
            if (!oldStr) {
                return { ok: false, error: 'old_string is required and cannot be empty' };
            }
            if (oldStr === newStr) {
                return { ok: false, error: 'old_string and new_string must differ' };
            }
            const expected = Number.isInteger(args.expected_occurrences) && args.expected_occurrences > 0
                ? args.expected_occurrences
                : 1;
            const content = a.content || '';
            const found = countOccurrences(content, oldStr);
            if (found === 0) {
                const candidates = findNearMatchesForEdit(content, oldStr, 3);
                return {
                    ok: false,
                    error:
                        `old_string not found in article "${a.title}" (id=${a.id}). ` +
                        `Note: the match must be EXACT including every space, newline, and punctuation. ` +
                        `Did you call read_article first and copy from the actual content? ` +
                        `Near candidates follow — if one of these is what you meant, re-issue edit_article with the exact snippet copied verbatim.`,
                    near_candidates: candidates,
                    hint_article_length: content.length,
                };
            }
            if (found !== expected) {
                return {
                    ok: false,
                    error:
                        `old_string matches ${found} times but expected_occurrences=${expected}. ` +
                        `Either (a) pass expected_occurrences=${found} to apply to all matches, or ` +
                        `(b) extend old_string with more surrounding context until it is unique.`,
                    actual_occurrences: found,
                };
            }
            // Apply replace (all occurrences, since found === expected).
            const newContent = content.split(oldStr).join(newStr);
            a.content = newContent;
            a.updatedAt = Date.now();
            appendBundleAction(
                bundle,
                'update',
                a.title,
                `edit_article (replaced ${found}×, ${oldStr.length}→${newStr.length} chars)`,
                a.industryCategory
            );
            await persistWikiBundle(userId, industry, bundle);
            return { ok: true, replacements: found };
        }
        case 'append_to_article': {
            const a = bundle.articles.find((x) => x.id === args?.id);
            if (!a) return { ok: false, error: `Article not found: ${args?.id}` };
            if (typeof args.content !== 'string' || !args.content.trim()) {
                return { ok: false, error: 'content is required and cannot be empty' };
            }
            const existing = a.content || '';
            // Use a blank-line separator if the existing content doesn't already end
            // with one. Model owns all formatting inside `content` (including any
            // `## heading` line they want to introduce).
            const sep = existing === '' ? '' : (existing.endsWith('\n\n') ? '' : (existing.endsWith('\n') ? '\n' : '\n\n'));
            a.content = existing + sep + args.content;
            a.updatedAt = Date.now();
            appendBundleAction(
                bundle,
                'update',
                a.title,
                `append_to_article (+${args.content.length} chars)`,
                a.industryCategory
            );
            await persistWikiBundle(userId, industry, bundle);
            return { ok: true, appended: args.content.length, newCharCount: a.content.length };
        }
        case 'finish': {
            return { ok: true, finished: true, note: args?.note || '' };
        }
        default:
            return { ok: false, error: `Unknown tool: ${toolName}` };
    }
}

// ─── Phase 2b: Gemini tool-use ingest endpoint ─────────────
// POST /api/wiki-ingest-tools
// Body: {
//   industry: string,        // top-level bundle key (required)
//   source: string,          // raw source text to ingest
//   sourceMetadata?: { title?, url?, date? },
//   scopeHint?: string,      // suggested scope, e.g. "铝::公司A"
//   model: string,           // e.g. "gemini-2.5-flash"
//   systemPrompt?: string,   // caller-supplied rules (industry custom instructions etc.)
//   maxRounds?: number,      // default 30
// }
// SSE events:
//   {type:'tool_call',    name, args, round}
//   {type:'tool_result',  name, result, round}
//   {type:'text',         content}
//   {type:'article_created', id, title, scope}
//   {type:'article_updated', id, title, scope}
//   {type:'done',         rounds, finishNote}
//   {type:'error',        content}

app.post('/api/wiki-ingest-tools', async (req, res) => {
    const {
        industry,
        source,
        sourceMetadata,
        scopeHint,
        model,
        systemPrompt,
        maxRounds,
    } = req.body || {};

    if (!industry || !source || !model) {
        return res.status(400).json({ error: 'industry, source, model are required' });
    }

    const provider = getProviderForModel(model);
    const apiKey = await getUserApiKey(req.userId, provider);
    if (!apiKey) {
        return res.status(400).json({
            error: `No API key configured for provider: ${provider}. Please set it in Settings.`,
        });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    let clientClosed = false;
    res.on('close', () => { clientClosed = true; });
    const sendSSE = (data) => {
        if (!clientClosed) {
            try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
        }
    };

    const limit = Math.max(1, Math.min(Number(maxRounds) || 30, 60));

    // Preload existing bundle to inject compact index into system prompt
    const existingBundle =
        (await lazyReadWikiBundle(req.userId, industry)) ||
        { industry, articles: [], actions: [], updatedAt: 0 };
    const compactIndex = existingBundle.articles.map((a) => ({
        id: a.id,
        title: a.title,
        scope: a.industryCategory,
        summary: (a.description || '').slice(0, 200),
    }));

    const baseSystem = [
        'You are a wiki editor ingesting one source document into a per-industry knowledge base.',
        `This run is locked to top-level industry: "${industry}".`,
        'Tools: list_articles, read_article, create_article, append_to_article, edit_article, write_article, finish.',
        '',
        'DECISION TREE (follow strictly):',
        '  1. Skim the existing article index below.',
        '  2. For each piece of info in the source, pick ONE action:',
        '     • NEW TOPIC not covered anywhere → create_article',
        '     • PURE ADDITION to an existing article (adding a section, a bullet, a data point, without changing any existing text) → append_to_article. This is the safest tool: no string matching.',
        '     • INLINE CHANGE to existing text (updating a number, rewriting a sentence, replacing a section body) → read_article first (content comes back line-numbered `  N\\tline`), then edit_article with `old_string` copied verbatim from the line content (STRIP THE `N\\t` PREFIX) and `new_string` as the replacement.',
        '     • RESTRUCTURE most of the article → write_article.',
        '  3. End with finish({note}).',
        '',
        'CRITICAL rules:',
        '- PREFER append_to_article over edit_article whenever you are only adding material. It cannot fail on whitespace mismatches.',
        '- edit_article\'s `old_string` MUST match the article byte-for-byte. Copy it from the line-numbered read_article output and strip the leading `  N\\t` prefix on each line — the actual article content does NOT contain line numbers.',
        '- If edit_article fails once with old_string not found, DO NOT re-read the same article three times in a row. Either (a) switch to append_to_article if you are adding at the end, or (b) fall back to write_article with the full rewritten content.',
        '- Do not create duplicate articles. Every article lives under this industry; sub-scopes use "industry::entity" form (e.g. "铝::公司A") when material is specific to one entity.',
        '',
        `Existing article index (${compactIndex.length} articles):`,
        JSON.stringify(compactIndex, null, 2),
    ].join('\n');

    const composedSystem = systemPrompt ? `${systemPrompt}\n\n---\n\n${baseSystem}` : baseSystem;

    const userMessage = [
        scopeHint ? `Scope hint from caller: ${scopeHint}` : '',
        sourceMetadata?.title ? `Source title: ${sourceMetadata.title}` : '',
        sourceMetadata?.url ? `Source URL: ${sourceMetadata.url}` : '',
        sourceMetadata?.date ? `Source date: ${sourceMetadata.date}` : '',
        '',
        '--- SOURCE TEXT START ---',
        source,
        '--- SOURCE TEXT END ---',
    ].filter(Boolean).join('\n');

    try {
        if (provider === 'google') {
            await runGeminiToolLoop({
                apiKey,
                model,
                system: composedSystem,
                userMessage,
                industry,
                userId: req.userId,
                limit,
                sendSSE,
            });
        } else if (provider === 'dashscope' || provider === 'openai' || provider === 'deepseek' || provider === 'moonshot' || provider === 'minimax') {
            await runOpenAICompatibleToolLoop({
                provider,
                apiKey,
                model,
                system: composedSystem,
                userMessage,
                industry,
                userId: req.userId,
                limit,
                sendSSE,
            });
        } else {
            sendSSE({
                type: 'error',
                content: `Provider "${provider}" does not support wiki tool-use yet. Use Gemini or Qwen.`,
            });
        }
    } catch (err) {
        console.error('wiki-ingest-tools error:', err);
        sendSSE({ type: 'error', content: err.message || 'Ingest failed' });
    }
    if (!clientClosed) res.end();
});

async function runGeminiToolLoop({
    apiKey, model, system, userMessage, industry, userId, limit, sendSSE,
}) {
    // Gemini non-streaming generateContent is simpler for tool-use loops.
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    // History: `contents` array. System prompt goes into first user turn then ack (same trick used in /api/ai/chat).
    const contents = [
        { role: 'user', parts: [{ text: system }] },
        { role: 'model', parts: [{ text: 'Understood. I will use the tools to ingest the source.' }] },
        { role: 'user', parts: [{ text: userMessage }] },
    ];

    for (let round = 1; round <= limit; round++) {
        const body = {
            contents,
            tools: [{ functionDeclarations: WIKI_TOOL_DECLS }],
        };
        const geminiRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
        }
        const json = await geminiRes.json();
        const cand = json.candidates?.[0];
        const parts = cand?.content?.parts || [];
        // Separate text parts and functionCalls
        const fnCalls = parts.filter((p) => p.functionCall);
        const texts = parts.filter((p) => p.text).map((p) => p.text).join('');
        if (texts) sendSSE({ type: 'text', content: texts });

        if (fnCalls.length === 0) {
            // No more tool calls — exit
            sendSSE({ type: 'done', rounds: round, finishNote: texts || '' });
            return;
        }

        // Echo model turn into history so subsequent turn includes functionResponse in order
        contents.push({ role: 'model', parts });

        const fnResponseParts = [];
        let finished = false;
        let finishNote = '';
        for (const call of fnCalls) {
            const name = call.functionCall.name;
            const args = call.functionCall.args || {};
            sendSSE({ type: 'tool_call', name, args, round });
            const result = await executeWikiTool(userId, name, args, { industry });
            sendSSE({ type: 'tool_result', name, result, round });
            // Per-round diagnostic log so we can see over-reading / match-failure loops.
            const summary = result.ok
                ? (result.id ? `ok id=${result.id}` : (result.replacements ? `ok ${result.replacements}×` : 'ok'))
                : `ERR: ${String(result.error || '').slice(0, 120)}`;
            const argBrief =
                name === 'create_article'    ? `title="${String(args.title || '').slice(0, 40)}"` :
                name === 'edit_article'      ? `id=${args.id} oldLen=${String(args.old_string || '').length} newLen=${String(args.new_string || '').length}` :
                name === 'append_to_article' ? `id=${args.id} contentLen=${String(args.content || '').length}` :
                name === 'write_article'     ? `id=${args.id} contentLen=${String(args.content || '').length}` :
                name === 'read_article'      ? `id=${args.id}` :
                name === 'list_articles'     ? `scope=${args.scope || 'all'}` :
                name === 'finish'            ? `note="${String(args.note || '').slice(0, 60)}"` : '';
            console.log(`[wiki-tools][gemini][${industry}][r${round}] ${name}(${argBrief}) → ${summary}`);
            if (name === 'create_article' && result.ok) {
                sendSSE({ type: 'article_created', id: result.id, title: args.title, scope: args.scope });
            } else if ((name === 'write_article' || name === 'edit_article' || name === 'append_to_article') && result.ok) {
                sendSSE({ type: 'article_updated', id: args.id, scope: args.scope || '' });
            }
            if (name === 'finish') {
                finished = true;
                finishNote = args?.note || '';
            }
            fnResponseParts.push({
                functionResponse: { name, response: result },
            });
        }
        contents.push({ role: 'user', parts: fnResponseParts });

        if (finished) {
            sendSSE({ type: 'done', rounds: round, finishNote });
            return;
        }
    }
    sendSSE({ type: 'done', rounds: limit, finishNote: '(max rounds reached without finish)' });
}

async function runOpenAICompatibleToolLoop({
    provider, apiKey, model, system, userMessage, industry, userId, limit, sendSSE,
}) {
    const OpenAI = (await import('openai')).default;
    let baseURL;
    if (provider === 'dashscope') baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    else if (provider === 'deepseek') baseURL = 'https://api.deepseek.com';
    else if (provider === 'moonshot') baseURL = resolveMoonshotBaseURL(apiKey);
    else if (provider === 'minimax') baseURL = 'https://api.minimax.io/v1';
    // openai uses default
    const client = new OpenAI({ apiKey, baseURL });
    const tools = wikiToolsOpenAIShape();
    const messages = [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
    ];

    for (let round = 1; round <= limit; round++) {
        const completion = await client.chat.completions.create({
            model,
            messages,
            tools,
            tool_choice: 'auto',
        });
        const choice = completion.choices?.[0];
        const msg = choice?.message;
        const toolCalls = msg?.tool_calls || [];
        if (msg?.content) sendSSE({ type: 'text', content: msg.content });
        if (toolCalls.length === 0) {
            sendSSE({ type: 'done', rounds: round, finishNote: msg?.content || '' });
            return;
        }
        // Push assistant turn (content + tool_calls) so the subsequent tool messages link properly.
        messages.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: toolCalls,
        });
        let finished = false;
        let finishNote = '';
        for (const call of toolCalls) {
            const name = call.function?.name;
            let args = {};
            try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; }
            catch (e) { args = {}; }
            sendSSE({ type: 'tool_call', name, args, round });
            const result = await executeWikiTool(userId, name, args, { industry });
            sendSSE({ type: 'tool_result', name, result, round });
            const summary = result.ok
                ? (result.id ? `ok id=${result.id}` : (result.replacements ? `ok ${result.replacements}×` : 'ok'))
                : `ERR: ${String(result.error || '').slice(0, 120)}`;
            const argBrief =
                name === 'create_article'    ? `title="${String(args.title || '').slice(0, 40)}"` :
                name === 'edit_article'      ? `id=${args.id} oldLen=${String(args.old_string || '').length} newLen=${String(args.new_string || '').length}` :
                name === 'append_to_article' ? `id=${args.id} contentLen=${String(args.content || '').length}` :
                name === 'write_article'     ? `id=${args.id} contentLen=${String(args.content || '').length}` :
                name === 'read_article'      ? `id=${args.id}` :
                name === 'list_articles'     ? `scope=${args.scope || 'all'}` :
                name === 'finish'            ? `note="${String(args.note || '').slice(0, 60)}"` : '';
            console.log(`[wiki-tools][${provider}][${industry}][r${round}] ${name}(${argBrief}) → ${summary}`);
            if (name === 'create_article' && result.ok) {
                sendSSE({ type: 'article_created', id: result.id, title: args.title, scope: args.scope });
            } else if ((name === 'write_article' || name === 'edit_article' || name === 'append_to_article') && result.ok) {
                sendSSE({ type: 'article_updated', id: args.id, scope: args.scope || '' });
            }
            if (name === 'finish') {
                finished = true;
                finishNote = args?.note || '';
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            });
        }
        if (finished) {
            sendSSE({ type: 'done', rounds: round, finishNote });
            return;
        }
    }
    sendSSE({ type: 'done', rounds: limit, finishNote: '(max rounds reached without finish)' });
}

// ─── Wiki Generation Logs (stored as JSON array in GCS) ───
const wikiLogPath = (userId) => `${userId}/wiki-generation-logs.json`;

app.get('/api/industry-wiki/generation-logs', async (req, res) => {
    try {
        const logs = await readJSON(wikiLogPath(req.userId)) || [];
        const { scope, limit } = req.query;
        let filtered = logs;
        if (scope) {
            filtered = filtered.filter(l => l.industryCategory === scope);
        }
        const lim = Math.min(parseInt(limit) || 50, 200);
        filtered = filtered.slice(0, lim);
        res.json({ success: true, data: filtered });
    } catch (err) {
        console.error('GET /api/industry-wiki/generation-logs error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/industry-wiki/generation-logs/:id', async (req, res) => {
    try {
        const logs = await readJSON(wikiLogPath(req.userId)) || [];
        const log = logs.find(l => l.id === req.params.id);
        if (!log) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, data: log });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/industry-wiki/generation-logs', async (req, res) => {
    try {
        const logs = await readJSON(wikiLogPath(req.userId)) || [];
        const entry = req.body;
        // Use client-provided id, or generate one
        if (!entry.id) {
            entry.id = `gl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        if (!entry.createdAt) entry.createdAt = Date.now();
        // Prepend new entry, keep max 200
        logs.unshift(entry);
        if (logs.length > 200) logs.length = 200;
        await writeJSON(wikiLogPath(req.userId), logs);
        res.json({ success: true, data: entry });
    } catch (err) {
        console.error('POST /api/industry-wiki/generation-logs error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.patch('/api/industry-wiki/generation-logs/:id', async (req, res) => {
    try {
        const logs = await readJSON(wikiLogPath(req.userId)) || [];
        const idx = logs.findIndex(l => l.id === req.params.id);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
        Object.assign(logs[idx], req.body);
        await writeJSON(wikiLogPath(req.userId), logs);
        res.json({ success: true, data: logs[idx] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/industry-wiki/generation-logs/:id', async (req, res) => {
    try {
        const logs = await readJSON(wikiLogPath(req.userId)) || [];
        const filtered = logs.filter(l => l.id !== req.params.id);
        await writeJSON(wikiLogPath(req.userId), filtered);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/workspaces', async (req, res) => {
    try {
        const workspace = req.body;
        await writeJSON(`${req.userId}/workspaces/${workspace.id}.json`, workspace);
        await upsertIndex(req.userId, 'workspaces', workspace);
        res.json(workspace);
    } catch (err) {
        console.error('POST /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/workspaces/:id', async (req, res) => {
    try {
        const path = `${req.userId}/workspaces/${req.params.id}.json`;
        const existing = await readJSON(path);
        const updated = { ...existing, ...req.body };
        await writeJSON(path, updated);
        await upsertIndex(req.userId, 'workspaces', updated);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/workspaces/:id', async (req, res) => {
    try {
        // Delete canvases under this workspace
        const canvasIndex = await readIndex(req.userId, 'canvases');
        const toDelete = canvasIndex.filter(c => c.workspaceId === req.params.id);
        await Promise.all(toDelete.map(async (canvas) => {
            await deleteByPrefix(`${req.userId}/canvas-data/${canvas.id}/`);
            await deleteFile(`${req.userId}/canvases/${canvas.id}.json`);
        }));
        // Update canvas index: remove deleted canvases
        const remaining = canvasIndex.filter(c => c.workspaceId !== req.params.id);
        await writeIndex(req.userId, 'canvases', remaining);
        // Delete workspace
        await deleteFile(`${req.userId}/workspaces/${req.params.id}.json`);
        await removeFromIndex(req.userId, 'workspaces', req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Canvas Routes ─────────────────────────────────────────
app.get('/api/canvases', async (req, res) => {
    try {
        const { workspaceId, lite } = req.query;
        let canvases = await readIndex(req.userId, 'canvases');
        if (workspaceId) {
            canvases = canvases.filter(c => c.workspaceId === workspaceId);
        }

        // Enrich with node counts only when not in lite mode (lite mode skips expensive per-file reads)
        if (!lite) {
            for (const c of canvases) {
                try {
                    const fullCanvas = await readJSON(`${req.userId}/canvases/${c.id}.json`);
                    c.nodeCount = fullCanvas?.nodes?.filter(n => !n.isMain)?.length || 0;
                } catch (err) {
                    c.nodeCount = 0;
                }
            }
        }

        canvases.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        res.json(canvases);
    } catch (err) {
        console.error('GET /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/canvases/:id', async (req, res) => {
    try {
        const canvas = await readJSON(`${req.userId}/canvases/${req.params.id}.json`);
        if (!canvas) {
            return res.status(404).json({ error: 'Canvas not found' });
        }
        await hydrateNodeData(canvas.nodes, req.userId, req.params.id);
        res.json(canvas);
    } catch (err) {
        console.error('GET /api/canvases/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Move node between canvases ───────────────────────────
app.post('/api/canvas/move-node', async (req, res) => {
    try {
        const userId = req.userId;
        const { nodeId, sourceCanvasId, targetCanvasId, updateCompany } = req.body;
        console.log(`🔀 Move node: nodeId=${nodeId}, source=${sourceCanvasId}, target=${targetCanvasId}, userId=${userId}`);
        if (!nodeId || !sourceCanvasId || !targetCanvasId) {
            return res.status(400).json({ error: 'nodeId, sourceCanvasId, targetCanvasId required' });
        }
        if (sourceCanvasId === targetCanvasId) {
            return res.status(400).json({ error: 'Source and target canvas are the same' });
        }

        // Load source canvas + bundle
        const sourceCanvas = await readJSON(`${userId}/canvases/${sourceCanvasId}.json`);
        const sourceBundle = await readJSON(`${userId}/canvas-data/${sourceCanvasId}.json`) || {};
        if (!sourceCanvas || !sourceCanvas.nodes) {
            return res.status(404).json({ error: 'Source canvas not found' });
        }

        // Find the node in source
        const nodeIdx = sourceCanvas.nodes.findIndex(n => n.id === nodeId);
        if (nodeIdx < 0) {
            return res.status(404).json({ error: 'Node not found in source canvas' });
        }
        const node = sourceCanvas.nodes[nodeIdx];
        const nodeData = sourceBundle[nodeId];

        // Load target canvas + bundle
        const targetCanvas = await readJSON(`${userId}/canvases/${targetCanvasId}.json`);
        const targetBundle = await readJSON(`${userId}/canvas-data/${targetCanvasId}.json`) || {};
        if (!targetCanvas) {
            return res.status(404).json({ error: 'Target canvas not found' });
        }
        if (!targetCanvas.nodes) targetCanvas.nodes = [];

        // Update company name in metadata if requested
        if (updateCompany && nodeData && nodeData.metadata) {
            nodeData.metadata['公司'] = updateCompany;
        }

        // Add to target
        const newY = targetCanvas.nodes.length * 120;
        targetCanvas.nodes.push({ ...node, position: { x: 0, y: newY } });
        if (nodeData) targetBundle[nodeId] = nodeData;
        targetCanvas.updatedAt = Date.now();

        // Remove from source
        sourceCanvas.nodes.splice(nodeIdx, 1);
        delete sourceBundle[nodeId];
        sourceCanvas.updatedAt = Date.now();

        // Save both
        await Promise.all([
            writeJSON(`${userId}/canvases/${sourceCanvasId}.json`, sourceCanvas),
            writeJSON(`${userId}/canvas-data/${sourceCanvasId}.json`, sourceBundle),
            writeJSON(`${userId}/canvases/${targetCanvasId}.json`, targetCanvas),
            writeJSON(`${userId}/canvas-data/${targetCanvasId}.json`, targetBundle),
        ]);

        // Update canvas index
        const canvasIndex = await readIndex(userId, 'canvases');
        for (const c of [sourceCanvas, targetCanvas]) {
            const idx = canvasIndex.findIndex(ci => ci.id === c.id);
            const meta = canvasMetaForIndex(c);
            if (idx >= 0) canvasIndex[idx] = meta;
        }
        await writeIndex(userId, 'canvases', canvasIndex);
        invalidateUserCache(userId);

        res.json({ ok: true, targetCanvasId });
    } catch (err) {
        console.error('Move node error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/canvases', async (req, res) => {
    try {
        const canvas = req.body;
        await offloadNodeData(canvas.nodes, req.userId, canvas.id);
        await writeJSON(`${req.userId}/canvases/${canvas.id}.json`, canvas);
        await upsertIndex(req.userId, 'canvases', canvasMetaForIndex(canvas));
        res.json(canvas);
    } catch (err) {
        console.error('POST /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/canvases/:id', async (req, res) => {
    try {
        const updates = req.body;
        await offloadNodeData(updates.nodes, req.userId, req.params.id);
        const path = `${req.userId}/canvases/${req.params.id}.json`;
        const existing = await readJSON(path) || {};
        const merged = { ...existing, ...updates };
        await writeJSON(path, merged);
        await upsertIndex(req.userId, 'canvases', canvasMetaForIndex(merged));
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/canvases/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/canvases/:id', async (req, res) => {
    try {
        // Clean up both bundled file and old per-node files
        await deleteFile(`${req.userId}/canvas-data/${req.params.id}.json`);
        await deleteByPrefix(`${req.userId}/canvas-data/${req.params.id}/`);
        await deleteFile(`${req.userId}/canvases/${req.params.id}.json`);
        await removeFromIndex(req.userId, 'canvases', req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Seed Route ────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
    try {
        const existing = await readIndex(req.userId, 'workspaces');
        if (existing.length > 0) {
            return res.json({ seeded: false, message: 'Data already exists' });
        }

        const { workspace, canvas } = req.body;
        await offloadNodeData(canvas.nodes, req.userId, canvas.id);
        await writeJSON(`${req.userId}/workspaces/${workspace.id}.json`, workspace);
        await writeJSON(`${req.userId}/canvases/${canvas.id}.json`, canvas);
        await upsertIndex(req.userId, 'workspaces', workspace);
        await upsertIndex(req.userId, 'canvases', canvasMetaForIndex(canvas));
        res.json({ seeded: true });
    } catch (err) {
        console.error('POST /api/seed error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── General File Upload ────────────────────────────────────

app.post('/api/upload', upload.single('file'), authenticate, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const bucket = await getBucket();
        const filename = `${req.userId}/files/${Date.now()}-${req.file.originalname}`;
        const file = bucket.file(filename);

        await file.save(req.file.buffer, {
            contentType: req.file.mimetype,
            resumable: false
        });

        const url = `/api/files/${encodeURIComponent(filename)}`;
        console.log(`Uploaded file: ${filename} (${req.file.mimetype})`);
        res.json({ url, filename, originalName: req.file.originalname, mimetype: req.file.mimetype });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── PDF to Markdown ───────────────────────────────────────

app.post('/api/upload-pdf', upload.single('file'), authenticate, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files supported' });

        const bucket = await getBucket();
        const filename = `${req.userId}/${Date.now()}-${req.file.originalname}`;
        const file = bucket.file(filename);

        await file.save(req.file.buffer, {
            contentType: 'application/pdf',
            resumable: false
        });

        const url = `/api/files/${encodeURIComponent(filename)}`;

        console.log(`Uploaded PDF: ${filename}`);
        res.json({ url, filename, originalName: req.file.originalname });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/files/*', authenticate, async (req, res) => {
    try {
        const filename = req.params[0];
        const bucket = await getBucket();
        const file = bucket.file(filename);
        const [exists] = await file.exists();
        if (!exists) return res.status(404).send('File not found');

        const [metadata] = await file.getMetadata();
        res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
        file.createReadStream().pipe(res);
    } catch (err) {
        console.error('File read error:', err);
        res.status(500).send('Error reading file');
    }
});

app.post('/api/convert-pdf', upload.single('file'), authenticate, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        if (req.file.mimetype !== 'application/pdf') {
            return res.status(400).json({ error: 'Only PDF files are supported' });
        }

        console.log(`Converting PDF: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB) for user ${req.userId}`);

        const pdfBase64 = req.file.buffer.toString('base64');

        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        const accessToken = await auth.getAccessToken();

        const endpoint = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'application/pdf',
                                data: pdfBase64,
                            },
                        },
                        {
                            text: `Convert this PDF document to well-structured Markdown. Follow these rules:
1. Preserve all text content accurately.
2. Use proper Markdown headings (# ## ###) based on the document structure.
3. Convert tables to Markdown table format.
4. Preserve bullet points and numbered lists.
5. For charts/figures, describe them briefly in italics like: *[Figure: description]*
6. For mathematical formulas, use LaTeX notation wrapped in $ or $$.
7. Preserve bold and italic formatting.
8. Do NOT add any commentary or explanation — only output the converted Markdown content.
9. If the document is in Chinese, keep the Chinese text as-is.`,
                        },
                    ],
                }],
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('Gemini API error:', response.status, errBody);
            throw new Error(`Gemini API error ${response.status}: ${errBody}`);
        }

        const data = await response.json();
        let markdown = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        markdown = markdown.replace(/^```markdown\n?/i, '').replace(/\n?```$/i, '').trim();

        console.log(`PDF converted: ${markdown.length} chars`);
        res.json({ markdown, filename: req.file.originalname });
    } catch (err) {
        console.error('POST /api/convert-pdf error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── AI Research Routes ────────────────────────────────────

// Hardcoded fallback — used when OpenRouter is unreachable
const AI_MODELS_FALLBACK = [
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'anthropic' },
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
    { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' },
    { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai' },
    { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', provider: 'openai' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', provider: 'dashscope' },
    { id: 'qwen3-max', name: 'Qwen 3 Max', provider: 'dashscope' },
    { id: 'qwen-max', name: 'Qwen Max', provider: 'dashscope' },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'dashscope' },
    { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'dashscope' },
    { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'deepseek' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek' },
    { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', provider: 'minimax' },
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', provider: 'minimax' },
    { id: 'kimi-latest', name: 'Kimi Latest', provider: 'moonshot' },
    { id: 'kimi-k2-0905-preview', name: 'Kimi K2', provider: 'moonshot' },
    { id: 'moonshot-v1-128k', name: 'Moonshot v1 128k', provider: 'moonshot' },
    { id: 'moonshot-v1-32k', name: 'Moonshot v1 32k', provider: 'moonshot' },
];

// ── OpenRouter model registry: fetch, cache, detect families ──

let _orCache = { data: null, ts: 0 };
const OR_TTL = 6 * 3600 * 1000; // 6-hour cache

// OpenRouter provider → our provider mapping
const OR_PROVIDER_MAP = {
    anthropic: 'anthropic',
    openai: 'openai',
    google: 'google',
    qwen: 'dashscope',
    deepseek: 'deepseek',
    moonshotai: 'moonshot',
    minimax: 'minimax',
    xiaomi: 'xiaomi',
};

async function fetchOpenRouterModels() {
    if (_orCache.data && Date.now() - _orCache.ts < OR_TTL) return _orCache.data;
    try {
        const r = await fetch('https://openrouter.ai/api/v1/models');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        _orCache = { data: json.data || [], ts: Date.now() };
        console.log(`✅ OpenRouter: 已缓存 ${_orCache.data.length} 个模型`);
        return _orCache.data;
    } catch (e) {
        console.warn('⚠️ OpenRouter fetch failed:', e.message);
        return _orCache.data || [];
    }
}

/**
 * Detect model family for upgrade comparison.
 * Returns null for models we don't track (niche fine-tunes, etc.)
 */
function detectModelFamily(modelId) {
    const id = modelId.toLowerCase();

    // Anthropic
    if (id.includes('claude') && id.includes('opus'))   return 'claude-opus';
    if (id.includes('claude') && id.includes('sonnet')) return 'claude-sonnet';
    if (id.includes('claude') && id.includes('haiku'))  return 'claude-haiku';

    // OpenAI — separate chat vs reasoning
    if (/^(openai\/)?gpt-/.test(id))                    return 'gpt';
    if (/^(openai\/)?o[134]-/.test(id))                  return 'openai-reasoning';

    // Google
    if (id.includes('gemini') && id.includes('flash') && !id.includes('lite')) return 'gemini-flash';
    if (id.includes('gemini') && id.includes('pro'))     return 'gemini-pro';

    // Qwen
    if (id.includes('qwen') && id.includes('max'))       return 'qwen-max';
    if (id.includes('qwen') && id.includes('plus'))      return 'qwen-plus';
    if (id.includes('qwen') && id.includes('turbo'))     return 'qwen-turbo';

    // DeepSeek
    if (id.includes('deepseek') && id.includes('r1'))    return 'deepseek-r1';
    if (id.includes('deepseek') && (id.includes('chat') || id.includes('v3') || id.includes('v4'))) return 'deepseek-chat';

    // MiniMax
    if (id.includes('minimax') && /m\d/.test(id))        return 'minimax-m';

    // Moonshot / Kimi
    if (id.includes('kimi'))                             return 'kimi';
    if (id.includes('moonshot'))                         return 'moonshot-v1';

    return null;
}

/**
 * Check if a model ID looks like a canonical release (not a variant/date-specific build).
 * Filters out `:free`, `:thinking`, `:online`, `-lite`, `-YYYY-MM-DD` etc.
 */
function isCanonicalModel(orId) {
    if (orId.includes(':'))    return false; // :free, :thinking, :extended, :online
    if (/-\d{4}-\d{2}-\d{2}/.test(orId)) return false; // date-stamped
    if (/-\d{8}$/.test(orId))  return false; // date-stamped compact
    if (/-lite/.test(orId))    return false; // lite variants
    if (/-exp/.test(orId))     return false; // experimental
    return true;
}

/**
 * Build { family → latestModel } map from OpenRouter data.
 * Only considers canonical (non-variant) models.
 */
function buildFamilyLatestMap(orModels) {
    const familyLatest = {};
    for (const m of orModels) {
        if (!isCanonicalModel(m.id)) continue;
        const family = detectModelFamily(m.id);
        if (!family) continue;
        const created = m.created || 0;
        if (!familyLatest[family] || created > familyLatest[family].created) {
            const parts = m.id.split('/');
            familyLatest[family] = {
                id: parts.slice(1).join('/'),   // strip provider prefix
                name: m.name,
                created,
                orId: m.id,
            };
        }
    }
    return familyLatest;
}

/**
 * Convert OpenRouter models to our { id, name, provider } format,
 * deduplicated & sorted by provider then name.
 */
function convertOpenRouterModels(orModels) {
    const seen = new Set();
    const results = [];
    for (const m of orModels) {
        if (!isCanonicalModel(m.id)) continue;
        const orProvider = m.id.split('/')[0];
        const ourProvider = OR_PROVIDER_MAP[orProvider];
        if (!ourProvider) continue;
        const localId = m.id.split('/').slice(1).join('/');
        if (seen.has(localId.toLowerCase())) continue;
        seen.add(localId.toLowerCase());
        results.push({ id: localId, name: m.name, provider: ourProvider });
    }
    // Sort: by provider order, then by name
    const providerOrder = ['anthropic', 'openai', 'google', 'dashscope', 'deepseek', 'moonshot', 'minimax', 'xiaomi'];
    results.sort((a, b) => {
        const pa = providerOrder.indexOf(a.provider);
        const pb = providerOrder.indexOf(b.provider);
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
    });
    return results;
}

// Return model list: merge OpenRouter live catalog (latest canonical versions)
// with the hardcoded fallback, so the picker always shows current releases
// (e.g. Kimi K2, latest Moonshot, etc.) without manual code bumps.
app.get('/api/ai/models', async (req, res) => {
    try {
        const orModels = await fetchOpenRouterModels();
        const orConverted = orModels.length ? convertOpenRouterModels(orModels) : [];

        // Merge: OR-derived entries take precedence (by id, case-insensitive);
        // fallback entries fill in anything OR didn't surface.
        const byId = new Map();
        for (const m of orConverted) {
            byId.set(m.id.toLowerCase(), m);
        }
        for (const m of AI_MODELS_FALLBACK) {
            if (!byId.has(m.id.toLowerCase())) {
                byId.set(m.id.toLowerCase(), m);
            }
        }

        const providerOrder = ['anthropic', 'openai', 'google', 'dashscope', 'deepseek', 'moonshot', 'minimax', 'xiaomi'];
        const merged = Array.from(byId.values()).sort((a, b) => {
            const pa = providerOrder.indexOf(a.provider);
            const pb = providerOrder.indexOf(b.provider);
            if (pa !== pb) return pa - pb;
            return a.name.localeCompare(b.name);
        });

        res.json(merged);
    } catch (e) {
        console.warn('GET /api/ai/models — falling back to hardcoded list:', e.message);
        res.json(AI_MODELS_FALLBACK);
    }
});

// Check which of the user's selected models have newer versions
app.get('/api/ai/model-updates', async (req, res) => {
    try {
        const orModels = await fetchOpenRouterModels();
        if (!orModels.length) return res.json({ upgrades: {} });
        const familyLatest = buildFamilyLatestMap(orModels);

        // For each model the user might be using, check if an upgrade exists
        // The client sends ?models=model1,model2,...
        const userModels = (req.query.models || '').split(',').filter(Boolean);
        const upgrades = {}; // { userModelId: { latestId, latestName } }
        for (const mid of userModels) {
            const family = detectModelFamily(mid);
            if (!family) continue;
            const latest = familyLatest[family];
            if (!latest) continue;
            if (latest.id.toLowerCase() !== mid.toLowerCase()) {
                upgrades[mid] = { latestId: latest.id, latestName: latest.name };
            }
        }
        res.json({ upgrades, familyLatest });
    } catch (e) {
        console.error('model-updates error:', e);
        res.json({ upgrades: {}, error: e.message });
    }
});

// AI Settings — now stored in GCS
app.get('/api/ai/settings', async (req, res) => {
    try {
        const data = await readJSON(`${req.userId}/settings/ai.json`);
        if (!data) {
            return res.json({ keys: {}, defaultModel: 'gemini-3-flash-preview' });
        }
        const maskedKeys = {};
        for (const [provider, key] of Object.entries(data.keys || {})) {
            if (key && typeof key === 'string' && key.length > 8) {
                maskedKeys[provider] = key.slice(0, 4) + '****' + key.slice(-4);
            } else {
                maskedKeys[provider] = key ? '****' : '';
            }
        }
        res.json({
            keys: maskedKeys,
            defaultModel: data.defaultModel || 'gemini-3-flash-preview',
            summaryPrompt: data.summaryPrompt,
            metadataFillPrompt: data.metadataFillPrompt,
            skills: data.skills || [],
            customTemplates: data.customTemplates || [],
            customFormats: data.customFormats || [],
            // ── apiConfig: 任务模型 + prompt + 开关 ──
            apiConfig: data.apiConfig || null,
        });
    } catch (err) {
        console.error('GET /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/ai/settings', async (req, res) => {
    try {
        const { keys, defaultModel, summaryPrompt, metadataFillPrompt, skills, customTemplates, customFormats, apiConfig } = req.body;
        const existing = await readJSON(`${req.userId}/settings/ai.json`) || { keys: {}, defaultModel: 'gemini-3-flash-preview' };
        const mergedKeys = { ...existing.keys };
        if (keys) {
            for (const [provider, key] of Object.entries(keys)) {
                if (key && !key.includes('****')) {
                    mergedKeys[provider] = key;
                }
            }
        }
        const settings = {
            keys: mergedKeys,
            defaultModel: defaultModel || existing.defaultModel,
            summaryPrompt: summaryPrompt !== undefined ? summaryPrompt : existing.summaryPrompt,
            metadataFillPrompt: metadataFillPrompt !== undefined ? metadataFillPrompt : existing.metadataFillPrompt,
            skills: skills !== undefined ? skills : existing.skills || [],
            customTemplates: customTemplates !== undefined ? customTemplates : existing.customTemplates || [],
            customFormats: customFormats !== undefined ? customFormats : existing.customFormats || [],
            // ── apiConfig: 任务模型 + prompt + 开关 ──
            apiConfig: apiConfig !== undefined ? apiConfig : existing.apiConfig || null,
            updatedAt: Date.now(),
        };
        await writeJSON(`${req.userId}/settings/ai.json`, settings);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── AI Cards (cloud persistence) ──────────────────────────
app.get('/api/ai/cards', async (req, res) => {
    try {
        const data = await readJSON(`${req.userId}/ai-cards.json`);
        res.json(data || { cards: [] });
    } catch (err) {
        console.error('GET /api/ai/cards error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/ai/cards', async (req, res) => {
    try {
        const { cards } = req.body;
        if (!Array.isArray(cards)) {
            return res.status(400).json({ error: 'cards must be an array' });
        }
        await writeJSON(`${req.userId}/ai-cards.json`, { cards, updatedAt: Date.now() });
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/ai/cards error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper: get API key for a provider
async function getUserApiKey(userId, provider) {
    const data = await readJSON(`${userId}/settings/ai.json`);
    if (!data) return null;
    return data.keys?.[provider] || null;
}

/** Base URL for Moonshot developer API. Defaults to the international host
 *  (`api.moonshot.ai`) since that matches the majority of accounts; set
 *  `MOONSHOT_BASE_URL=https://api.moonshot.cn/v1` in env to target the PRC host.
 *
 *  Note: Kimi For Coding / Token Plan keys (`sk-kimi-*`, `sk-ki-*`) live on a
 *  separate host (`api.kimi.com/coding/v1`) that gates access to whitelisted
 *  coding agents (Kimi CLI / Claude Code / Roo Code / OpenClaw). Those keys
 *  are NOT supported here — users must obtain a developer key from
 *  `platform.moonshot.ai` instead.
 */
function resolveMoonshotBaseURL(_apiKey) {
    return process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1';
}

function getProviderForModel(modelId) {
    const model = AI_MODELS_FALLBACK.find(m => m.id === modelId);
    if (model) return model.provider;
    // Infer provider from model ID prefix patterns
    if (modelId.includes('gemini')) return 'google';
    if (modelId.includes('claude')) return 'anthropic';
    if (modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('o3') || modelId.includes('o4')) return 'openai';
    if (modelId.includes('qwen')) return 'dashscope';
    if (modelId.includes('deepseek')) return 'deepseek';
    if (modelId.includes('minimax') || modelId.startsWith('MiniMax')) return 'minimax';
    if (modelId.includes('kimi') || modelId.includes('moonshot')) return 'moonshot';
    if (modelId.includes('mimo')) return 'xiaomi';
    return 'anthropic';
}

// POST /api/ai/chat — SSE streaming proxy
app.post('/api/ai/chat', async (req, res) => {
    const { model, messages, systemPrompt, tools } = req.body;
    if (!model || !messages) {
        return res.status(400).json({ error: 'model and messages are required' });
    }

    const provider = getProviderForModel(model);
    const apiKey = await getUserApiKey(req.userId, provider);
    if (!apiKey) {
        return res.status(400).json({ error: `No API key configured for provider: ${provider}. Please set it in Settings.` });
    }

    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Track client connection state — generation continues even if client disconnects,
    // and the result is saved to cloud so nothing is lost.
    let clientClosed = false;
    res.on('close', () => { clientClosed = true; });

    const sendSSE = (data) => {
        if (!clientClosed) {
            try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
        }
    };

    // Buffer full response so we can save to cloud even if client disconnected
    let fullContent = '';
    const cardId = req.body.cardId; // optional: if provided, save result to AI card on completion

    try {
        if (provider === 'anthropic') {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            const client = new Anthropic({ apiKey });
            const stream = await client.messages.stream({
                model,
                max_tokens: 8192,
                system: systemPrompt || 'You are a helpful research assistant. Answer in the same language as the user.',
                messages: messages.map(m => ({ role: m.role, content: m.content })),
            });
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta?.text) {
                    fullContent += event.delta.text;
                    sendSSE({ type: 'text', content: event.delta.text });
                }
            }
            const finalMsg = await stream.finalMessage();
            sendSSE({ type: 'done', usage: { inputTokens: finalMsg.usage?.input_tokens, outputTokens: finalMsg.usage?.output_tokens } });

        } else if (provider === 'openai' || provider === 'deepseek') {
            const OpenAI = (await import('openai')).default;
            const baseURL = provider === 'deepseek' ? 'https://api.deepseek.com' : undefined;
            const client = new OpenAI({ apiKey, baseURL });
            const chatMessages = [];
            if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
            chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
            const stream = await client.chat.completions.create({
                model,
                messages: chatMessages,
                stream: true,
            });
            let totalTokens = 0;
            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) { fullContent += content; sendSSE({ type: 'text', content }); }
                if (chunk.usage) totalTokens = chunk.usage.total_tokens;
            }
            sendSSE({ type: 'done', usage: { totalTokens } });

        } else if (provider === 'google') {
            const apiMessages = messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }));
            if (systemPrompt) {
                apiMessages.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
                apiMessages.splice(1, 0, { role: 'model', parts: [{ text: 'Understood.' }] });
            }
            const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
            const geminiRes = await fetch(geminiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: apiMessages,
                    ...(tools && tools.length > 0 ? { tools } : {}),
                }),
            });
            if (!geminiRes.ok) {
                const errText = await geminiRes.text();
                throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
            }
            const reader = geminiRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.slice(6));
                            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (text) { fullContent += text; sendSSE({ type: 'text', content: text }); }
                        } catch { /* skip malformed */ }
                    }
                }
            }
            sendSSE({ type: 'done', usage: {} });

        } else if (provider === 'dashscope') {
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey, baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' });
            const chatMessages = [];
            if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
            chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
            const stream = await client.chat.completions.create({
                model,
                messages: chatMessages,
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) { fullContent += content; sendSSE({ type: 'text', content }); }
            }
            sendSSE({ type: 'done', usage: {} });

        } else if (provider === 'minimax') {
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey, baseURL: 'https://api.minimax.io/v1' });
            const chatMessages = [];
            if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
            chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
            const stream = await client.chat.completions.create({
                model,
                messages: chatMessages,
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) { fullContent += content; sendSSE({ type: 'text', content }); }
            }
            sendSSE({ type: 'done', usage: {} });

        } else if (provider === 'moonshot') {
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey, baseURL: resolveMoonshotBaseURL(apiKey) });
            const chatMessages = [];
            if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
            chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
            const stream = await client.chat.completions.create({
                model,
                messages: chatMessages,
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) { fullContent += content; sendSSE({ type: 'text', content }); }
            }
            sendSSE({ type: 'done', usage: {} });

        } else if (provider === 'xiaomi') {
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey, baseURL: 'https://api.chat.xiaomi.com/v1' });
            const chatMessages = [];
            if (systemPrompt) chatMessages.push({ role: 'system', content: systemPrompt });
            chatMessages.push(...messages.map(m => ({ role: m.role, content: m.content })));
            const stream = await client.chat.completions.create({
                model,
                messages: chatMessages,
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices?.[0]?.delta?.content;
                if (content) { fullContent += content; sendSSE({ type: 'text', content }); }
            }
            sendSSE({ type: 'done', usage: {} });

        } else {
            sendSSE({ type: 'error', content: `Unsupported provider: ${provider}` });
        }
    } catch (err) {
        console.error('AI chat error:', err);
        sendSSE({ type: 'error', content: err.message || 'AI request failed' });
    }

    // Save completed result to AI card on cloud — even if client disconnected
    if (cardId && fullContent && req.userId) {
        try {
            const cardsData = await readJSON(`${req.userId}/ai-cards.json`);
            if (cardsData && Array.isArray(cardsData.cards)) {
                const card = cardsData.cards.find(c => c.id === cardId);
                if (card) {
                    card.generatedContent = fullContent;
                    card.editedContent = fullContent;
                    card.isStreaming = false;
                    card.lastGeneratedAt = Date.now();
                    await writeJSON(`${req.userId}/ai-cards.json`, { ...cardsData, updatedAt: Date.now() });
                    console.log(`[AI Chat] Saved result to card ${cardId} (${fullContent.length} chars, clientClosed=${clientClosed})`);
                }
            }
        } catch (e) {
            console.error('[AI Chat] Failed to save card result:', e);
        }
    }

    if (!clientClosed) res.end();
});

// ─── CopilotKit Runtime ───────────────────────────────────
import { CopilotRuntime, GoogleGenerativeAIAdapter, copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';

app.post('/api/copilot', async (req, res) => {
    try {
        // Use Google Gemini with user's configured API key
        const apiKey = await getUserApiKey(req.userId, 'google') || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(400).json({ error: 'No Google API key configured. Please set it in Settings.' });
        }
        // Set env vars so all underlying SDKs (@ai-sdk/google, @langchain/google-gauth) can find the key
        process.env.GOOGLE_API_KEY = apiKey;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
        const aiModel = req.headers['x-ai-model'] || 'gemini-3-flash-preview';
        const serviceAdapter = new GoogleGenerativeAIAdapter({
            model: aiModel,
            apiKey,
        });
        const runtime = new CopilotRuntime();
        const handler = copilotRuntimeNodeHttpEndpoint({
            endpoint: '/api/copilot',
            runtime,
            serviceAdapter,
        });

        await handler(req, res);
    } catch (err) {
        console.error('CopilotKit runtime error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

// ─── Sync from AI Notebook ────────────────────────────────
const AI_NOTEBOOK_API = 'https://ai-notebook-208594497704.asia-southeast1.run.app/api';
const AI_NOTEBOOK_INTERNAL_KEY = process.env.AI_NOTEBOOK_INTERNAL_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';
const AI_NOTEBOOK_USER_ID = process.env.AI_NOTEBOOK_USER_ID || 'd1c31c0c-0aa3-4ad7-8f84-f8c1b2fb1454';

// Proxy: fetch transcriptions list from ai-notebook (paginated, lightweight fields only)
app.get('/api/sync/fetch-notes', async (req, res) => {
    try {
        const allItems = [];
        let page = 1;
        const pageSize = 50; // small pages to avoid timeout
        let total = Infinity;

        while (allItems.length < total) {
            const response = await fetch(
                `${AI_NOTEBOOK_API}/transcriptions?page=${page}&pageSize=${pageSize}&sortBy=createdAt&sortOrder=desc`,
                {
                    headers: {
                        'X-Internal-API-Key': AI_NOTEBOOK_INTERNAL_KEY,
                        'X-User-Id': AI_NOTEBOOK_USER_ID,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (!response.ok) {
                const text = await response.text();
                return res.status(response.status).json({ error: `AI Notebook API error (${response.status}): ${text}` });
            }

            const data = await response.json();
            total = data.data?.total ?? 0;
            const items = data.data?.items ?? [];
            if (items.length === 0) break;

            // Strip heavy fields — only keep what SyncDialog needs for preview
            for (const item of items) {
                allItems.push({
                    id: item.id,
                    fileName: item.fileName,
                    type: item.type,
                    topic: item.topic,
                    organization: item.organization,
                    industry: item.industry,
                    country: item.country,
                    participants: item.participants,
                    intermediary: item.intermediary,
                    eventDate: item.eventDate,
                    tags: item.tags,
                    metadata: item.metadata,
                    summary: item.summary,
                    translatedSummary: item.translatedSummary,
                    createdAt: item.createdAt,
                });
            }
            page++;
        }

        res.json({ success: true, data: { items: allItems, total: allItems.length } });
    } catch (err) {
        console.error('Sync fetch-notes error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Proxy: fetch single transcription detail
app.get('/api/sync/fetch-note-detail/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const response = await fetch(`${AI_NOTEBOOK_API}/transcriptions/${noteId}`, {
            headers: {
                'X-Internal-API-Key': AI_NOTEBOOK_INTERNAL_KEY,
                'X-User-Id': AI_NOTEBOOK_USER_ID,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch note detail' });
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Sync fetch-note-detail error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── AI Industry Classification ──────────────────────────
const PORTFOLIO_API = 'https://portfolio-manager-208594497704.asia-southeast1.run.app/api';

// Cache portfolio company→{sector, ticker} mapping (refreshed every 30min)
let _portfolioCache = { data: null, ts: 0 };
async function getPortfolioMapping() {
    if (_portfolioCache.data && Date.now() - _portfolioCache.ts < 30 * 60 * 1000) {
        return _portfolioCache.data;
    }
    try {
        const resp = await fetch(`${PORTFOLIO_API}/positions`, {
            headers: {
                'X-Internal-API-Key': AI_NOTEBOOK_INTERNAL_KEY,
                'X-User-Id': AI_NOTEBOOK_USER_ID,
            },
        });
        if (!resp.ok) return {};
        const positions = await resp.json();
        const mapping = {};
        for (const p of positions) {
            const name = (p.nameEn || '').trim();
            const nameCn = (p.nameCn || '').trim();
            const sector = p.sector?.name || '';
            const ticker = (p.tickerBbg || '').split(' ')[0];
            const entry = { sector, ticker };
            if (sector) {
                if (name) mapping[name.toLowerCase()] = entry;
                if (nameCn) mapping[nameCn.toLowerCase()] = entry;
                if (ticker) mapping[ticker.toLowerCase()] = entry;
            }
        }
        _portfolioCache = { data: mapping, ts: Date.now() };
        return mapping;
    } catch (err) {
        console.error('Portfolio fetch error:', err.message);
        return {};
    }
}

app.post('/api/sync/classify', async (req, res) => {
    try {
        const { notes, industryFolders, model: classifyModel } = req.body;
        if (!notes || !industryFolders) {
            return res.status(400).json({ error: 'notes and industryFolders are required' });
        }

        const apiKey = await getUserApiKey(req.userId, 'google') || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(400).json({ error: 'No Google API key configured' });
        }

        // Pre-classify using portfolio data where possible
        const portfolioMap = await getPortfolioMapping();
        const preClassified = [];
        const needsAI = [];

        // Build fuzzy lookup
        const portfolioKeys = Object.keys(portfolioMap);

        function fuzzyMatchPortfolio(name) {
            if (!name) return null;
            const lower = name.toLowerCase();
            // Exact match
            if (portfolioMap[lower]) return portfolioMap[lower];
            // Portfolio key contains company name or vice versa
            for (const key of portfolioKeys) {
                if (key.includes(lower) || lower.includes(key)) {
                    return portfolioMap[key];
                }
            }
            return null;
        }

        for (const n of notes) {
            const company = (n.company || '').trim();

            // 1. Try portfolio mapping first
            const match = fuzzyMatchPortfolio(company);
            if (match && match.sector && industryFolders.some(f => f === match.sector)) {
                preClassified.push({ id: n.id, folder: match.sector, ticker: match.ticker || null });
                continue;
            }

            // 2. Try direct industry match from note metadata
            const noteIndustries = n.industries || [];
            if (noteIndustries.length > 0) {
                const directMatch = noteIndustries.find(ind =>
                    industryFolders.some(f => f.toLowerCase() === ind.toLowerCase())
                );
                if (directMatch) {
                    const exactFolder = industryFolders.find(f => f.toLowerCase() === directMatch.toLowerCase());
                    preClassified.push({ id: n.id, folder: exactFolder, ticker: match?.ticker || null });
                    continue;
                }
            }

            // 3. Fall through to AI classification
            needsAI.push(n);
        }

        let aiClassifications = [];

        // Only call AI for notes we couldn't pre-classify
        if (needsAI.length > 0) {
            // Build portfolio reference string (company→sector examples)
            const portfolioExamples = Object.entries(portfolioMap)
                .filter(([, entry]) => industryFolders.includes(entry.sector))
                .slice(0, 100)
                .map(([name, entry]) => `${name} → ${entry.sector}${entry.ticker ? ` (${entry.ticker})` : ''}`)
                .join('\n');

            const prompt = `你是一个行业分类专家。请将以下笔记归类到已有的行业文件夹中。

已有的行业文件夹：
${industryFolders.join('、')}

以下是已知的公司→行业映射作为参考（来自投资组合）：
${portfolioExamples}

需要归类的笔记（JSON格式）：
${JSON.stringify(needsAI.map(n => ({
                id: n.id,
                company: n.company,
                industries: n.industries,
                topic: n.topic,
                fileName: n.fileName,
            })), null, 2)}

规则：
1. 必须匹配已有的行业文件夹名称，不允许创建新文件夹
2. 参考上面的公司→行业映射，如果笔记中的公司在映射中出现，直接使用对应行业
3. 如果笔记是宏观/策略/ETF/指数/市场总体研究/行业总体研究相关，使用"_overall"
4. 如果笔记是个人相关，使用"_personal"
5. 如果实在无法匹配任何已有行业文件夹，使用"_unmatched"
6. 绝对不要创建新文件夹，一定要从已有文件夹中选择最接近的
7. 公司名称匹配时要注意简称和全称的对应，例如"地平线"和"地平线机器人"是同一家公司
8. 如果公司是上市公司，请提供其Bloomberg Ticker（不含Equity后缀，例如"AAPL"、"9888"、"1810"），不确定则留空

严格按以下JSON格式返回，不要包含其他文字：
[{"id":"笔记id","folder":"匹配的文件夹名称或_overall或_personal或_unmatched","ticker":"BBG Ticker或空字符串"}]`;

            const syncModel = classifyModel || 'gemini-3-flash-preview';
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${syncModel}:generateContent?key=${apiKey}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1 },
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                return res.status(500).json({ error: `Gemini API error: ${errText}` });
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                aiClassifications = JSON.parse(jsonMatch[0]);
            }
        }

        const classifications = [...preClassified, ...aiClassifications];
        res.json({ success: true, classifications });
    } catch (err) {
        console.error('AI classify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Notes Query (for AI cards) ───────────────────────────
// Query notes by workspace IDs and optional date range
app.post('/api/notes/query', async (req, res) => {
    try {
        const userId = req.userId;
        const { workspaceIds, canvasIds, dateFrom, dateTo, dateField } = req.body;
        const expandedWsIds = new Set(workspaceIds || []);
        const targetCanvasIds = new Set(canvasIds || []);

        const hasDateFilter = dateFrom || dateTo;
        if (expandedWsIds.size === 0 && targetCanvasIds.size === 0 && !hasDateFilter) {
            return res.status(400).json({ error: 'workspaceIds, canvasIds, or date range required' });
        }

        const allWorkspaces = await readIndex(userId, 'workspaces');
        const allCanvases = await readIndex(userId, 'canvases');
        const wsById = new Map(allWorkspaces.map(w => [w.id, w]));

        // Find canvases: if no workspace/canvas IDs specified, search all canvases (date-only mode)
        const dateOnly = expandedWsIds.size === 0 && targetCanvasIds.size === 0;
        const targetCanvases = dateOnly
            ? allCanvases
            : allCanvases.filter(c => expandedWsIds.has(c.workspaceId) || targetCanvasIds.has(c.id));

        const notes = [];
        const dateFromTs = dateFrom ? new Date(dateFrom).getTime() : null;
        const dateToTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null;

        const CHUNK_SIZE = 50;
        for (let i = 0; i < targetCanvases.length; i += CHUNK_SIZE) {
            const chunk = targetCanvases.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (canvasMeta) => {
                try {
                    const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                    if (!bundle) return;

                    for (const [nodeId, nodeData] of Object.entries(bundle)) {
                        if (!nodeData || nodeData.type !== 'markdown' || !nodeData.content) continue;

                        // Extract dates from content based on dateField preference
                        const content = nodeData.content;
                        let noteDate = null;
                        const useCreated = dateField === 'created';

                        const createRegex = /(?:\*\*创建时间\*\*[：:]?\s*|\|\s*创建时间\s*\|\s*|-?\s*创建时间[：:]?\s*)([\d/.-]{6,10})/;
                        const dateRegex = /(?:\*\*发生日期\*\*[：:]?\s*|\|\s*发生日期\s*\|\s*|-?\s*发生日期[：:]?\s*)([\d/.-]{6,10})/;
                        const titleRegex = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/;

                        const tryExtract = (regex) => {
                            const match = content.match(regex);
                            return match ? match[1] : null;
                        };

                        if (useCreated) {
                            if (nodeData.metadata && nodeData.metadata['创建时间']) noteDate = nodeData.metadata['创建时间'];
                            if (!noteDate) noteDate = tryExtract(createRegex);
                            if (!noteDate && nodeData.metadata && nodeData.metadata['发生日期']) noteDate = nodeData.metadata['发生日期'];
                            if (!noteDate) noteDate = tryExtract(dateRegex);
                        } else {
                            if (nodeData.metadata && nodeData.metadata['发生日期']) noteDate = nodeData.metadata['发生日期'];
                            if (!noteDate) noteDate = tryExtract(dateRegex);
                            if (!noteDate && nodeData.metadata && nodeData.metadata['创建时间']) noteDate = nodeData.metadata['创建时间'];
                            if (!noteDate) noteDate = tryExtract(createRegex);
                        }

                        // Fallback to title strings which often contain dates like 2026/03/29
                        if (!noteDate) {
                            const titleMatch = (nodeData.title || canvasMeta.title || '').match(titleRegex);
                            if (titleMatch) noteDate = titleMatch[1];
                        }

                        // Absolute fallback to canvas createdAt
                        if (!noteDate && canvasMeta.createdAt) {
                            noteDate = new Date(canvasMeta.createdAt).toISOString().slice(0, 10);
                        }

                        // Date filter
                        if (noteDate && (dateFromTs || dateToTs)) {
                            const ts = new Date(noteDate).getTime();
                            if (isNaN(ts)) { /* skip filter if date parse fails */ }
                            else {
                                if (dateFromTs && ts < dateFromTs) continue;
                                if (dateToTs && ts > dateToTs) continue;
                            }
                        }

                        const ws = wsById.get(canvasMeta.workspaceId);
                        notes.push({
                            id: nodeId,
                            canvasId: canvasMeta.id,
                            title: nodeData.title || canvasMeta.title,
                            content: nodeData.content,
                            workspaceId: canvasMeta.workspaceId,
                            workspaceName: ws?.name || '',
                            date: noteDate,
                            metadata: nodeData.metadata || {},
                        });
                    }
                } catch {
                    // skip errors on individual canvases
                }
            }));
        }
        // Guarantee deterministic order so AI reference indices remain stable across requests
        notes.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            if (dateA !== dateB) {
                // Handle invalid dates falling to 0
                return dateB - dateA;
            }
            return a.id.localeCompare(b.id);
        });

        res.json({ success: true, notes, total: notes.length });
    } catch (err) {
        console.error('Notes query error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Batch Sync Import ────────────────────────────────────
// Accepts multiple canvases with their node data in one request.
// Writes individual files in parallel, but only updates the index ONCE.
app.post('/api/sync/batch-import', async (req, res) => {
    try {
        const { canvases } = req.body; // [{id, workspaceId, title, nodes: [{id, type, data, isMain}]}]
        if (!canvases || !Array.isArray(canvases)) {
            return res.status(400).json({ error: 'canvases array required' });
        }

        const userId = req.userId;
        const now = Date.now();

        // Write each canvas file + node data in parallel
        const writes = canvases.map(async (canvas) => {
            const nodeBundle = {};
            const nodesWithoutData = (canvas.nodes || []).map(n => {
                if (n.data) {
                    nodeBundle[n.id] = n.data;
                }
                return { id: n.id, type: n.type, position: n.position || { x: 0, y: 0 }, size: n.size, isMain: n.isMain };
            });

            const canvasDoc = {
                id: canvas.id,
                workspaceId: canvas.workspaceId,
                title: canvas.title,
                template: 'custom',
                modules: [],
                nodes: nodesWithoutData,
                edges: [],
                viewport: { x: 0, y: 0, zoom: 1 },
                createdAt: canvas.createdAt || now,
                updatedAt: now,
            };

            await writeJSON(`${userId}/canvases/${canvas.id}.json`, canvasDoc);
            if (Object.keys(nodeBundle).length > 0) {
                await writeJSON(`${userId}/canvas-data/${canvas.id}.json`, nodeBundle);
            }

            return canvasDoc;
        });

        const writtenCanvases = await Promise.all(writes);

        // Update canvases index ONCE
        const existingIndex = await readIndex(userId, 'canvases');
        const existingIds = new Set(existingIndex.map(c => c.id));
        for (const c of writtenCanvases) {
            if (!existingIds.has(c.id)) {
                existingIndex.push(canvasMetaForIndex(c));
            }
        }
        await writeIndex(userId, 'canvases', existingIndex);

        // Update workspace canvasIds ONCE per affected workspace
        const workspaceIndex = await readIndex(userId, 'workspaces');
        const wsMap = new Map(workspaceIndex.map(w => [w.id, w]));
        for (const c of writtenCanvases) {
            const ws = wsMap.get(c.workspaceId);
            if (ws) {
                if (!ws.canvasIds) ws.canvasIds = [];
                if (!ws.canvasIds.includes(c.id)) {
                    ws.canvasIds.push(c.id);
                    ws.updatedAt = now;
                }
            }
        }
        // Write updated workspaces
        const affectedWs = writtenCanvases.map(c => wsMap.get(c.workspaceId)).filter(Boolean);
        const uniqueWs = [...new Map(affectedWs.map(w => [w.id, w])).values()];
        await Promise.all(uniqueWs.map(w => writeJSON(`${userId}/workspaces/${w.id}.json`, w)));
        await writeIndex(userId, 'workspaces', workspaceIndex);

        invalidateUserCache(userId);

        res.json({ success: true, imported: writtenCanvases.length });
    } catch (err) {
        console.error('Batch import error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── AI Process → Canvas Sync ─────────────────────────────
// Classify AI Process transcriptions into industry folders (preview only, no writes)
app.post('/api/canvas-sync/classify', async (req, res) => {
    try {
        const { transcriptionIds, model: canvasClassifyModel } = req.body;
        if (!transcriptionIds || !Array.isArray(transcriptionIds)) {
            return res.status(400).json({ error: 'transcriptionIds array required' });
        }

        const userId = req.userId;

        // 1. Fetch transcription data from aiprocess-api
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

        // Fetch each transcription's details
        const transcriptions = [];
        for (const id of transcriptionIds) {
            const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${id}`, {
                headers: { 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
            });
            if (resp.ok) {
                const data = await resp.json();
                transcriptions.push(data.data || data);
            }
        }

        if (transcriptions.length === 0) {
            return res.json({ success: true, classifications: [] });
        }

        // 2. Get existing industry workspace names as industryFolders
        const allWorkspaces = await readIndex(userId, 'workspaces');
        const industryWorkspaces = allWorkspaces.filter(w => (!w.category || w.category === 'industry') && !w.parentId);
        const industryFolders = industryWorkspaces.map(w => w.name);

        // 3. Build notes array for classification
        // Collect industry info from multiple fields: industry, sectorName, tags
        const notes = transcriptions.map(t => {
            const industries = [];
            if (t.industry) industries.push(t.industry);
            if (t.sectorName) industries.push(t.sectorName);
            // Also try to extract from tags
            if (Array.isArray(t.tags)) {
                for (const tag of t.tags) {
                    if (industryFolders.some(f => f.toLowerCase() === tag.toLowerCase())) {
                        industries.push(tag);
                    }
                }
            }
            return {
                id: t.id,
                company: t.organization || '',
                industries: [...new Set(industries)],
                topic: t.topic || '',
                fileName: t.fileName || '',
            };
        });
        console.log('[canvas-sync classify] industryFolders:', JSON.stringify(industryFolders));
        console.log('[canvas-sync classify] notes:', JSON.stringify(notes.map(n => ({ id: n.id, company: n.company, industries: n.industries }))));

        // 4. Classify using existing logic (Portfolio + AI)
        const apiKey = await getUserApiKey(userId, 'google') || process.env.GOOGLE_API_KEY;

        const portfolioMap = await getPortfolioMapping();
        const portfolioKeys = Object.keys(portfolioMap);

        function fuzzyMatchPortfolio(name) {
            if (!name) return null;
            const lower = name.toLowerCase();
            if (portfolioMap[lower]) return portfolioMap[lower];
            // Strip ticker prefix: "[300274 CH] 阳光电源股份有限公司" → "阳光电源股份有限公司"
            const stripped = lower.replace(/^\[.*?\]\s*/, '');
            if (stripped !== lower && portfolioMap[stripped]) return portfolioMap[stripped];
            for (const key of portfolioKeys) {
                if (key.includes(lower) || lower.includes(key)) return portfolioMap[key];
                if (stripped && stripped !== lower && (key.includes(stripped) || stripped.includes(key))) return portfolioMap[key];
            }
            return null;
        }

        const knownIndustries = new Set([
            '核电', '铜金', '铁', '铝', '航空航天', '五金工具', '泛工业', '工业软件', '稀土', 'LNG', '煤', 'EPC',
            '互联网/大模型', 'bitcoin miner', '军工', '卡车', '基建地产链条', '天然气发电', '战略金属', '报废车',
            '数据中心设备', '煤电', '石油', '车险', '钠电', '电网设备', '汽车', '零部件', '锂电',
            '电力运营商', '工程机械/矿山机械', '两轮车/全地形车', '风光储', '轨道交通', '机器人/工业自动化',
            '检测服务', '自动驾驶', '轮胎', '工业MRO', '设备租赁', '天然气管道',
            '暖通空调/楼宇设备', '农用机械', '航运', '海运', '铁路', '车运/货代', '非电消纳', '造船', '创新消费品',
            '政治', '宏观',
        ]);

        const preClassified = [];
        const needsAI = [];

        for (const n of notes) {
            const company = (n.company || '').trim();

            // 1. 无脑直接匹配行业：如果笔记有自己的行业字段，无视验证直接使用它当做文件夹名称
            if (n.industries && n.industries.length > 0) {
                const directFolder = n.industries[0].trim();
                const match = fuzzyMatchPortfolio(company); // 拿 ticker 给后续用
                preClassified.push({ id: n.id, folder: directFolder, ticker: match?.ticker || '' });
                continue;
            }

            // 2. 如果笔记没有行业字段，才走大模型兜底分配
            needsAI.push(n);
        }

        let aiClassifications = [];
        if (needsAI.length > 0 && apiKey) {
            const portfolioExamples = Object.entries(portfolioMap)
                .slice(0, 100)
                .map(([name, entry]) => `${name} → ${entry.sector}${entry.ticker ? ` (${entry.ticker})` : ''}`)
                .join('\n');

            const allValidFolders = [...new Set([...industryFolders, ...knownIndustries])];

            const prompt = `你是一个行业分类专家。请将以下笔记归类到合适的行业文件夹中。

可用的行业文件夹（优先使用已有的，必要时可使用新的）：
已有文件夹：${industryFolders.join('、') || '（暂无）'}
已知的标准行业分类：${allValidFolders.join('、')}

以下是已知的公司→行业映射作为参考（来自投资组合）：
${portfolioExamples}

需要归类的笔记（JSON格式）：
${JSON.stringify(needsAI.map(n => ({ id: n.id, company: n.company, topic: n.topic, fileName: n.fileName })), null, 2)}

规则：
1. 请根据笔记标题、话题或公司名，从已知的行业文件夹中为其挑选一个最合适的行业作为 folder
2. 如果没有任何匹配的已有行业，你可以为它自行命名一个新的标准行业
3. 如果笔记是宏观/策略/总体研究相关，使用"_overall"
4. 如果笔记倾向个人研究，使用"_personal"
5. 如果实在无法归类，使用"_unmatched"
6. 公司名称匹配时要注意简称和全称的对应
7. 核心规则：如果传入的 company 名称中已经包含方括号包裹的代码（如 [Private]、[xxx US]、[002484 CH] 等），或是非上市公司，ticker 字段必须绝对为空字符串 ""！
8. 只有当公司确实是上市企业且公司名称里没有代码前缀时，才可以在 ticker 字段返回其 Bloomberg Ticker。切勿瞎猜。

严格按以下JSON格式返回，不要包含其他文字：
[{"id":"笔记id","folder":"匹配的文件夹名称或_overall或_personal或_unmatched","ticker":"BBG Ticker或空字符串"}]`;

            try {
                const csModel = canvasClassifyModel || 'gemini-3-flash-preview';
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${csModel}:generateContent?key=${apiKey}`;
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.1 },
                    }),
                });
                if (response.ok) {
                    const data = await response.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const jsonMatch = text.match(/\[[\s\S]*\]/);
                    if (jsonMatch) aiClassifications = JSON.parse(jsonMatch[0]);
                }
            } catch (err) {
                console.error('AI classify error for canvas-sync:', err.message);
            }
        }

        const allClassifications = [...preClassified, ...aiClassifications];

        // 5. Build rich classification results with transcription info
        const allCanvases = await readIndex(userId, 'canvases');
        const wsById = new Map(allWorkspaces.map(w => [w.id, w]));

        const classifications = transcriptions.map(t => {
            const cls = allClassifications.find(c => c.id === t.id) || { folder: '_unmatched', ticker: '' };
            const folder = cls.folder || '_unmatched';
            const ticker = cls.ticker || '';
            const organization = t.organization || '';

            // Determine target canvas name
            const participants = (t.participants || '').toLowerCase().replace(/[^a-z]/g, '');
            let canvasName = '';
            if (organization) {
                const trimmedOrg = organization.trim();
                // [Private] 公司归入 Expert 画布，不单独建公司画布
                if (trimmedOrg.toLowerCase().startsWith('[private]')) {
                    canvasName = 'Expert';
                } else if (trimmedOrg.startsWith('[')) {
                    canvasName = trimmedOrg;
                } else {
                    canvasName = ticker ? `[${ticker}] ${organization}` : organization;
                }
            } else if (participants.includes('expert')) {
                canvasName = 'Expert';
            } else if (participants.includes('sellside')) {
                canvasName = 'Sellside';
            } else {
                canvasName = '行业研究';
            }

            // Check if workspace and canvas already exist
            const targetWs = allWorkspaces.find(w => w.name === folder && (!w.category || w.category === 'industry') && !w.parentId);
            let isNewWorkspace = !targetWs;
            let isNewCanvas = true;

            if (targetWs) {
                // Look for canvas under this workspace
                const wsCanvases = allCanvases.filter(c => c.workspaceId === targetWs.id);
                const existingCanvas = wsCanvases.find(c => {
                    const cTitle = c.title.toLowerCase();
                    const target = canvasName.toLowerCase();
                    return cTitle === target || cTitle.includes(target) || target.includes(cTitle);
                });
                if (existingCanvas) isNewCanvas = false;
            }

            return {
                id: t.id,
                fileName: t.fileName || '',
                organization,
                folder,
                canvasName,
                ticker,
                isNewWorkspace,
                isNewCanvas,
            };
        });

        res.json({ success: true, classifications });
    } catch (err) {
        console.error('Canvas-sync classify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Execute AI Process → Canvas sync (after user confirms classification)
app.post('/api/canvas-sync/execute', async (req, res) => {
    try {
        const { items } = req.body;
        // items: [{transcriptionId, folder, canvasName, ticker}]
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'items array required' });
        }

        const userId = req.userId;
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';
        const now = Date.now();

        // 1. Fetch full transcription data
        const transcriptionMap = new Map();
        for (const item of items) {
            if (transcriptionMap.has(item.transcriptionId)) continue;
            const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${item.transcriptionId}`, {
                headers: { 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
            });
            if (resp.ok) {
                const data = await resp.json();
                transcriptionMap.set(item.transcriptionId, data.data || data);
            }
        }

        // 2. Load workspace and canvas indexes
        const allWorkspaces = await readIndex(userId, 'workspaces');
        const allCanvases = await readIndex(userId, 'canvases');
        const wsById = new Map(allWorkspaces.map(w => [w.id, w]));

        // 3. Group items by folder → canvasName
        const groups = new Map(); // key: `${folder}::${canvasName}`, value: {folder, canvasName, transcriptions: []}
        for (const item of items) {
            const t = transcriptionMap.get(item.transcriptionId);
            if (!t) continue;
            const key = `${item.folder}::${item.canvasName}`;
            if (!groups.has(key)) {
                groups.set(key, { folder: item.folder, canvasName: item.canvasName, ticker: item.ticker, transcriptions: [] });
            }
            groups.get(key).transcriptions.push(t);
        }

        // 4. For each group: find/create workspace + canvas, build nodes
        const canvasesToImport = [];
        const results = [];

        for (const [, group] of groups) {
            // Find or create workspace
            let ws = allWorkspaces.find(w => w.name === group.folder && (!w.category || w.category === 'industry') && !w.parentId);
            if (!ws) {
                ws = {
                    id: `ws-${now}-${crypto.randomUUID().slice(0, 8)}`,
                    name: group.folder,
                    icon: '📁',
                    category: 'industry',
                    canvasIds: [],
                    createdAt: now,
                    updatedAt: now,
                };
                await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
                allWorkspaces.push(ws);
                wsById.set(ws.id, ws);
            }

            // Find or create canvas
            const wsCanvases = allCanvases.filter(c => c.workspaceId === ws.id);
            let canvas = wsCanvases.find(c => {
                const cTitle = c.title.toLowerCase();
                const target = group.canvasName.toLowerCase();
                return cTitle === target || cTitle.includes(target) || target.includes(cTitle);
            });

            let existingNodes = [];
            if (canvas) {
                // Load existing nodes to avoid duplicates and calculate positions
                try {
                    const bundle = await readJSON(`${userId}/canvas-data/${canvas.id}.json`);
                    if (bundle) existingNodes = Object.keys(bundle);
                } catch { /* empty */ }
            } else {
                canvas = {
                    id: `canvas-${now}-${crypto.randomUUID().slice(0, 8)}`,
                    workspaceId: ws.id,
                    title: group.canvasName,
                    nodes: [],
                    createdAt: now,
                    updatedAt: now,
                };
            }

            // Build nodes for each transcription
            const newNodes = [];
            let nodeIndex = existingNodes.length;

            for (const t of group.transcriptions) {
                // Dedup by sourceId
                // Check existing bundle for this transcription's sourceId
                if (existingNodes.length > 0) {
                    try {
                        const bundle = await readJSON(`${userId}/canvas-data/${canvas.id}.json`);
                        if (bundle) {
                            const hasDup = Object.values(bundle).some(n => n?.metadata?.sourceId === t.id);
                            if (hasDup) {
                                results.push({ id: t.id, fileName: t.fileName, folder: group.folder, canvas: group.canvasName, status: 'skipped' });
                                continue;
                            }
                        }
                    } catch { /* no bundle yet */ }
                }

                const content = t.translatedSummary || t.summary || '';
                let parsedTags = [];
                try { parsedTags = typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []); } catch { /* ignore */ }

                const nodeId = `node-${now}-${crypto.randomUUID().slice(0, 8)}`;
                const nodeData = {
                    type: 'markdown',
                    title: t.fileName || 'AI Process Note',
                    content,
                    metadata: {
                        sourceId: t.id,
                        '来源': 'AI Process',
                        ...(t.topic ? { '主题': t.topic } : {}),
                        ...(t.organization ? { '公司': t.organization } : {}),
                        ...(t.industry ? { '行业': t.industry } : {}),
                        ...(t.country ? { '国家': t.country } : {}),
                        ...(t.participants ? { '参与人': t.participants } : {}),
                        ...(t.intermediary ? { '中介': t.intermediary } : {}),
                        ...(t.eventDate ? { '发生日期': t.eventDate } : {}),
                        '创建时间': t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                    },
                    tags: parsedTags,
                };

                newNodes.push({
                    id: nodeId,
                    type: 'markdown',
                    data: nodeData,
                    position: { x: nodeIndex * 620, y: 0 },
                    size: { w: 600, h: 400 },
                });

                results.push({ id: t.id, fileName: t.fileName, folder: group.folder, canvas: group.canvasName, status: 'synced' });
                nodeIndex++;
            }

            if (newNodes.length > 0) {
                canvasesToImport.push({
                    id: canvas.id,
                    workspaceId: ws.id,
                    title: canvas.title || group.canvasName,
                    createdAt: canvas.createdAt || now,
                    nodes: newNodes,
                });
            }
        }

        // 5. Batch import using existing logic
        if (canvasesToImport.length > 0) {
            const writes = canvasesToImport.map(async (canvas) => {
                // Load existing node bundle and merge
                let existingBundle = {};
                try {
                    existingBundle = await readJSON(`${userId}/canvas-data/${canvas.id}.json`) || {};
                } catch { /* no existing bundle */ }

                const nodeBundle = { ...existingBundle };
                const nodesWithoutData = [];

                // Load existing canvas doc for existing nodes
                let existingCanvasDoc = null;
                try {
                    existingCanvasDoc = await readJSON(`${userId}/canvases/${canvas.id}.json`);
                } catch { /* new canvas */ }

                const existingNodeRefs = existingCanvasDoc?.nodes || [];

                for (const n of canvas.nodes) {
                    if (n.data) nodeBundle[n.id] = n.data;
                    nodesWithoutData.push({ id: n.id, type: n.type, position: n.position, size: n.size });
                }

                const canvasDoc = {
                    ...(existingCanvasDoc || {}),
                    id: canvas.id,
                    workspaceId: canvas.workspaceId,
                    title: canvas.title,
                    template: existingCanvasDoc?.template || 'custom',
                    modules: existingCanvasDoc?.modules || [],
                    nodes: [...existingNodeRefs, ...nodesWithoutData],
                    edges: existingCanvasDoc?.edges || [],
                    viewport: existingCanvasDoc?.viewport || { x: 0, y: 0, zoom: 1 },
                    createdAt: canvas.createdAt,
                    updatedAt: now,
                };

                await writeJSON(`${userId}/canvases/${canvas.id}.json`, canvasDoc);
                await writeJSON(`${userId}/canvas-data/${canvas.id}.json`, nodeBundle);

                return canvasDoc;
            });

            const writtenCanvases = await Promise.all(writes);

            // Update indexes
            const existingCanvasIndex = await readIndex(userId, 'canvases');
            const existingIds = new Set(existingCanvasIndex.map(c => c.id));
            for (const c of writtenCanvases) {
                if (existingIds.has(c.id)) {
                    // Update existing entry
                    const idx = existingCanvasIndex.findIndex(ec => ec.id === c.id);
                    if (idx >= 0) existingCanvasIndex[idx] = canvasMetaForIndex(c);
                } else {
                    existingCanvasIndex.push(canvasMetaForIndex(c));
                }
            }
            await writeIndex(userId, 'canvases', existingCanvasIndex);

            // Update workspace canvasIds
            const workspaceIndex = await readIndex(userId, 'workspaces');
            const wsMap = new Map(workspaceIndex.map(w => [w.id, w]));
            for (const c of writtenCanvases) {
                const ws = wsMap.get(c.workspaceId);
                if (ws) {
                    if (!ws.canvasIds) ws.canvasIds = [];
                    if (!ws.canvasIds.includes(c.id)) {
                        ws.canvasIds.push(c.id);
                        ws.updatedAt = now;
                    }
                }
            }
            const affectedWs = writtenCanvases.map(c => wsMap.get(c.workspaceId)).filter(Boolean);
            const uniqueWs = [...new Map(affectedWs.map(w => [w.id, w])).values()];
            await Promise.all(uniqueWs.map(w => writeJSON(`${userId}/workspaces/${w.id}.json`, w)));
            await writeIndex(userId, 'workspaces', workspaceIndex);

            invalidateUserCache(userId);
        }

        // 6. Mark transcriptions as synced via aiprocess-api
        const syncedIds = results.filter(r => r.status === 'synced').map(r => r.id);
        if (syncedIds.length > 0) {
            try {
                const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
                const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';
                await fetch(`${AIPROCESS_BASE}/api/transcriptions/mark-synced-to-canvas`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
                    body: JSON.stringify({ ids: syncedIds }),
                });
            } catch (err) {
                console.error('Failed to mark transcriptions as synced:', err.message);
            }
        }

        const synced = results.filter(r => r.status === 'synced').length;
        const skipped = results.filter(r => r.status === 'skipped').length;
        res.json({ success: true, synced, skipped, results });
    } catch (err) {
        console.error('Canvas-sync execute error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Canvas ↔ AI Process live content bridge ───────────────
// GET /api/canvas-sync/transcription-content/:id — fetch live content from AI Process
app.get('/api/canvas-sync/transcription-content/:transcriptionId', async (req, res) => {
    try {
        const { transcriptionId } = req.params;
        const userId = req.userId;
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

        const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${transcriptionId}`, {
            headers: { 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
        });
        if (!resp.ok) return res.status(resp.status).json({ error: 'Transcription not found' });

        const data = await resp.json();
        const t = data.data || data;
        const content = t.translatedSummary || t.summary || '';
        let tags = [];
        try { tags = typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []); } catch { /* ignore */ }

        res.json({
            success: true,
            transcriptionId,
            content,
            title: t.fileName,
            tags,
            metadata: {
                sourceId: t.id,
                '来源': 'AI Process',
                ...(t.topic ? { '主题': t.topic } : {}),
                ...(t.organization ? { '公司': t.organization } : {}),
                ...(t.industry ? { '行业': t.industry } : {}),
                ...(t.country ? { '国家': t.country } : {}),
                ...(t.participants ? { '参与人': t.participants } : {}),
                ...(t.intermediary ? { '中介': t.intermediary } : {}),
                ...(t.eventDate && t.eventDate !== '未提及' ? { '发生日期': t.eventDate } : {}),
                '创建时间': t.createdAt ? new Date(t.createdAt).toISOString().slice(0, 10) : '',
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/canvas-sync/transcription-title/:id — write canvas title back to AI Process fileName
app.patch('/api/canvas-sync/transcription-title/:transcriptionId', async (req, res) => {
    try {
        const { transcriptionId } = req.params;
        const { title } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

        const userId = req.userId;
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

        const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${transcriptionId}/file-name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
            body: JSON.stringify({ fileName: title.trim() }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: 'Failed to update title' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/canvas-sync/transcription-metadata/:id — write canvas metadata back to AI Process
app.patch('/api/canvas-sync/transcription-metadata/:transcriptionId', async (req, res) => {
    try {
        const { transcriptionId } = req.params;
        const { topic, organization, intermediary, industry, country, participants, eventDate, speaker } = req.body;

        const userId = req.userId;
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

        const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${transcriptionId}/metadata`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
            body: JSON.stringify({ topic, organization, intermediary, industry, country, participants, eventDate, speaker }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: 'Failed to update metadata' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/canvas-sync/transcription-content/:id — write edited content back to AI Process
app.patch('/api/canvas-sync/transcription-content/:transcriptionId', async (req, res) => {
    try {
        const { transcriptionId } = req.params;
        const { content } = req.body;
        if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });

        const userId = req.userId;
        const AIPROCESS_BASE = `http://localhost:${process.env.AIPROCESS_PORT || 8081}`;
        const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'nb-internal-sk-a8f3e7b2c1d4f6e9a0b5c8d7e2f1a4b3';

        const resp = await fetch(`${AIPROCESS_BASE}/api/transcriptions/${transcriptionId}/translated-summary`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': INTERNAL_KEY, 'X-User-Id': userId },
            body: JSON.stringify({ translatedSummary: content }),
        });
        if (!resp.ok) return res.status(resp.status).json({ error: 'Failed to update transcription' });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── One-time Migration: Reorganize industry folders ──────
// POST /api/migrate/reorganize
// Creates missing small-category folders, company sub-folders,
// and 行业研究/Expert/Sellside folders under each small category.
// Merges duplicate companies. Never deletes canvases.

const INDUSTRY_COMPANIES = {
    '农用机械': ['[DE US] Deere & Company', '[Private] Sandhills Global'],
    '五金工具': ['[002444 CH] 杭州巨星科技股份有限公司', '[0669 HK] 创科实业有限公司'],
    '军工': ['[7011 JP] Mitsubishi Heavy Industries Ltd', '[BEL IN] Bharat Electronics Ltd.', '[CACI US] CACI International Inc.', '[LMT US] Lockheed Martin Corp', '[NOC US] Northrop Grumman Corp', '[Private] Arc Media'],
    '卡车': ['[000951 CH] 中国重汽', '[3808 HK] 中国重汽(香港)有限公司', '[543228 IN] BLR Logistics (India) Limited', '[Private] 徐工汽车'],
    '基建地产链条': ['[Private] ConstructConnect', '[1803 JP] Shimizu Corp.', '[BHP AU] BHP Group Ltd', '[LPX US] Louisiana-Pacific Corporation', '[Private] SRM Concrete'],
    '工程机械/矿山机械': ['[000157 CH] 中联重科', '[000425 CH] 徐工机械', '[000680 CH] 山推工程机械股份有限公司', '[300818 CH] 耐普矿机股份有限公司', '[600031 CH] 三一重工', '[600162 CH] 山东临工', '[601100 CH] 恒立液压', '[CAT US] Caterpillar Inc.', '[SAND SS] Sandvik AB'],
    '机器人/工业自动化': ['[002050 CH] 三花智控', '[002472 CH] 双环传动', '[179 HK] 德昌电机控股', '[300124 CH] 汇川技术', '[300953 CH] 震裕科技', '[601689 CH] 拓普集团', '[603337 CH] 杰克缝纫机股份有限公司', '[6273 JP] SMC Corp.', '[6506 JP] Yaskawa', '[6861 JP] KEYENCE ORD', '[7012 JP] Kawasaki', '[9880 HK] 优必选', '[HON US] Honeywell International Inc.', '[Private] Neuralink Corporation', '[Private] 强脑科技', '[Private] 微亿智造', '[Private] 梅卡曼德机器人', '[Private] 灵犀巧手', '[ROK US] ROCKWELL AUTOMAT ORD', '[SHA GY] Schaeffler AG', '[TSLA US] TESLA ORD', '[Private] 巨生智能'],
    '泛工业': ['D', '[300677 CH] 英科医疗'],
    '自动驾驶': ['[9660 HK] 地平线', '[NVDA US] NVIDIA Corp', '[Private] Kodiak Robotics', '[Private] テクノシステムリサーチ', '[Private] 九识智能', '[Private] 小马智行', '[Private] 希迪智驾', '[TSLA US] TESLA ORD', '[WRD US] WERIDE-W ORD'],
    '航空航天': ['[BA US] The Boeing Company', '[EH US] EHang Holdings Ltd.', '[FTAI US] Fortress Transportation and Infrastructure Investors LLC', '[GE US] GE Aerospace', '[HWM US] Howmet Aerospace Inc.', '[MTX GR] MTU Aero Engines AG', '[Private] Precision Castparts Corp.', '[Private] SpaceX', '[Private] Starlink', '[Private] 宝武特钢集团有限公司', '[Private] 宝钢特钢有限公司', '[Private] 蓝箭航天', '[RTX US] RTX Corp'],
    '钠电': ['[002324 CH] 上海普利特复合材料股份有限公司', '[300438 CH] 鹏辉能源', '[300750 CH] 宁德时代', '[3931 HK] 中创新航', '[600152 CH] 维科技术'],
    '锂电': ['[000695 CH] 天津滨海能源发展股份有限公司', '[002444 CH] 杭州巨星科技股份有限公司', '[300014 CH] 亿纬锂能', '[300750 CH] 宁德时代', '[603659 CH] 上海璞泰来新能源科技股份有限公司', '[688005 CH] 容百科技'],
    '零部件': ['[600885 CH] 宏发股份'],
    'EPC': ['[1801 JP] Taisei Corp', '[1802 JP] 大林組', '[1820 JP] Nishimatsu Construction Co Ltd', '[1952 JP] 新日本空調株式会社', '[FIX US] Comfort Systems USA', '[PWR US] Quanta Services Inc.', '[Private] コムシスホールディングス'],
    '设备租赁': ['[Private] Equipment Share'],
    '宏观': ['[BAC US] Bank of America Corporation'],
    '有色金属': ['[600549 CH] 厦门钨业股份有限公司'],
    '未归类': ['Oracle'],
    '金属与矿业': ['SMM (上海有色网)'],
    '两轮车/全地形车': ['[1585 HK] 雅迪', '[301345 CH] 浙江涛涛车业股份有限公司', '[301345 CH] 涛涛车业', '[603129 CH] 春风动力', '[689009 CH] 九号公司', '[PII US] Polaris Inc', '[SKIL US] Skillsoft Corp'],
    '创新消费品': ['[300866 CH] 安克创新'],
    '报废车': ['[CPRT US] COPART ORD'],
    '汽车': ['[002594 CH] 比亚迪股份有限公司', '[005380 KS] HYUNDAI MOTOR ORD', '[0175 HK] Geely Automobile Holdings Ltd.', '[300750 CH] 宁德时代', '[600104 CH] 零跑汽车', '[9973 HK] 奇瑞汽车', '[MSIL IN] MARUTI SUZUKI INDIA ORD', '[NIO US] NIO-SW ORD'],
    '车运/货代': ['[CHRW US] C.H. Robinson Worldwide Inc.', '[JBHT US] J.B. Hunt Transport Services Inc', '[LSTR US] LANDSTAR SYSTEM ORD', '[R US] Ryder System Inc'],
    '造船': ['[267260 KS] HD HYUNDAI ELECTRIC ORD'],
    'bitcoin miner': ['[IREN US] IREN ORD'],
    '天然气发电': ['[000338 CH] 潍柴动力', '[002353 CH] 杰瑞股份', '[002534 CH] 西子洁能', '[600875 CH] 东方电气股份有限公司', '[601727 CH] 上海电气', '[603308 CH] 应流集团股份有限公司', '[7011 JP] 三菱重工業株式会社', '[BE US] BLOOM ENERGY CL A ORD', '[CAT US] 卡特彼勒', '[ENR GR] SIEMENS ENERGY N ORD', '[FTAI US] Fortress Transportation and Infrastructure Investors LLC', '[GEV US] GE VERNOVA', '[Private] Enchanted Rock', '[Private] 杭汽轮'],
    '核电': ['[Private] Sprott', '[826 HK] 天工国际', '[CCJ US] CAMECO ORD', '[CCJ US] Cameco Corp', '[KAP LI] KAZATOMPROM NAC ORD', '[MIR US] MIRION TECHNOLOGIES CL A ORD', '[Private] Commonwealth Fusion Systems', '[Private] DeepFission', '[Private] Tennessee Valley Authority', '[Private] 电力公司'],
    '电力运营商': ['[0916 HK] 龙源电力', '[3996 HK] 中国能源建设股份有限公司', '[600011 CH] 华能国际电力股份有限公司', '[600795 CH] 国电电力', '[836 HK] China Resources Power Holdings Co Ltd', '[A2A IM] A2A S.p.A.', '[AGX US] ARGAN ORD', '[D US] Dominion Energy', '[EDP PT] EDP - Energias de Portugal SA', '[ELI BB] Elia Group', '[EXC US] Exelon Corporation', '[MSFT US] Microsoft Corp', '[NG/ LN] National Grid plc', '[Private] Austrian Power Grid AG', '[Private] McKinsey & Company', '[Private] PJM Interconnection', '[Private] Tennessee Valley Authority', '[Private] chess', '[Private] 中国南方电网有限责任公司', '[Private] 国家电网', '[Private] 西安风平能源科技有限公司', '[Private] 达宝智能', '[RWE GR] RWE AG', '[Private] 电力公司'],
    '电网设备': ['[Private] National grid', '[Private] Red Electrica', '[002028 CH] 思源电气', '[267260 KS] HD HYUNDAI ELECTRIC ORD', '[POWL US] Powell Industries Inc.', '[Private] Commercial Cash', '[Private] MR', '[Private] 江苏华鹏变压器有限公司'],
    '风光储': ['[000725 CH] 京东方科技集团股份有限公司', '[002202 CH] 金风科技', '[066970 KS] L&F', '[300750 CH] 宁德时代', '[300751 CH] 迈为股份', '[605117 CH] 德业股份', '[688223 CH] 晶科能源股份有限公司', '[688390 CH] 固德威', '[ANE SM] Acciona Energía SA', '[CSIQ US] Canadian Solar Inc', '[CWR LN] Ceres Power Holdings plc', '[FSLR US] First Solar', '[Private] 中国长江三峡集团有限公司', '[Private] 发电集团', '[Private] 国家电网', '[Private] 欣界能源', '[Private] 华电新能源'],
    '互联网/大模型': ['[0700 HK] Tencent Holdings Ltd.', '[AMZN US] Amazon.com Inc', '[GOOGL US] Alphabet Inc.', '[MSFT US] Microsoft Corp.', '[NVDA US] NVIDIA Corp', '[Private] Anthropic', '[Private] MiniMax', '[Private] OpenAI', '[Private] 华为', '[Private] 字节跳动', '[ZI US] ZoomInfo Technologies Inc.'],
    '工业软件': ['[ADBE US] Adobe Inc'],
    '数据中心设备': ['[Private] UBS', '[000338 CH] 潍柴动力', '[002518 CH] 科士达', '[002837 CH] 英维克', '[300870 CH] 深圳市欧陆通电子股份有限公司', '[601126 CH] 北京四方继保自动化股份有限公司', '[9698 HK] 万国数据控股有限公司', '[BE US] BLOOM ENERGY CL A ORD', '[CBRE US] CBRE Group Inc', '[DBRG US] DigitalBridge Group Inc', '[ETN US] Eaton Corp PLC', '[LBRT US] Liberty Energy Inc', '[MARA US] Marathon Digital Holdings Inc', '[NVDA US] NVIDIA Corp', '[Private] Blue Owl Digital Infrastructure', '[Private] Sightline Research', '[SU FP] Schneider Electric SE', '[VRT US] Vertiv Holdings Co'],
    'LNG': ['[BKR US] Baker Hughes Company', '[EQT US] EQT Corporation'],
    '战略金属': ['[300856 CH] 赛恩斯', '[600549 CH] 厦门钨业股份有限公司'],
    '稀土': ['[0769 HK] 中国稀土控股', '[LYC AU] Lynas Rare Earths Ltd', '[MP US] MP MATERIALS CL A ORD', '[NEO CN] Neo Performance Materials Inc'],
    '铜金': ['[601899 CH] 紫金矿业集团股份有限公司', '[FM CN] First Quantum Minerals Ltd.'],
    '铝': ['[601600 SS] 中国铝业股份有限公司', '[Private] Qatar Aluminium'],
};

const SPECIAL_FOLDERS = ['行业研究', 'Expert', 'Sellside'];

function generateMigrateId() {
    return 'ws_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

app.post('/api/migrate/reorganize', async (req, res) => {
    try {
        const userId = req.userId;
        const log = [];

        // 1. Read all workspaces
        const allWorkspaces = await readIndex(userId, 'workspaces');
        const allCanvases = await readIndex(userId, 'canvases');
        log.push(`现有 ${allWorkspaces.length} 个 workspace, ${allCanvases.length} 个 canvas`);

        // Build lookup maps
        const wsByName = new Map(); // name.lower → workspace
        const wsById = new Map();
        for (const ws of allWorkspaces) {
            wsById.set(ws.id, ws);
            // For top-level, index by name
            if (!ws.parentId) {
                wsByName.set(ws.name.toLowerCase(), ws);
            }
        }

        // sub-folders grouped by parentId
        const subsByParent = new Map();
        for (const ws of allWorkspaces) {
            if (ws.parentId) {
                const list = subsByParent.get(ws.parentId) || [];
                list.push(ws);
                subsByParent.set(ws.parentId, list);
            }
        }

        const now = Date.now();
        const newWorkspaces = []; // workspaces to create
        const updatedWorkspaces = []; // workspaces to update
        const canvasUpdates = []; // {canvasId, newWorkspaceId}

        // Helper: find or create top-level industry workspace
        function getOrCreateIndustry(name) {
            let ws = wsByName.get(name.toLowerCase());
            if (ws) return ws;
            ws = {
                id: generateMigrateId(),
                name,
                icon: '📁',
                category: 'industry',
                canvasIds: [],
                tags: [],
                createdAt: now,
                updatedAt: now,
                order: allWorkspaces.length + newWorkspaces.length,
            };
            newWorkspaces.push(ws);
            wsByName.set(name.toLowerCase(), ws);
            wsById.set(ws.id, ws);
            log.push(`创建小分类: ${name}`);
            return ws;
        }

        // Helper: find sub-folder by name under a parent
        // Matches exact name, or by the company-name part (ignoring ticker prefix)
        function findSubFolder(parentId, name) {
            const subs = subsByParent.get(parentId) || [];
            const lower = name.toLowerCase();
            // Extract company name without ticker for fuzzy match (e.g. "[CAT US] Caterpillar Inc." → "caterpillar inc.")
            const nameWithoutTicker = lower.replace(/^\[.*?\]\s*/, '');
            return subs.find(s => {
                const sLower = s.name.toLowerCase();
                const sWithoutTicker = sLower.replace(/^\[.*?\]\s*/, '');
                return sLower === lower
                    || sWithoutTicker === nameWithoutTicker
                    || sWithoutTicker === lower
                    || sLower === nameWithoutTicker
                    || (nameWithoutTicker.length > 3 && (sWithoutTicker.includes(nameWithoutTicker) || nameWithoutTicker.includes(sWithoutTicker)));
            });
        }

        // Helper: create sub-folder
        function createSubFolder(parentId, name) {
            const ws = {
                id: generateMigrateId(),
                name,
                icon: '📁',
                category: 'industry',
                parentId,
                canvasIds: [],
                tags: [],
                createdAt: now,
                updatedAt: now,
                order: 0,
            };
            newWorkspaces.push(ws);
            wsById.set(ws.id, ws);
            const list = subsByParent.get(parentId) || [];
            list.push(ws);
            subsByParent.set(parentId, list);
            return ws;
        }

        // 2. Process each small category
        for (const [categoryName, companies] of Object.entries(INDUSTRY_COMPANIES)) {
            const industryWs = getOrCreateIndustry(categoryName);

            // 2a. Create special folders (行业研究, Expert, Sellside)
            for (const specialName of SPECIAL_FOLDERS) {
                const existing = findSubFolder(industryWs.id, specialName);
                if (!existing) {
                    createSubFolder(industryWs.id, specialName);
                    log.push(`创建特殊文件夹: ${categoryName}/${specialName}`);
                }
            }

            // 2b. Create company folders (and rename existing ones to add ticker)
            for (const companyName of companies) {
                const existing = findSubFolder(industryWs.id, companyName);
                if (existing) {
                    // Rename if the existing name doesn't match (e.g. missing ticker prefix)
                    if (existing.name !== companyName && !SPECIAL_FOLDERS.includes(existing.name)) {
                        const oldName = existing.name;
                        existing.name = companyName;
                        existing.updatedAt = now;
                        if (!updatedWorkspaces.includes(existing)) updatedWorkspaces.push(existing);
                        log.push(`重命名: ${oldName} → ${companyName}`);
                    }
                    continue;
                }

                // Check if company exists under a DIFFERENT industry
                let foundElsewhere = null;
                let foundParentName = '';
                for (const ws of allWorkspaces) {
                    if (ws.parentId && ws.name.toLowerCase() === companyName.toLowerCase()) {
                        const parent = wsById.get(ws.parentId);
                        if (parent && parent.name.toLowerCase() !== categoryName.toLowerCase()) {
                            foundElsewhere = ws;
                            foundParentName = parent.name;
                            break;
                        }
                    }
                }

                if (foundElsewhere) {
                    // Company exists elsewhere — check if it has canvases
                    const companyCanvases = allCanvases.filter(c => c.workspaceId === foundElsewhere.id);

                    if (companyCanvases.length > 0) {
                        // Create the company folder in new location, move canvases
                        const newFolder = createSubFolder(industryWs.id, companyName);
                        for (const canvas of companyCanvases) {
                            canvasUpdates.push({ canvasId: canvas.id, newWorkspaceId: newFolder.id, oldWorkspaceId: foundElsewhere.id });
                        }
                        log.push(`迁移公司: ${companyName} (${foundParentName} → ${categoryName}), ${companyCanvases.length} 个 canvas`);
                    } else {
                        // No canvases, just create in new location
                        createSubFolder(industryWs.id, companyName);
                        log.push(`创建公司文件夹: ${categoryName}/${companyName}`);
                    }
                } else {
                    // Company doesn't exist anywhere, create it
                    createSubFolder(industryWs.id, companyName);
                    log.push(`创建公司文件夹: ${categoryName}/${companyName}`);
                }
            }
        }

        // 3. Apply changes

        // 3a. Write new workspaces
        for (const ws of newWorkspaces) {
            await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
        }

        // 3b. Move canvases
        for (const { canvasId, newWorkspaceId, oldWorkspaceId } of canvasUpdates) {
            // Update canvas workspaceId
            const canvasPath = `${userId}/canvases/${canvasId}.json`;
            const canvasData = await readJSON(canvasPath);
            if (canvasData) {
                canvasData.workspaceId = newWorkspaceId;
                canvasData.updatedAt = now;
                await writeJSON(canvasPath, canvasData);
            }

            // Update old workspace canvasIds
            const oldWs = wsById.get(oldWorkspaceId);
            if (oldWs) {
                oldWs.canvasIds = (oldWs.canvasIds || []).filter(id => id !== canvasId);
                oldWs.updatedAt = now;
                if (!updatedWorkspaces.includes(oldWs)) updatedWorkspaces.push(oldWs);
            }

            // Update new workspace canvasIds
            const newWs = wsById.get(newWorkspaceId);
            if (newWs) {
                newWs.canvasIds = [...(newWs.canvasIds || []), canvasId];
                newWs.updatedAt = now;
                if (!updatedWorkspaces.includes(newWs)) updatedWorkspaces.push(newWs);
            }
        }

        // 3c. Write updated workspaces
        for (const ws of updatedWorkspaces) {
            await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
        }

        // 3d. Rebuild indices
        const finalWorkspaces = [...allWorkspaces, ...newWorkspaces];
        await writeIndex(userId, 'workspaces', finalWorkspaces);

        // Update canvas index for moved canvases
        if (canvasUpdates.length > 0) {
            const canvasIndex = await readIndex(userId, 'canvases');
            for (const { canvasId, newWorkspaceId } of canvasUpdates) {
                const ci = canvasIndex.find(c => c.id === canvasId);
                if (ci) {
                    ci.workspaceId = newWorkspaceId;
                    ci.updatedAt = now;
                }
            }
            await writeIndex(userId, 'canvases', canvasIndex);
        }

        invalidateUserCache(userId);

        log.push(`完成: 新建 ${newWorkspaces.length} 个 workspace, 移动 ${canvasUpdates.length} 个 canvas`);
        res.json({ success: true, log, created: newWorkspaces.length, moved: canvasUpdates.length });
    } catch (err) {
        console.error('Migration error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Patch: Add createdAt to existing synced notes ────────
app.post('/api/migrate/patch-dates', async (req, res) => {
    try {
        const userId = req.userId;
        const log = [];
        let patched = 0;

        const allCanvases = await readIndex(userId, 'canvases');
        log.push(`扫描 ${allCanvases.length} 个 canvas`);

        for (const canvasMeta of allCanvases) {
            try {
                // Read node data bundle
                const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                if (!bundle) continue;

                let changed = false;
                for (const [nodeId, nodeData] of Object.entries(bundle)) {
                    if (!nodeData || nodeData.type !== 'markdown' || !nodeData.content) continue;
                    const content = nodeData.content;

                    // Only patch notes that have metadata block but no 创建时间
                    if (!content.includes('**创建时间**') && (content.includes('**日期**') || content.includes('**发生日期**') || content.includes('**主题**'))) {
                        // Use canvas createdAt as the creation date
                        const createdAt = canvasMeta.createdAt
                            ? new Date(canvasMeta.createdAt).toLocaleDateString('zh-CN')
                            : null;

                        if (createdAt) {
                            // Rename **日期** to **发生日期** if needed
                            let newContent = content.replace(/\*\*日期\*\*/g, '**发生日期**');

                            // Insert **创建时间** after the last metadata item before ---
                            const metaSeparator = '\n\n---';
                            const sepIdx = newContent.indexOf(metaSeparator);
                            if (sepIdx >= 0) {
                                newContent = newContent.slice(0, sepIdx) + ` | **创建时间**: ${createdAt}` + newContent.slice(sepIdx);
                            }

                            nodeData.content = newContent;
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    await writeJSON(`${userId}/canvas-data/${canvasMeta.id}.json`, bundle);
                    patched++;
                    log.push(`已补充: ${canvasMeta.title}`);
                }
            } catch (err) {
                log.push(`跳过 ${canvasMeta.title}: ${err.message}`);
            }
        }

        invalidateUserCache(userId);
        log.push(`完成: 补充了 ${patched} 个 canvas 的创建时间`);
        res.json({ success: true, patched, log });
    } catch (err) {
        console.error('Patch dates error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Merge old industry folders into correct new ones ──────
// Maps old/misnamed folder names to the correct names from INDUSTRY_CATEGORY_MAP
const OLD_TO_NEW_FOLDER_MAP = {
    '矿': '工程机械/矿山机械',
    '报废车拍卖': '报废车',
    '自动化/机器人': '机器人/工业自动化',
    '煤': '能源',  // or wherever coal belongs
    'ai赋能': '互联网/大模型',
    '石油': 'LNG',
    '天然气管道': '天然气发电',
    '未分类笔记': '_unmatched',
};

// Get all valid industry folder names from INDUSTRY_COMPANIES
const VALID_INDUSTRY_NAMES = new Set(Object.keys(INDUSTRY_COMPANIES).map(n => n.toLowerCase()));

app.post('/api/migrate/merge-old-folders', async (req, res) => {
    try {
        const userId = req.userId;
        const dryRun = req.body?.dryRun !== false;
        const log = [];
        let merged = 0;
        let deleted = 0;

        const allWorkspaces = await readIndex(userId, 'workspaces');
        const allCanvases = await readIndex(userId, 'canvases');
        log.push(`扫描 ${allWorkspaces.length} 个 workspace (dryRun=${dryRun})`);

        const wsById = new Map(allWorkspaces.map(w => [w.id, w]));
        const topLevel = allWorkspaces.filter(w => !w.parentId && (!w.category || w.category === 'industry'));
        const topByName = new Map(topLevel.map(w => [w.name.toLowerCase(), w]));

        // Find old folders that need merging
        const toMerge = []; // {oldWs, newWs}
        const toDelete = []; // workspace ids to remove

        for (const ws of topLevel) {
            const lower = ws.name.toLowerCase();
            // Skip if it's a valid name
            if (VALID_INDUSTRY_NAMES.has(lower)) continue;
            // Skip special categories
            if (['整体研究', '个人', '日常'].includes(ws.name)) continue;

            // Check if there's a mapping
            const newName = OLD_TO_NEW_FOLDER_MAP[lower];
            if (newName && newName !== '_unmatched') {
                const targetWs = topByName.get(newName.toLowerCase());
                if (targetWs) {
                    toMerge.push({ oldWs: ws, newWs: targetWs });
                    log.push(`合并: ${ws.name} → ${targetWs.name}`);
                } else {
                    log.push(`跳过: ${ws.name} (目标 ${newName} 不存在)`);
                }
            } else if (!newName) {
                // Not in mapping and not valid — mark as orphan
                const subFolders = allWorkspaces.filter(w => w.parentId === ws.id);
                const canvases = allCanvases.filter(c => c.workspaceId === ws.id);
                const subCanvases = subFolders.flatMap(sub =>
                    allCanvases.filter(c => c.workspaceId === sub.id)
                );
                const totalContent = canvases.length + subCanvases.length;
                log.push(`孤立文件夹: ${ws.name} (${subFolders.length} 子文件夹, ${totalContent} 内容)`);
            }
        }

        if (!dryRun) {
            const deletedWsIds = new Set();
            const deletedCanvasIds = new Set();

            for (const { oldWs, newWs } of toMerge) {
                // Move all sub-folders from old to new
                const oldSubs = allWorkspaces.filter(w => w.parentId === oldWs.id);
                for (const sub of oldSubs) {
                    // Check if a similar sub-folder exists in newWs
                    const subLower = sub.name.toLowerCase().replace(/^\[.*?\]\s*/, '');
                    const existingInNew = allWorkspaces.find(w =>
                        w.parentId === newWs.id && w.name.toLowerCase().replace(/^\[.*?\]\s*/, '') === subLower
                    );

                    if (existingInNew) {
                        // Merge canvases from old sub into existing sub
                        const subCanvases = allCanvases.filter(c => c.workspaceId === sub.id);
                        for (const canvas of subCanvases) {
                            canvas.workspaceId = existingInNew.id;
                            await writeJSON(`${userId}/canvases/${canvas.id}.json`,
                                { ...(await readJSON(`${userId}/canvases/${canvas.id}.json`)), workspaceId: existingInNew.id }
                            );
                            if (!existingInNew.canvasIds) existingInNew.canvasIds = [];
                            existingInNew.canvasIds.push(canvas.id);
                        }
                        // Delete old sub-folder
                        deletedWsIds.add(sub.id);
                        await deleteFile(`${userId}/workspaces/${sub.id}.json`);
                        log.push(`  合并子文件夹: ${sub.name} → ${existingInNew.name} (${subCanvases.length} canvas)`);
                    } else {
                        // Move sub-folder to new parent
                        sub.parentId = newWs.id;
                        await writeJSON(`${userId}/workspaces/${sub.id}.json`, sub);
                        log.push(`  移动子文件夹: ${sub.name} → ${newWs.name}/`);
                    }
                }

                // Move direct canvases from old workspace to new
                const directCanvases = allCanvases.filter(c => c.workspaceId === oldWs.id);
                for (const canvas of directCanvases) {
                    canvas.workspaceId = newWs.id;
                    await writeJSON(`${userId}/canvases/${canvas.id}.json`,
                        { ...(await readJSON(`${userId}/canvases/${canvas.id}.json`)), workspaceId: newWs.id }
                    );
                    if (!newWs.canvasIds) newWs.canvasIds = [];
                    newWs.canvasIds.push(canvas.id);
                }

                // Delete old workspace
                deletedWsIds.add(oldWs.id);
                await deleteFile(`${userId}/workspaces/${oldWs.id}.json`);
                merged++;
            }

            // Update indices
            if (deletedWsIds.size > 0 || merged > 0) {
                const remainingWs = allWorkspaces.filter(w => !deletedWsIds.has(w.id));
                await writeIndex(userId, 'workspaces', remainingWs);
                await writeIndex(userId, 'canvases', allCanvases);
                invalidateUserCache(userId);
            }
        }

        log.push(`完成: ${dryRun ? '预计' : '已'}合并 ${toMerge.length} 个文件夹`);
        res.json({ success: true, dryRun, merged: toMerge.length, log });
    } catch (err) {
        console.error('Merge old folders error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Cleanup: Remove synced canvases (single-node markdown with metadata) ──
// Only deletes canvases that were created by the sync process:
// - Has exactly 1 node, type=markdown, isMain=true
// - Content contains sync metadata patterns (like **主题**, **公司**)
// Does NOT touch canvases with multiple nodes, non-markdown content, or user-created files
app.post('/api/migrate/cleanup-synced', async (req, res) => {
    try {
        const userId = req.userId;
        const log = [];
        let deleted = 0;
        const dryRun = req.body?.dryRun !== false; // default dry run for safety

        const allCanvases = await readIndex(userId, 'canvases');
        const allWorkspaces = await readIndex(userId, 'workspaces');
        log.push(`扫描 ${allCanvases.length} 个 canvas (dryRun=${dryRun})`);

        const toDelete = [];

        for (const canvasMeta of allCanvases) {
            try {
                // Read the canvas full data
                const canvasData = await readJSON(`${userId}/canvases/${canvasMeta.id}.json`);
                if (!canvasData || !canvasData.nodes) continue;

                const nodes = canvasData.nodes;
                // Target single-node canvases: old sync creates 1 main node per canvas
                // New sync creates canvases with multiple non-main nodes
                if (nodes.length !== 1) continue;

                const node = nodes[0];
                if (!node.isMain) continue;

                // Verify it's a markdown node (all synced notes are markdown)
                const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                if (bundle) {
                    const nodeData = bundle[node.id];
                    // Skip non-markdown nodes (user-created text/table/pdf etc.)
                    if (nodeData && nodeData.type && nodeData.type !== 'markdown') continue;
                }

                // This looks like a synced canvas
                const wsName = allWorkspaces.find(w => w.id === canvasMeta.workspaceId)?.name || '?';
                toDelete.push(canvasMeta);
                log.push(`${dryRun ? '[将删除]' : '[已删除]'} ${wsName}/${canvasMeta.title}`);
            } catch (err) {
                // skip errors on individual canvases
            }
        }

        if (!dryRun && toDelete.length > 0) {
            // Delete canvas files and node data
            for (const c of toDelete) {
                await deleteFile(`${userId}/canvases/${c.id}.json`);
                await deleteFile(`${userId}/canvas-data/${c.id}.json`);
                deleted++;
            }

            // Update canvases index: remove deleted
            const deletedIds = new Set(toDelete.map(c => c.id));
            const remainingCanvases = allCanvases.filter(c => !deletedIds.has(c.id));
            await writeIndex(userId, 'canvases', remainingCanvases);

            // Update workspace canvasIds
            for (const ws of allWorkspaces) {
                const before = (ws.canvasIds || []).length;
                ws.canvasIds = (ws.canvasIds || []).filter(id => !deletedIds.has(id));
                if (ws.canvasIds.length !== before) {
                    await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
                }
            }
            await writeIndex(userId, 'workspaces', allWorkspaces);

            invalidateUserCache(userId);
        }

        log.push(`完成: ${dryRun ? '预计删除' : '已删除'} ${toDelete.length} 个同步 canvas`);
        res.json({ success: true, dryRun, count: toDelete.length, deleted, log });
    } catch (err) {
        console.error('Cleanup error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Merge multiple canvases per workspace into one ────────
app.post('/api/migrate/merge-canvases', async (req, res) => {
    try {
        const userId = req.userId;
        const dryRun = req.body?.dryRun !== false;
        const log = [];
        let mergedCount = 0;

        const allCanvases = await readIndex(userId, 'canvases');
        const allWorkspaces = await readIndex(userId, 'workspaces');
        log.push(`扫描 ${allCanvases.length} 个 canvas (dryRun=${dryRun})`);

        // Group canvases by workspaceId
        const canvasesByWs = new Map();
        for (const c of allCanvases) {
            const list = canvasesByWs.get(c.workspaceId) || [];
            list.push(c);
            canvasesByWs.set(c.workspaceId, list);
        }

        const deletedIds = new Set();

        for (const [wsId, wsCanvases] of canvasesByWs) {
            if (wsCanvases.length <= 1) continue;

            const wsName = allWorkspaces.find(w => w.id === wsId)?.name || '?';
            log.push(`合并: ${wsName} (${wsCanvases.length} 个 canvas)`);

            if (!dryRun) {
                // Pick first canvas as target, merge all others into it
                const target = wsCanvases[0];
                const targetBundle = await readJSON(`${userId}/canvas-data/${target.id}.json`) || {};
                const targetCanvas = await readJSON(`${userId}/canvases/${target.id}.json`) || { nodes: [] };

                for (let i = 1; i < wsCanvases.length; i++) {
                    const source = wsCanvases[i];
                    const sourceBundle = await readJSON(`${userId}/canvas-data/${source.id}.json`) || {};
                    const sourceCanvas = await readJSON(`${userId}/canvases/${source.id}.json`) || { nodes: [] };

                    // Move non-main nodes from source to target
                    for (const node of (sourceCanvas.nodes || [])) {
                        if (!node.isMain) {
                            targetCanvas.nodes.push(node);
                            if (sourceBundle[node.id]) {
                                targetBundle[node.id] = sourceBundle[node.id];
                            }
                        } else {
                            // Convert main node to non-main and include it too
                            node.isMain = false;
                            targetCanvas.nodes.push(node);
                            if (sourceBundle[node.id]) {
                                targetBundle[node.id] = sourceBundle[node.id];
                            }
                        }
                    }

                    // Delete source canvas
                    await deleteFile(`${userId}/canvases/${source.id}.json`);
                    await deleteFile(`${userId}/canvas-data/${source.id}.json`);
                    deletedIds.add(source.id);
                    log.push(`  ← ${source.title} (${(sourceCanvas.nodes || []).length} nodes)`);
                }

                // Ensure target has a main node
                if (targetCanvas.nodes.length > 0 && !targetCanvas.nodes.some(n => n.isMain)) {
                    targetCanvas.nodes[0].isMain = true;
                }

                // Write merged data
                await writeJSON(`${userId}/canvases/${target.id}.json`, targetCanvas);
                await writeJSON(`${userId}/canvas-data/${target.id}.json`, targetBundle);
            }

            mergedCount++;
        }

        if (!dryRun && deletedIds.size > 0) {
            // Update canvases index
            const remaining = allCanvases.filter(c => !deletedIds.has(c.id));
            await writeIndex(userId, 'canvases', remaining);

            // Update workspace canvasIds
            for (const ws of allWorkspaces) {
                const before = (ws.canvasIds || []).length;
                ws.canvasIds = (ws.canvasIds || []).filter(id => !deletedIds.has(id));
                if (ws.canvasIds.length !== before) {
                    await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
                }
            }
            await writeIndex(userId, 'workspaces', allWorkspaces);
            invalidateUserCache(userId);
        }

        log.push(`完成: ${dryRun ? '预计' : '已'}合并 ${mergedCount} 个文件夹的 canvas`);
        res.json({ success: true, dryRun, merged: mergedCount, deletedCanvases: deletedIds.size, log });
    } catch (err) {
        console.error('Merge canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Reclassify Expert/Sellside notes with company into company canvases ───
app.post('/api/migrate/reclassify-notes', async (req, res) => {
    try {
        const userId = req.userId;
        const dryRun = req.body?.dryRun !== false;
        const log = [];
        let movedCount = 0;

        const allWorkspaces = await readIndex(userId, 'workspaces');
        const allCanvases = await readIndex(userId, 'canvases');
        const wsById = new Map(allWorkspaces.map(w => [w.id, w]));
        const now = Date.now();

        log.push(`总共 ${allWorkspaces.length} 个工作区, ${allCanvases.length} 个画布`);

        // Data model: flat workspaces (industry folders), each containing canvases.
        // "Expert"/"Sellside" are CANVAS titles within a workspace, NOT sub-workspaces.
        // We need to find canvases titled "Expert"/"Sellside" and move nodes with company metadata
        // to company canvases in the SAME workspace.

        // Find Expert/Sellside canvases across all workspaces
        const expertSellsideCanvases = []; // {canvasMeta, workspace, sourceType}
        for (const canvas of allCanvases) {
            const titleLower = (canvas.title || '').toLowerCase().trim();
            if (titleLower === 'expert' || titleLower === 'sellside') {
                const ws = wsById.get(canvas.workspaceId);
                if (ws) {
                    expertSellsideCanvases.push({
                        canvasMeta: canvas,
                        workspace: ws,
                        sourceType: titleLower,
                    });
                }
            }
        }

        log.push(`找到 ${expertSellsideCanvases.length} 个 Expert/Sellside 画布需要检查`);
        for (const esc of expertSellsideCanvases) {
            log.push(`  → 工作区 "${esc.workspace.name}" / 画布 "${esc.canvasMeta.title}" (${esc.canvasMeta.id})`);
        }

        // Helper: fuzzy find existing company canvas in the same workspace
        function findCompanyCanvas(workspaceId, companyName) {
            const lower = companyName.toLowerCase();
            return allCanvases.find(c => {
                if (c.workspaceId !== workspaceId) return false;
                const cLower = (c.title || '').toLowerCase();
                const cWithoutTicker = cLower.replace(/^\[.*?\]\s*/, '');
                if (cLower === lower || cWithoutTicker === lower) return true;
                if (lower.length > 2 && (cWithoutTicker.includes(lower) || lower.includes(cWithoutTicker))) return true;
                return false;
            });
        }

        // Track which canvases/bundles need updating
        const canvasUpdates = new Map(); // canvasId → { canvasDoc, bundle, changed }
        const newCanvasCreates = []; // [{canvasDoc, bundle, workspaceId}]

        async function getOrLoadCanvas(canvasId) {
            if (canvasUpdates.has(canvasId)) return canvasUpdates.get(canvasId);
            const doc = await readJSON(`${userId}/canvases/${canvasId}.json`);
            const bundle = await readJSON(`${userId}/canvas-data/${canvasId}.json`) || {};
            const entry = { canvasDoc: doc, bundle, changed: false };
            canvasUpdates.set(canvasId, entry);
            return entry;
        }

        for (const { canvasMeta, workspace, sourceType } of expertSellsideCanvases) {
            const source = await getOrLoadCanvas(canvasMeta.id);
            if (!source.canvasDoc || !source.canvasDoc.nodes) {
                log.push(`  ⚠ 画布 ${canvasMeta.id} 无节点数据`);
                continue;
            }

            log.push(`  画布 "${canvasMeta.title}" 包含 ${source.canvasDoc.nodes.length} 个节点`);

            const nodesToRemove = []; // indices to remove

            for (let i = 0; i < source.canvasDoc.nodes.length; i++) {
                const node = source.canvasDoc.nodes[i];
                const nodeData = source.bundle[node.id];
                if (!nodeData) {
                    log.push(`    跳过: node ${node.id} 无 bundle 数据`);
                    continue;
                }

                // Extract company from metadata
                const company = nodeData.metadata?.['公司'] || nodeData.metadata?.['company'] || null;
                const metaKeys = nodeData.metadata ? Object.keys(nodeData.metadata) : [];
                log.push(`    检查: "${nodeData.title || node.id}" | metadata keys: [${metaKeys.join(', ')}] | 公司: ${company || '无'}`);
                if (!company) continue; // No company → stays in Expert/Sellside

                // Find or create company canvas in the SAME workspace
                let targetCanvasId = null;

                // Check existing canvases in same workspace
                const existingCompanyCanvas = findCompanyCanvas(workspace.id, company);
                if (existingCompanyCanvas) {
                    targetCanvasId = existingCompanyCanvas.id;
                } else {
                    // Check newCanvasCreates
                    const existing = newCanvasCreates.find(c =>
                        c.workspaceId === workspace.id &&
                        c.canvasDoc.title.toLowerCase() === company.toLowerCase()
                    );
                    if (existing) {
                        targetCanvasId = existing.canvasDoc.id;
                    }
                }

                if (!targetCanvasId) {
                    // Create new canvas in the same workspace
                    const newId = 'canvas_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
                    const newCanvas = {
                        id: newId,
                        workspaceId: workspace.id,
                        title: company,
                        template: 'custom',
                        modules: [],
                        nodes: [],
                        edges: [],
                        viewport: { x: 0, y: 0, zoom: 1 },
                        createdAt: now,
                        updatedAt: now,
                    };
                    newCanvasCreates.push({ canvasDoc: newCanvas, bundle: {}, workspaceId: workspace.id });
                    canvasUpdates.set(newId, { canvasDoc: newCanvas, bundle: {}, changed: true });
                    targetCanvasId = newId;
                    log.push(`    创建新画布: "${company}" (在工作区 "${workspace.name}")`);
                }

                // Move node: add to target, mark for removal from source
                const target = await getOrLoadCanvas(targetCanvasId);
                target.canvasDoc.nodes.push({ ...node, position: { x: 0, y: (target.canvasDoc.nodes.length) * 120 } });
                target.bundle[node.id] = nodeData;
                target.changed = true;
                nodesToRemove.push(i);
                movedCount++;

                log.push(`    移动: "${nodeData.title}" → 画布 "${company}" (${sourceType}→公司)`);
            }

            // Remove moved nodes from source (by index)
            if (nodesToRemove.length > 0) {
                const removeSet = new Set(nodesToRemove);
                source.canvasDoc.nodes = source.canvasDoc.nodes.filter((_, i) => !removeSet.has(i));
                source.changed = true;
            }
        }

        // Rebuild source bundles by removing moved node data
        for (const { canvasMeta } of expertSellsideCanvases) {
            const entry = canvasUpdates.get(canvasMeta.id);
            if (!entry || !entry.changed) continue;
            const remainingIds = new Set(entry.canvasDoc.nodes.map(n => n.id));
            const newBundle = {};
            for (const [id, data] of Object.entries(entry.bundle)) {
                if (remainingIds.has(id)) {
                    newBundle[id] = data;
                }
            }
            entry.bundle = newBundle;
        }

        log.push(`共需移动 ${movedCount} 个笔记`);

        if (!dryRun && movedCount > 0) {
            // Write all changed canvases
            const canvasIndex = await readIndex(userId, 'canvases');
            const wsIndex = await readIndex(userId, 'workspaces');

            for (const [canvasId, entry] of canvasUpdates.entries()) {
                if (!entry.changed) continue;
                entry.canvasDoc.updatedAt = now;
                await writeJSON(`${userId}/canvases/${canvasId}.json`, entry.canvasDoc);
                await writeJSON(`${userId}/canvas-data/${canvasId}.json`, entry.bundle);

                // Update canvas index
                const idx = canvasIndex.findIndex(c => c.id === canvasId);
                const meta = canvasMetaForIndex(entry.canvasDoc);
                if (idx >= 0) canvasIndex[idx] = meta;
                else canvasIndex.push(meta);
            }

            // Update workspace canvasIds for new canvases
            for (const nc of newCanvasCreates) {
                const ws = wsById.get(nc.workspaceId);
                if (ws) {
                    if (!ws.canvasIds) ws.canvasIds = [];
                    if (!ws.canvasIds.includes(nc.canvasDoc.id)) {
                        ws.canvasIds.push(nc.canvasDoc.id);
                        ws.updatedAt = now;
                        await writeJSON(`${userId}/workspaces/${ws.id}.json`, ws);
                        const wsIdx = wsIndex.findIndex(w => w.id === ws.id);
                        if (wsIdx >= 0) wsIndex[wsIdx] = ws;
                    }
                }
            }

            await writeIndex(userId, 'canvases', canvasIndex);
            await writeIndex(userId, 'workspaces', wsIndex);
            invalidateUserCache(userId);
        }

        res.json({ success: true, dryRun, moved: movedCount, log });
    } catch (err) {
        console.error('Reclassify notes error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Reformat metadata in existing notes ──────────────────
app.post('/api/migrate/reformat-metadata', async (req, res) => {
    try {
        const userId = req.userId;
        const log = [];
        let patched = 0;

        const allCanvases = await readIndex(userId, 'canvases');
        log.push(`扫描 ${allCanvases.length} 个 canvas`);

        for (const canvasMeta of allCanvases) {
            try {
                const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                if (!bundle) continue;

                let changed = false;
                for (const [, nodeData] of Object.entries(bundle)) {
                    if (!nodeData || nodeData.type !== 'markdown' || !nodeData.content) continue;
                    const content = nodeData.content;

                    // Detect old pipe-separated metadata format
                    if (!content.includes('| 字段 | 内容 |') && content.match(/\*\*[^*]+\*\*:\s*[^|]+\|/)) {
                        // Extract metadata line (first line before ---)
                        const sepIdx = content.indexOf('\n\n---');
                        if (sepIdx < 0) continue;

                        const metaLine = content.slice(0, sepIdx).trim();
                        const rest = content.slice(sepIdx + 4).trim(); // skip \n\n---

                        // Parse "**key**: value | **key**: value | ..."
                        const pairs = metaLine.split(/\s*\|\s*/).filter(Boolean);
                        const rows = [];
                        for (const pair of pairs) {
                            const m = pair.match(/\*\*([^*]+)\*\*:\s*(.*)/);
                            if (m) rows.push([m[1].trim(), m[2].trim()]);
                        }

                        if (rows.length > 0) {
                            const table = [
                                '| 字段 | 内容 |',
                                '|------|------|',
                                ...rows.map(([k, v]) => `| ${k} | ${v} |`),
                            ].join('\n');

                            nodeData.content = table + '\n\n' + rest;
                            changed = true;
                        }
                    }
                }

                if (changed) {
                    await writeJSON(`${userId}/canvas-data/${canvasMeta.id}.json`, bundle);
                    patched++;
                }
            } catch { /* skip */ }
        }

        invalidateUserCache(userId);
        log.push(`完成: 重新格式化了 ${patched} 个 canvas 的元数据`);
        res.json({ success: true, patched, log });
    } catch (err) {
        console.error('Reformat metadata error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Fix duplicate date tags in existing notes ──────────────
app.post('/api/migrate/fix-date-tags', async (req, res) => {
    try {
        const userId = req.userId;
        const log = [];
        let patched = 0;

        const allCanvases = await readIndex(userId, 'canvases');
        for (const canvasMeta of allCanvases) {
            try {
                const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                if (!bundle) continue;
                let changed = false;

                for (const [nodeId, nodeData] of Object.entries(bundle)) {
                    if (!nodeData || !Array.isArray(nodeData.tags) || nodeData.tags.length === 0) continue;

                    // Deduplicate date-like tags
                    const seen = new Set();
                    const deduped = [];
                    for (const tag of nodeData.tags) {
                        const dateMatch = tag.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
                        const key = dateMatch
                            ? `${parseInt(dateMatch[1])}/${parseInt(dateMatch[2])}/${parseInt(dateMatch[3])}`
                            : tag.trim().toLowerCase();
                        if (!seen.has(key)) {
                            seen.add(key);
                            deduped.push(tag);
                        }
                    }

                    if (deduped.length < nodeData.tags.length) {
                        log.push(`${canvasMeta.title}/${nodeData.title}: tags ${nodeData.tags.length} → ${deduped.length}`);
                        nodeData.tags = deduped;
                        changed = true;
                    }

                    // Ensure metadata has both 发生日期 and 创建时间 if available
                    if (nodeData.metadata) {
                        const eventDate = nodeData.metadata['发生日期'];
                        const createTime = nodeData.metadata['创建时间'];
                        // If we have eventDate but no createTime, try to extract from tags or title
                        if (eventDate && !createTime) {
                            // Try parsing date from title (format: ...topic--type-country-YYYY/MM/DD)
                            const titleDateMatch = (nodeData.title || '').match(/(\d{4}\/\d{1,2}\/\d{1,2})$/);
                            if (titleDateMatch && titleDateMatch[1] !== eventDate) {
                                nodeData.metadata['创建时间'] = titleDateMatch[1];
                                changed = true;
                            }
                        }
                    }
                }

                if (changed) {
                    await writeJSON(`${userId}/canvas-data/${canvasMeta.id}.json`, bundle);
                    patched++;
                }
            } catch { /* skip */ }
        }

        invalidateUserCache(userId);
        log.push(`完成: 修复了 ${patched} 个 canvas 的标签`);
        res.json({ success: true, patched, log });
    } catch (err) {
        console.error('Fix date tags error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── TRACKER & DASHBOARD SYSTEM ───────────────────────────

// Read all trackers for a user
app.get('/api/trackers', async (req, res) => {
    try {
        const userId = req.userId;
        const trackers = await readIndex(userId, 'trackers');
        res.json(trackers);
    } catch (err) {
        if (err.code === 'ENOENT') return res.json([]);
        console.error('Tracker get err:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update or create trackers
app.post('/api/trackers', async (req, res) => {
    try {
        const userId = req.userId;
        const { trackers } = req.body;
        
        const existing = await readIndex(userId, 'trackers').catch(() => []);
        const existingMap = new Map(existing.map(t => [t.id, t]));
        
        for (const t of trackers) {
            existingMap.set(t.id, {
                ...existingMap.get(t.id),
                ...t,
                updatedAt: Date.now()
            });
        }
        
        const finalTrackers = Array.from(existingMap.values());
        await writeIndex(userId, 'trackers', finalTrackers);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Tracker save err:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a tracker
app.delete('/api/trackers/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const trackers = await readIndex(userId, 'trackers').catch(() => []);
        const filtered = trackers.filter(t => t.id !== id);
        
        await writeIndex(userId, 'trackers', filtered);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Read tracker inbox items
app.get('/api/trackers/inbox', async (req, res) => {
    try {
        const userId = req.userId;
        const items = await readIndex(userId, 'tracker_inbox').catch(() => []);
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add to tracker inbox
app.post('/api/trackers/inbox', async (req, res) => {
    try {
        const userId = req.userId;
        const item = req.body;
        const items = await readIndex(userId, 'tracker_inbox').catch(() => []);
        items.unshift(item); // prepend new items
        await writeIndex(userId, 'tracker_inbox', items);
        res.json({ success: true, item });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove from tracker inbox
app.delete('/api/trackers/inbox/:id', async (req, res) => {
    try {
        const userId = req.userId;
        const { id } = req.params;
        const items = await readIndex(userId, 'tracker_inbox').catch(() => []);
        await writeIndex(userId, 'tracker_inbox', items.filter(i => i.id !== id));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
    console.log(`Research Canvas API listening on port ${PORT}`);
});

// ─── WebSocket Proxy for Realtime Transcription ──────────────
// Proxy WebSocket upgrade requests at /ws/realtime-transcription to aiprocess-api
// aiprocess-api (port 8081) starts slower than server.js — wait for it before proxying.
let aiprocessReady = false;
const AIPROCESS_PORT = process.env.AIPROCESS_PORT || 8081;

function checkAiprocess() {
    const req = http.get(`http://localhost:${AIPROCESS_PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
            if (!aiprocessReady) {
                console.log(`[WS Proxy] aiprocess-api on port ${AIPROCESS_PORT} is ready`);
            }
            aiprocessReady = true;
        }
        res.resume();
    });
    req.on('error', () => { aiprocessReady = false; });
    req.setTimeout(1000, () => { req.destroy(); });
}

// Poll every 2s until ready, then every 30s to detect restarts
setInterval(checkAiprocess, aiprocessReady ? 30000 : 2000);
checkAiprocess();

const wsProxy = createProxyMiddleware({
    target: `http://localhost:${AIPROCESS_PORT}`,
    changeOrigin: true,
    ws: true,
    on: {
        proxyReqWs: (proxyReq, req) => {
            console.log(`[WS Proxy] Forwarding: ${req.url?.substring(0, 80)}...`);
        },
        error: (err, req) => {
            console.error(`[WS Proxy] Error: ${err.message} | url: ${req.url?.substring(0, 80)}`);
        },
    },
});

server.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/ws/realtime-transcription')) {
        if (!aiprocessReady) {
            console.warn('[WS Proxy] aiprocess-api not ready yet, waiting...');
            // Wait up to 30s for aiprocess-api to start
            let waited = 0;
            const waitInterval = setInterval(() => {
                waited += 500;
                checkAiprocess();
                if (aiprocessReady) {
                    clearInterval(waitInterval);
                    console.log(`[WS Proxy] aiprocess-api ready after ${waited}ms, forwarding`);
                    wsProxy.upgrade(req, socket, head);
                } else if (waited >= 30000) {
                    clearInterval(waitInterval);
                    console.error('[WS Proxy] aiprocess-api failed to start within 30s');
                    socket.destroy();
                }
            }, 500);
            return;
        }
        wsProxy.upgrade(req, socket, head);
    }
});
