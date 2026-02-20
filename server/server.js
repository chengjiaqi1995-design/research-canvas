import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { OAuth2Client } from 'google-auth-library';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const GOOGLE_CLIENT_ID = '208594497704-4urmpvbdca13v2ae3a0hbkj6odnhu8t1.apps.googleusercontent.com';
const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ─── Auth Middleware ───────────────────────────────────────
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization token' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const ticket = await oauthClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        req.userId = payload.sub;
        req.userEmail = payload.email;
        next();
    } catch (err) {
        console.error('Token verification failed:', err.message);
        return res.status(401).json({ error: 'Invalid token' });
    }
}

app.use('/api', authenticate);

// ─── GCS Storage Layer ─────────────────────────────────────
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const VERTEX_LOCATION = 'us-central1';
const GEMINI_MODEL = 'gemini-2.0-flash-001';
const UPLOAD_BUCKET = `${PROJECT_ID}-uploads`;

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
            await bucket.create({ location: VERTEX_LOCATION });
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
        nodeCount: canvas.nodes?.length || 0,
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

        res.setHeader('Content-Type', 'application/pdf');
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
    { id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'google' },
    { id: 'gemini-3-flash', name: 'Gemini 3 Flash', provider: 'google' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
    { id: 'qwen3-max-thinking', name: 'Qwen3 Max Thinking', provider: 'dashscope' },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'dashscope' },
    { id: 'deepseek-v4', name: 'DeepSeek V4', provider: 'deepseek' },
    { id: 'deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' },
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
    const { model, messages, systemPrompt } = req.body;
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
                body: JSON.stringify({ contents: apiMessages }),
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

        } else {
            sendSSE({ type: 'error', content: `Unsupported provider: ${provider}` });
        }
    } catch (err) {
        console.error('AI chat error:', err);
        sendSSE({ type: 'error', content: err.message || 'AI request failed' });
    }

    res.end();
});

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Research Canvas API listening on port ${PORT}`);
});
