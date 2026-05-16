import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { initializeRealtimeWebsocket } from './realtimeWebsocketService.js';
import {
  ensureDataDirs,
  getAudioDir,
  getTranscription,
  listTranscriptions,
  resolveAudioPath,
  updateTranscription,
} from './store.js';
import { TranscriptPayload } from './types.js';

ensureDataDirs();

const app = express();
const port = Number(process.env.PORT || 8081);
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({ origin: frontendUrl, credentials: true }));
app.use(express.json({ limit: '20mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, getAudioDir()),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.webm';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const baseMime = (file.mimetype || '').split(';')[0].toLowerCase();
    if (baseMime.startsWith('audio/') || /\.(mp3|mp4|wav|m4a|ogg|webm|flac|aac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are supported'));
    }
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/transcriptions', (_req, res) => {
  res.json({ success: true, data: listTranscriptions() });
});

app.get('/api/transcriptions/:id', (req, res) => {
  const record = getTranscription(req.params.id);
  if (!record) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, data: record });
});

app.put('/api/transcriptions/:id/save-text', (req, res) => {
  const payload = req.body as { transcriptText?: string | TranscriptPayload };
  if (!payload.transcriptText) {
    return res.status(400).json({ success: false, error: 'Missing transcriptText' });
  }

  const transcriptText = typeof payload.transcriptText === 'string'
    ? payload.transcriptText
    : JSON.stringify(payload.transcriptText);

  const record = updateTranscription(req.params.id, {
    transcriptText,
    status: 'completed',
  });
  if (!record) return res.status(404).json({ success: false, error: 'Not found' });
  return res.json({ success: true, data: record });
});

app.post('/api/transcriptions/:id/upload-audio', upload.single('audio'), (req, res) => {
  const id = String(req.params.id);
  const record = getTranscription(id);
  if (!record) return res.status(404).json({ success: false, error: 'Not found' });
  if (!req.file) return res.status(400).json({ success: false, error: 'Missing audio file' });

  const updated = updateTranscription(id, {
    filePath: req.file.filename,
    fileSize: req.file.size,
  });
  return res.json({ success: true, data: updated });
});

app.get('/api/transcriptions/:id/audio', (req, res) => {
  const record = getTranscription(req.params.id);
  if (!record || !record.filePath) return res.status(404).json({ success: false, error: 'Audio not found' });

  const audioPath = resolveAudioPath(record.filePath);
  if (!fs.existsSync(audioPath)) return res.status(404).json({ success: false, error: 'Audio file missing' });

  const ext = path.extname(audioPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.webm': 'audio/webm',
    '.mp4': 'audio/mp4',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
  };
  const stat = fs.statSync(audioPath);
  const range = req.headers.range;
  const contentType = mimeMap[ext] || 'application/octet-stream';

  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
    const start = Number(startRaw);
    const end = endRaw ? Number(endRaw) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(audioPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(audioPath).pipe(res);
});

const server = http.createServer(app);
initializeRealtimeWebsocket(server);

server.listen(port, () => {
  console.log(`Realtime transcription API listening on http://localhost:${port}`);
  console.log(`Allowed frontend origin: ${frontendUrl}`);
});
