import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { PythonTranscriptionService } from './realtimePythonService.js';
import { createTranscription, updateTranscription } from './store.js';

interface RealtimeSession {
  pythonService: PythonTranscriptionService;
  transcriptionId: string;
  createdAt: number;
  finalText: string;
  segments: Array<{ text: string; speakerId?: number; timestamp: number }>;
  audioFrames: number;
}

const sessions = new Map<WebSocket, RealtimeSession>();

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

export function initializeRealtimeWebsocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws/realtime-transcription' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const apiKey = process.env.DASHSCOPE_API_KEY || '';
    const model = url.searchParams.get('model') || 'qwen3-asr-flash-realtime';
    const language = url.searchParams.get('language') || 'zh';
    const noiseThreshold = Number(url.searchParams.get('noiseThreshold') || 500);
    const enableSpeakerDiarization = url.searchParams.get('enableSpeakerDiarization') !== 'false';
    const turnDetectionSilenceDuration = Number(url.searchParams.get('turnDetectionSilenceDuration') || 800);
    const turnDetectionThreshold = Number(url.searchParams.get('turnDetectionThreshold') || 0.4);

    if (!apiKey) {
      sendJson(ws, { type: 'error', error: 'Missing DASHSCOPE_API_KEY on server' });
      ws.close();
      return;
    }

    const now = new Date();
    const transcription = createTranscription({
      fileName: now.toISOString().slice(0, 19).replace('T', ' '),
      aiProvider: model,
    });

    const pythonService = new PythonTranscriptionService({
      apiKey,
      modelName: model,
      noiseThreshold,
      language,
      enableSpeakerDiarization,
      turnDetectionSilenceDuration,
      turnDetectionThreshold,
    });

    const session: RealtimeSession = {
      pythonService,
      transcriptionId: transcription.id,
      createdAt: Date.now(),
      finalText: '',
      segments: [],
      audioFrames: 0,
    };
    sessions.set(ws, session);

    pythonService.on('status', (message) => {
      sendJson(ws, { type: 'log', level: 'info', source: 'python', message });
      if (String(message || '').includes('Connection established')) {
        sendJson(ws, { type: 'ready' });
      }
    });

    pythonService.on('partial', (payload: { speakerId: number; text: string }) => {
      sendJson(ws, {
        type: 'partial',
        text: payload.text,
        speakerId: payload.speakerId,
        timestamp: Date.now(),
      });
    });

    pythonService.on('commit', (payload: { speakerId: number; text: string }) => {
      const segment = {
        text: payload.text,
        speakerId: payload.speakerId,
        timestamp: Date.now(),
      };
      session.segments.push(segment);
      session.finalText = [session.finalText, payload.text].filter(Boolean).join(' ');
      sendJson(ws, {
        type: 'transcription',
        text: payload.text,
        speakerId: payload.speakerId,
        isFinal: true,
        timestamp: segment.timestamp,
      });
    });

    pythonService.on('error', (error) => {
      const message = typeof error === 'string' ? error : (error as Error)?.message || String(error);
      updateTranscription(transcription.id, { status: 'failed', errorMessage: message });
      sendJson(ws, { type: 'error', error: message });
    });

    pythonService.on('progress', (progress) => {
      sendJson(ws, { type: 'log', level: 'info', source: 'python', message: `progress ${JSON.stringify(progress)}` });
    });

    try {
      await pythonService.start();
      sendJson(ws, { type: 'session_created', transcriptionId: transcription.id });
      sendJson(ws, { type: 'log', level: 'info', source: 'server', message: `session created: ${transcription.id}` });
    } catch (error) {
      const message = (error as Error).message;
      updateTranscription(transcription.id, { status: 'failed', errorMessage: message });
      sendJson(ws, { type: 'error', error: message });
      ws.close();
      return;
    }

    ws.on('message', (data) => {
      const active = sessions.get(ws);
      if (!active) return;

      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buffer[0] === 0x7b) {
        try {
          const msg = JSON.parse(buffer.toString('utf8'));
          if (msg.type === 'update_commit_params') {
            active.pythonService.updateCommitParams(msg.params || {});
            return;
          }
        } catch {
          // Treat malformed JSON-like data as audio below.
        }
      }

      active.audioFrames += 1;
      active.pythonService.sendAudioFrame(buffer, Date.now());
    });

    ws.on('close', async () => {
      const active = sessions.get(ws);
      if (!active) return;
      active.pythonService.stop();
      await new Promise((resolve) => setTimeout(resolve, 800));
      const duration = Math.max(0, Math.floor((Date.now() - active.createdAt) / 1000));
      updateTranscription(active.transcriptionId, {
        duration,
        status: 'completed',
      });
      sessions.delete(ws);
    });
  });

  return wss;
}

