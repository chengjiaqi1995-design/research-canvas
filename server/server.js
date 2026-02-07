import express from 'express';
import cors from 'cors';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
            .orderBy('updatedAt', 'desc')
            .get();
        const workspaces = snapshot.docs.map((doc) => doc.data());
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
        const snapshot = await query.orderBy('updatedAt', 'desc').get();
        const canvases = snapshot.docs.map((doc) => doc.data());
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

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Research Canvas API listening on port ${PORT}`);
});
