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
    '/api/user'
];
app.use(createProxyMiddleware({
    target: 'http://localhost:8081',
    changeOrigin: true,
    pathFilter: (path) => aiPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')),
}));

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const GOOGLE_CLIENT_ID = '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Session JWT secret — generated once per server start (or use env var for persistence across restarts)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SESSION_EXPIRY = '7d'; // 7 days

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
        const sessionToken = jwt.sign(
            { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture },
            JWT_SECRET,
            { expiresIn: SESSION_EXPIRY }
        );
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
    // Skip auth for login and rebuild-industries
    if (req.path === '/auth/login' || req.path === '/rebuild-industries') return next();
    // Local dev: skip auth when token is 'dev-token'
    const authHeader = req.headers.authorization;
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
const GEMINI_MODEL = 'gemini-2.0-flash-001';
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

// ─── GCS Helper Functions ──────────────────────────────────

async function readJSON(path) {
    const bucket = await getBucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return JSON.parse(content.toString());
}

async function writeJSON(path, data) {
    const bucket = await getBucket();
    const file = bucket.file(path);
    await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        resumable: false,
    });
}

async function deleteFile(path) {
    const bucket = await getBucket();
    await bucket.file(path).delete({ ignoreNotFound: true });
}

async function deleteByPrefix(prefix) {
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
    const bundle = {};
    for (const node of nodes) {
        if (node.data) {
            bundle[node.id] = node.data;
            delete node.data;
        }
    }
    if (Object.keys(bundle).length > 0) {
        await writeJSON(`${userId}/canvas-data/${canvasId}.json`, bundle);
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
        const { workspaceId } = req.query;
        let canvases = await readIndex(req.userId, 'canvases');
        if (workspaceId) {
            canvases = canvases.filter(c => c.workspaceId === workspaceId);
        }
        
        // Enrich lightweight list payloads with actual nested node counts for UI sorting
        for (const c of canvases) {
            try {
                const fullCanvas = await readJSON(`${req.userId}/canvases/${c.id}.json`);
                c.nodeCount = fullCanvas?.nodes?.filter(n => !n.isMain)?.length || 0;
            } catch (err) {
                c.nodeCount = 0;
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
        const filename = decodeURIComponent(req.params[0]);
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

const AI_MODELS = [
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'anthropic' },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
    { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai' },
    { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', provider: 'openai' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
    { id: 'qwen3-max-thinking', name: 'Qwen3 Max Thinking', provider: 'dashscope' },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'dashscope' },
    { id: 'deepseek-v4', name: 'DeepSeek V4', provider: 'deepseek' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' },
    { id: 'abab6.5s-chat', name: 'MiniMax abab6.5s', provider: 'minimax' },
    { id: 'abab6.5-chat', name: 'MiniMax abab6.5', provider: 'minimax' },
    { id: 'milm', name: 'Xiaomi MiLM', provider: 'xiaomi' },
];

app.get('/api/ai/models', (req, res) => {
    res.json(AI_MODELS);
});

// AI Settings — now stored in GCS
app.get('/api/ai/settings', async (req, res) => {
    try {
        const data = await readJSON(`${req.userId}/settings/ai.json`);
        if (!data) {
            return res.json({ keys: {}, defaultModel: 'gemini-2.5-flash' });
        }
        const maskedKeys = {};
        for (const [provider, key] of Object.entries(data.keys || {})) {
            if (key && typeof key === 'string' && key.length > 8) {
                maskedKeys[provider] = key.slice(0, 4) + '****' + key.slice(-4);
            } else {
                maskedKeys[provider] = key ? '****' : '';
            }
        }
        res.json({ keys: maskedKeys, defaultModel: data.defaultModel || 'gemini-2.5-flash' });
    } catch (err) {
        console.error('GET /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/ai/settings', async (req, res) => {
    try {
        const { keys, defaultModel } = req.body;
        const existing = await readJSON(`${req.userId}/settings/ai.json`) || { keys: {}, defaultModel: 'gemini-2.5-flash' };
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
            updatedAt: Date.now(),
        };
        await writeJSON(`${req.userId}/settings/ai.json`, settings);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper: get API key for a provider
async function getUserApiKey(userId, provider) {
    const data = await readJSON(`${userId}/settings/ai.json`);
    if (!data) return null;
    return data.keys?.[provider] || null;
}

function getProviderForModel(modelId) {
    const model = AI_MODELS.find(m => m.id === modelId);
    return model?.provider || 'anthropic';
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

    const sendSSE = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

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
                if (content) sendSSE({ type: 'text', content });
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
                            if (text) sendSSE({ type: 'text', content: text });
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
                if (content) sendSSE({ type: 'text', content });
            }
            sendSSE({ type: 'done', usage: {} });

        } else if (provider === 'minimax') {
            const OpenAI = (await import('openai')).default;
            const client = new OpenAI({ apiKey, baseURL: 'https://api.minimax.chat/v1' });
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
                if (content) sendSSE({ type: 'text', content });
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
                if (content) sendSSE({ type: 'text', content });
            }
            sendSSE({ type: 'done', usage: {} });

        } else {
            sendSSE({ type: 'error', content: `Unsupported provider: ${provider}` });
        }
    } catch (err) {
        console.error('AI chat error:', err);
        sendSSE({ type: 'error', content: err.message || 'AI request failed' });
    }

    res.end();
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
        const serviceAdapter = new GoogleGenerativeAIAdapter({
            model: 'gemini-2.5-flash',
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
        const { notes, industryFolders } = req.body;
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

            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=${apiKey}`;
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

        for (const canvasMeta of targetCanvases) {
            try {
                const bundle = await readJSON(`${userId}/canvas-data/${canvasMeta.id}.json`);
                if (!bundle) continue;

                for (const [nodeId, nodeData] of Object.entries(bundle)) {
                    if (!nodeData || nodeData.type !== 'markdown' || !nodeData.content) continue;

                    // Extract dates from content based on dateField preference
                    const content = nodeData.content;
                    let noteDate = null;
                    const useCreated = dateField === 'created';

                    if (useCreated) {
                        // 创建时间 mode: try 创建时间 first
                        const createMatch = content.match(/\*\*创建时间\*\*:\s*([^\s|*]+)/);
                        if (createMatch) noteDate = createMatch[1];
                        // Fall back to canvas createdAt
                        if (!noteDate && canvasMeta.createdAt) {
                            noteDate = new Date(canvasMeta.createdAt).toISOString().slice(0, 10);
                        }
                    } else {
                        // 发生日期 mode (default): try 发生日期 first
                        const dateMatch = content.match(/\*\*发生日期\*\*:\s*([^\s|*]+)/);
                        if (dateMatch) {
                            noteDate = dateMatch[1];
                        }
                        // Fall back to 创建时间
                        if (!noteDate) {
                            const createMatch = content.match(/\*\*创建时间\*\*:\s*([^\s|*]+)/);
                            if (createMatch) noteDate = createMatch[1];
                        }
                        // Fall back to canvas createdAt
                        if (!noteDate && canvasMeta.createdAt) {
                            noteDate = new Date(canvasMeta.createdAt).toISOString().slice(0, 10);
                        }
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
                    });
                }
            } catch {
                // skip errors on individual canvases
            }
        }

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
        const { transcriptionIds } = req.body;
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
        const industryWorkspaces = allWorkspaces.filter(w => w.category === 'industry' && !w.parentId);
        const industryFolders = industryWorkspaces.map(w => w.name);

        // 3. Build notes array for classification
        const notes = transcriptions.map(t => ({
            id: t.id,
            company: t.organization || '',
            industries: t.industry ? [t.industry] : [],
            topic: t.topic || '',
            fileName: t.fileName || '',
        }));

        // 4. Classify using existing logic (Portfolio + AI)
        const apiKey = await getUserApiKey(userId, 'google') || process.env.GOOGLE_API_KEY;

        const portfolioMap = await getPortfolioMapping();
        const portfolioKeys = Object.keys(portfolioMap);

        function fuzzyMatchPortfolio(name) {
            if (!name) return null;
            const lower = name.toLowerCase();
            if (portfolioMap[lower]) return portfolioMap[lower];
            for (const key of portfolioKeys) {
                if (key.includes(lower) || lower.includes(key)) return portfolioMap[key];
            }
            return null;
        }

        const preClassified = [];
        const needsAI = [];

        for (const n of notes) {
            const company = (n.company || '').trim();

            // 1. Try portfolio mapping first
            const match = fuzzyMatchPortfolio(company);
            if (match && match.sector && industryFolders.some(f => f === match.sector)) {
                preClassified.push({ id: n.id, folder: match.sector, ticker: match.ticker || '' });
                continue;
            }

            // 2. Try direct industry match from transcription metadata
            if (n.industries && n.industries.length > 0) {
                const directMatch = n.industries.find(ind =>
                    industryFolders.some(f => f.toLowerCase() === ind.toLowerCase())
                );
                if (directMatch) {
                    const exactFolder = industryFolders.find(f => f.toLowerCase() === directMatch.toLowerCase());
                    preClassified.push({ id: n.id, folder: exactFolder, ticker: match?.ticker || '' });
                    continue;
                }
            }

            // 3. Fall through to AI classification
            needsAI.push(n);
        }

        let aiClassifications = [];
        if (needsAI.length > 0 && apiKey) {
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
${JSON.stringify(needsAI.map(n => ({ id: n.id, company: n.company, industries: n.industries, topic: n.topic, fileName: n.fileName })), null, 2)}

规则：
1. 必须匹配已有的行业文件夹名称，不允许创建新文件夹
2. 参考上面的公司→行业映射，如果笔记中的公司在映射中出现，直接使用对应行业
3. 如果笔记是宏观/策略/ETF/指数/市场总体研究/行业总体研究相关，使用"_overall"
4. 如果笔记是个人相关，使用"_personal"
5. 如果实在无法匹配任何已有行业文件夹，使用"_unmatched"
6. 公司名称匹配时要注意简称和全称的对应
7. 如果公司是上市公司，请提供其Bloomberg Ticker（不含Equity后缀），不确定则留空

严格按以下JSON格式返回，不要包含其他文字：
[{"id":"笔记id","folder":"匹配的文件夹名称或_overall或_personal或_unmatched","ticker":"BBG Ticker或空字符串"}]`;

            try {
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=${apiKey}`;
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
            if (participants.includes('expert')) {
                canvasName = 'Expert';
            } else if (participants.includes('sellside')) {
                canvasName = 'Sellside';
            } else if (!organization) {
                canvasName = '行业研究';
            } else {
                canvasName = ticker ? `[${ticker}] ${organization}` : organization;
            }

            // Check if workspace and canvas already exist
            const targetWs = allWorkspaces.find(w => w.name === folder && w.category === 'industry' && !w.parentId);
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
            let ws = allWorkspaces.find(w => w.name === group.folder && w.category === 'industry' && !w.parentId);
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
