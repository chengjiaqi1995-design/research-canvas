import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const firestore = new Firestore();
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

// ─── Helper ────────────────────────────────────────────────
function userRef(userId) {
    return firestore.collection('users').doc(userId);
}

// ─── Workspace Routes ──────────────────────────────────────
app.get('/api/workspaces', async (req, res) => {
    try {
        const snapshot = await userRef(req.userId)
            .collection('workspaces')
            .get();
        const workspaces = snapshot.docs.map((doc) => doc.data());
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
        await userRef(req.userId)
            .collection('workspaces')
            .doc(workspace.id)
            .set(workspace);
        res.json(workspace);
    } catch (err) {
        console.error('POST /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/workspaces/:id', async (req, res) => {
    try {
        const updates = req.body;
        await userRef(req.userId)
            .collection('workspaces')
            .doc(req.params.id)
            .update(updates);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/workspaces error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/workspaces/:id', async (req, res) => {
    try {
        const uRef = userRef(req.userId);
        // Delete all canvases under this workspace
        const canvasSnap = await uRef
            .collection('canvases')
            .where('workspaceId', '==', req.params.id)
            .get();
        const batch = firestore.batch();
        canvasSnap.docs.forEach((doc) => batch.delete(doc.ref));
        batch.delete(uRef.collection('workspaces').doc(req.params.id));
        await batch.commit();
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
        let query = userRef(req.userId).collection('canvases');
        if (workspaceId) {
            query = query.where('workspaceId', '==', workspaceId);
        }
        const snapshot = await query.get();
        const canvases = snapshot.docs.map((doc) => doc.data());
        canvases.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        res.json(canvases);
    } catch (err) {
        console.error('GET /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/canvases/:id', async (req, res) => {
    try {
        const doc = await userRef(req.userId)
            .collection('canvases')
            .doc(req.params.id)
            .get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Canvas not found' });
        }
        res.json(doc.data());
    } catch (err) {
        console.error('GET /api/canvases/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/canvases', async (req, res) => {
    try {
        const canvas = req.body;
        await userRef(req.userId)
            .collection('canvases')
            .doc(canvas.id)
            .set(canvas);
        res.json(canvas);
    } catch (err) {
        console.error('POST /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/canvases/:id', async (req, res) => {
    try {
        const updates = req.body;
        await userRef(req.userId)
            .collection('canvases')
            .doc(req.params.id)
            .set(updates, { merge: true });
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/canvases/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/canvases/:id', async (req, res) => {
    try {
        await userRef(req.userId)
            .collection('canvases')
            .doc(req.params.id)
            .delete();
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE /api/canvases error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Seed Route ────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
    try {
        const wsSnap = await userRef(req.userId)
            .collection('workspaces')
            .limit(1)
            .get();
        if (!wsSnap.empty) {
            return res.json({ seeded: false, message: 'Data already exists' });
        }

        // Seed data comes from the request body (sent by frontend)
        const { workspace, canvas } = req.body;
        const batch = firestore.batch();
        const uRef = userRef(req.userId);
        batch.set(uRef.collection('workspaces').doc(workspace.id), workspace);
        batch.set(uRef.collection('canvases').doc(canvas.id), canvas);
        await batch.commit();
        res.json({ seeded: true });
    } catch (err) {
        console.error('POST /api/seed error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── PDF to Markdown ───────────────────────────────────────
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0634831802';
const VERTEX_LOCATION = 'us-central1';
const GEMINI_MODEL = 'gemini-2.0-flash-001';
const UPLOAD_BUCKET = `${PROJECT_ID}-uploads`; // Bucket for user uploads

// Initialize Cloud Storage
// Note: Requires @google-cloud/storage package
let storage;
try {
    const { Storage } = await import('@google-cloud/storage');
    storage = new Storage();
} catch (err) {
    console.warn('Google Cloud Storage not available:', err.message);
}

// Ensure bucket exists (lazy check)
async function getBucket() {
    if (!storage) throw new Error('Storage not initialized');
    const bucket = storage.bucket(UPLOAD_BUCKET);
    try {
        const [exists] = await bucket.exists();
        if (!exists) {
            await bucket.create({ location: VERTEX_LOCATION });
        }
    } catch (e) {
        console.warn('Bucket check/create failed (might already exist or permission issue):', e.message);
    }
    return bucket;
}

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

        // Generate a proxy URL so frontend can load it via our server (avoids CORS/Public issues)
        // Alternatively, use Signed URL if frontend handles it, but Proxy is safer for auth
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
        // Security check: ensure user hits their own folder or shared folder?
        // For simple canvas sharing, checking strict ownership might break sharing. 
        // For now, allow authenticated users to read any uploaded file (Workspace context controls visibility).

        const bucket = await getBucket();
        const file = bucket.file(filename);
        const [exists] = await file.exists();
        if (!exists) return res.status(404).send('File not found');

        // Stream file to response
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

        // Get access token from service account
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

        // Strip wrapping ```markdown ... ``` if present
        markdown = markdown.replace(/^```markdown\n?/i, '').replace(/\n?```$/i, '').trim();

        console.log(`PDF converted: ${markdown.length} chars`);
        res.json({ markdown, filename: req.file.originalname });
    } catch (err) {
        console.error('POST /api/convert-pdf error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── AI Research Routes ────────────────────────────────────

// Supported AI models grouped by provider
const AI_MODELS = [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'anthropic' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
    { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: 'google' },
    { id: 'qwen-plus', name: 'Qwen Plus', provider: 'dashscope' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
];

// GET /api/ai/models — list available models
app.get('/api/ai/models', (req, res) => {
    res.json(AI_MODELS);
});

// GET /api/ai/settings — read user's AI settings (keys masked)
app.get('/api/ai/settings', async (req, res) => {
    try {
        const doc = await userRef(req.userId).collection('settings').doc('ai').get();
        if (!doc.exists) {
            return res.json({ keys: {}, defaultModel: 'claude-3-5-sonnet-20241022' });
        }
        const data = doc.data();
        // Mask API keys for frontend display
        const maskedKeys = {};
        for (const [provider, key] of Object.entries(data.keys || {})) {
            if (key && typeof key === 'string' && key.length > 8) {
                maskedKeys[provider] = key.slice(0, 4) + '****' + key.slice(-4);
            } else {
                maskedKeys[provider] = key ? '****' : '';
            }
        }
        res.json({ keys: maskedKeys, defaultModel: data.defaultModel || 'claude-3-5-sonnet-20241022' });
    } catch (err) {
        console.error('GET /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/ai/settings — save API keys and default model
app.put('/api/ai/settings', async (req, res) => {
    try {
        const { keys, defaultModel } = req.body;
        // Merge: only update keys that are provided (non-empty)
        const doc = await userRef(req.userId).collection('settings').doc('ai').get();
        const existing = doc.exists ? doc.data() : { keys: {}, defaultModel: 'claude-3-5-sonnet-20241022' };
        const mergedKeys = { ...existing.keys };
        if (keys) {
            for (const [provider, key] of Object.entries(keys)) {
                // Skip masked values (don't overwrite with mask)
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
        await userRef(req.userId).collection('settings').doc('ai').set(settings);
        res.json({ ok: true });
    } catch (err) {
        console.error('PUT /api/ai/settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Helper: get API key for a provider from user's settings
async function getUserApiKey(userId, provider) {
    const doc = await userRef(userId).collection('settings').doc('ai').get();
    if (!doc.exists) return null;
    return doc.data().keys?.[provider] || null;
}

// Helper: determine provider from model ID
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
            // Use Gemini REST API with API key
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
            // Parse SSE from Gemini
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
            // Qwen via OpenAI-compatible endpoint
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
