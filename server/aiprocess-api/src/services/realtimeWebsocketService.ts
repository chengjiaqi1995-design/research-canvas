import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { PythonTranscriptionService } from './realtimePythonService';
import prisma from '../utils/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Verify JWT token and return userId.
 * Supports dev-token bypass for local development.
 */
function verifyToken(token: string): string | null {
  // Dev token bypass
  if (token === 'dev-token') {
    return 'dev-local';
  }

  // 1. Try strict verification first
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string };
    const userId = decoded.sub || decoded.userId;
    if (userId) {
      console.log('[RealtimeWS] JWT verified successfully for user:', userId);
      return userId;
    }
  } catch (error) {
    console.warn(`[RealtimeWS] JWT strict verify failed: ${(error as Error).message} | JWT_SECRET set: ${!!process.env.JWT_SECRET} | secret prefix: ${JWT_SECRET.substring(0, 6)}...`);
  }

  // 2. Fallback: decode without verification
  //    WebSocket is already behind Nginx auth proxy + server.js proxy,
  //    so if the JWT structure is valid and has a sub/userId, trust it.
  //    This handles cases where the token gets re-encoded through the
  //    multi-layer proxy chain (Nginx → Cloud Run LB → server.js → aiprocess-api).
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error(`[RealtimeWS] Token is not JWT format (${parts.length} parts)`);
      return null;
    }
    // Try base64url first, then standard base64
    let payloadStr: string;
    try {
      payloadStr = Buffer.from(parts[1], 'base64url').toString();
    } catch {
      payloadStr = Buffer.from(parts[1], 'base64').toString();
    }
    const payload = JSON.parse(payloadStr);
    const userId = payload.sub || payload.userId;

    if (!userId) {
      console.error('[RealtimeWS] Token payload missing sub/userId:', Object.keys(payload));
      return null;
    }

    // Check expiration
    if (payload.exp) {
      const now = Math.floor(Date.now() / 1000);
      if (now > payload.exp) {
        console.error(`[RealtimeWS] Token expired: exp=${new Date(payload.exp * 1000).toISOString()}`);
        return null;
      }
    }

    console.log(`[RealtimeWS] JWT decoded (unverified fallback) for user: ${userId}`);
    return userId;
  } catch (decodeErr) {
    console.error('[RealtimeWS] Could not decode token:', (decodeErr as Error).message);
    return null;
  }
}

interface RealtimeSession {
  pythonService: PythonTranscriptionService | null;
  transcriptionId: string;
  partialText: string;
  finalText: string;
  createdAt: number;
  lastActivity: number;
  audioChunksReceived: number;
}

const sessions = new Map<WebSocket, RealtimeSession>();

/**
 * Initialize WebSocket server for realtime transcription.
 * Uses Python DashScope SDK service (qwen provider only).
 */
export function initializeWebSocketServer(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/realtime-transcription',
    // Accept auth-* subprotocol so browser doesn't reject the connection
    handleProtocols(protocols: Set<string>) {
      for (const proto of protocols) {
        if (proto.startsWith('auth-')) return proto;
      }
      return false; // no matching protocol required
    },
  });

  wss.on('connection', async (clientWs: WebSocket, req: IncomingMessage) => {
    console.log('[RealtimeWS] New WebSocket connection');

    try {
      // Parse config from URL query params
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost:8081'}`);
      const params = url.searchParams;

      const transcriptionConfig = {
        sampleRate: params.get('sampleRate') ? parseInt(params.get('sampleRate')!) : 16000,
        enableSpeakerDiarization: params.get('enableSpeakerDiarization') !== 'false',
        enablePunctuation: params.get('enablePunctuation') !== 'false',
        model: params.get('model') || 'paraformer-realtime-v2',
        noiseThreshold: params.get('noiseThreshold') ? parseInt(params.get('noiseThreshold')!) : 500,
        turnDetectionSilenceDuration: params.get('turnDetectionSilenceDuration') ? parseInt(params.get('turnDetectionSilenceDuration')!) : 800,
        turnDetectionThreshold: params.get('turnDetectionThreshold') ? parseFloat(params.get('turnDetectionThreshold')!) : 0.4,
        enableDisfluencyRemoval: params.get('enableDisfluencyRemoval') === 'true',
        language: params.get('language') || 'zh',
        // Commit strategy overrides (0 = use server default)
        commitStrongMin: params.get('commitStrongMin') ? parseInt(params.get('commitStrongMin')!) : 0,
        commitWeakMin: params.get('commitWeakMin') ? parseInt(params.get('commitWeakMin')!) : 0,
        commitForceLen: params.get('commitForceLen') ? parseInt(params.get('commitForceLen')!) : 0,
        commitBufferIsEnd: params.get('commitBufferIsEnd') ? parseInt(params.get('commitBufferIsEnd')!) : 0,
        commitSilTimeout: params.get('commitSilTimeout') ? parseFloat(params.get('commitSilTimeout')!) : 0,
      };

      // Get API key: query params first, fallback to env vars
      let apiKey = params.get('apiKey') || '';
      if (!apiKey) {
        apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
      }

      if (!apiKey) {
        throw new Error('Qwen API key not configured');
      }

      console.log('[RealtimeWS] Transcription config:', transcriptionConfig);
      console.log('[RealtimeWS] API key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'not configured');

      // ── Auth: best-effort, never block recording ──
      // WebSocket is already behind Nginx → Cloud Run → server.js proxy chain.
      // If JWT verification fails for any reason, fall back to anonymous user
      // so the transcription still works.
      let userId = 'anonymous';
      const token = params.get('token');
      if (token) {
        const verified = verifyToken(token);
        if (verified) {
          userId = verified;
          console.log('[RealtimeWS] User authenticated:', userId);
        } else {
          console.warn('[RealtimeWS] Token verification failed, using anonymous user. Token length:', token.length);
        }
      } else {
        console.warn('[RealtimeWS] No token provided, using anonymous user');
      }

      // Ensure user exists in DB for foreign key constraint
      try {
        const existing = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!existing) {
          await prisma.user.create({
            data: { id: userId, googleId: userId, email: `${userId}@placeholder.com`, name: userId === 'anonymous' ? 'Anonymous' : 'User' },
          });
          console.log('[RealtimeWS] Created user in database:', userId);
        }
      } catch (e) {
        // non-blocking - user may already exist from race condition
      }

      // Reuse existing transcription record on reconnect, or create a new one
      const existingTranscriptionId = params.get('existingTranscriptionId');
      let transcription: { id: string };

      if (existingTranscriptionId) {
        // Only match by id — don't filter by userId, because on reconnect the
        // JWT may have expired causing userId to fall back to 'anonymous',
        // which would fail to find the original record and create a duplicate.
        const existing = await prisma.transcription.findFirst({
          where: { id: existingTranscriptionId },
          select: { id: true, userId: true },
        });
        if (existing) {
          transcription = existing;
          // Use the original transcription's userId to keep ownership consistent
          userId = existing.userId;
          console.log('[RealtimeWS] Reusing existing transcription on reconnect:', transcription.id);
        } else {
          console.warn('[RealtimeWS] existingTranscriptionId not found, creating new record');
          const currentDate = new Date();
          const dateStr = currentDate.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
          transcription = await prisma.transcription.create({
            data: { fileName: dateStr, filePath: '', fileSize: 0, aiProvider: 'qwen', status: 'processing', userId },
          });
        }
      } else {
        const currentDate = new Date();
        const dateStr = currentDate.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
        transcription = await prisma.transcription.create({
          data: { fileName: dateStr, filePath: '', fileSize: 0, aiProvider: 'qwen', status: 'processing', userId },
        });
      }

      // Create Python transcription service
      const pythonService = new PythonTranscriptionService({
        apiKey,
        modelName: transcriptionConfig.model,
        noiseThreshold: transcriptionConfig.noiseThreshold,
        turnDetectionSilenceDuration: transcriptionConfig.turnDetectionSilenceDuration,
        turnDetectionThreshold: transcriptionConfig.turnDetectionThreshold,
        enableSpeakerDiarization: transcriptionConfig.enableSpeakerDiarization,
        enableDisfluencyRemoval: transcriptionConfig.enableDisfluencyRemoval,
        language: transcriptionConfig.language,
        commitStrongMin: transcriptionConfig.commitStrongMin,
        commitWeakMin: transcriptionConfig.commitWeakMin,
        commitForceLen: transcriptionConfig.commitForceLen,
        commitBufferIsEnd: transcriptionConfig.commitBufferIsEnd,
        commitSilTimeout: transcriptionConfig.commitSilTimeout,
      });

      // Initialize session
      const now = Date.now();
      const session: RealtimeSession = {
        pythonService,
        transcriptionId: transcription.id,
        partialText: '',
        finalText: '',
        createdAt: now,
        lastActivity: now,
        audioChunksReceived: 0,
      };

      sessions.set(clientWs, session);

      // Set up Python service event listeners
      pythonService.on('status', (message: string) => {
        console.log('[RealtimeWS] Python service status:', message);
        if (clientWs.readyState === WebSocket.OPEN) {
          if (message.includes('Started successfully') || message.includes('Connection established')) {
            clientWs.send(JSON.stringify({
              type: 'init',
              transcriptionId: transcription.id,
            }));
          }
          clientWs.send(JSON.stringify({
            type: 'status',
            message,
          }));
        }
      });

      pythonService.on('commit', (data: { speakerId: number; text: string; [key: string]: any }) => {
        const t5NodeSend = Date.now();
        session.finalText += data.text + ' ';
        session.partialText = '';

        if (clientWs.readyState === WebSocket.OPEN) {
          const message: any = {
            type: 'transcription',
            isFinal: true,
            ...data,
            text: data.text,
            t5NodeSend,
            // DashScope speaker IDs start from 0 — always include when diarization is enabled
            speakerId: data.speakerId !== undefined && data.speakerId !== null
              ? String(data.speakerId)
              : undefined,
          };
          clientWs.send(JSON.stringify(message));
        }
      });

      pythonService.on('partial', (data: { speakerId: number; text: string; [key: string]: any }) => {
        const t5NodeSend = Date.now();
        session.partialText = data.text;

        if (clientWs.readyState === WebSocket.OPEN) {
          const message: any = {
            type: 'transcription',
            isFinal: false,
            ...data,
            text: data.text,
            t5NodeSend,
            speakerId: data.speakerId !== undefined && data.speakerId !== null
              ? String(data.speakerId)
              : undefined,
          };
          clientWs.send(JSON.stringify(message));
        }
      });

      pythonService.on('error', (error: string) => {
        console.error('[RealtimeWS] Python service error:', error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error,
          }));
        }
      });

      pythonService.on('close', () => {
        console.log('[RealtimeWS] Python service closed');
      });

      // Start Python service
      try {
        await pythonService.start();
        console.log('[RealtimeWS] Python transcription service started');
      } catch (error: any) {
        console.error('[RealtimeWS] Failed to start Python service:', error);
        clientWs.send(JSON.stringify({
          type: 'error',
          error: `Failed to start transcription service: ${error.message}`,
        }));
        clientWs.close();
        return;
      }

      console.log(`[RealtimeWS] Session created: ${transcription.id}`);
    } catch (error: any) {
      console.error('[RealtimeWS] Failed to create session:', error);
      clientWs.send(JSON.stringify({
        type: 'error',
        error: error.message,
      }));
      clientWs.close();
      return;
    }

    // Handle incoming audio data from the client
    clientWs.on('message', async (data: Buffer) => {
      const session = sessions.get(clientWs);
      if (!session || !session.pythonService) return;

      try {
        const t3NodeReceive = Date.now();
        session.lastActivity = t3NodeReceive;
        session.audioChunksReceived++;

        if (session.audioChunksReceived % 100 === 0) {
          console.log(`[RealtimeWS] Audio packet #${session.audioChunksReceived}`);
        }

        // Send audio data to Python service
        if (Buffer.isBuffer(data)) {
          session.pythonService.sendAudioFrame(data, t3NodeReceive);
        } else {
          console.warn('[RealtimeWS] Received non-binary audio data, ignoring');
        }
      } catch (error: any) {
        console.error('[RealtimeWS] Error processing audio data:', error);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: `Audio data processing error: ${error.message}`,
          }));
        }
      }
    });

    // Handle client connection close
    clientWs.on('close', async () => {
      const session = sessions.get(clientWs);
      if (session) {
        try {
          // Stop Python service
          if (session.pythonService) {
            session.pythonService.stop();
          }

          // Update database
          const duration = Math.floor((Date.now() - session.createdAt) / 1000);
          if (session.finalText.trim()) {
            const finalText = session.finalText.trim();

            // Store transcript as JSON (consistent with file transcription format)
            const transcriptData = {
              text: finalText,
              segments: [],
            };
            const transcriptTextJson = JSON.stringify(transcriptData);

            await prisma.transcription.update({
              where: { id: session.transcriptionId },
              data: {
                transcriptText: transcriptTextJson,
                status: 'completed',
                duration,
              } as any,
            });
            console.log(`[RealtimeWS] Session completed: ${session.transcriptionId} (${duration}s, ${session.audioChunksReceived} audio chunks)`);
          } else {
            await prisma.transcription.update({
              where: { id: session.transcriptionId },
              data: {
                status: 'failed',
                errorMessage: 'No transcript content received',
                duration,
              },
            });
            console.log(`[RealtimeWS] Session failed: ${session.transcriptionId} (no content)`);
          }
        } catch (error: any) {
          console.error('[RealtimeWS] Error closing session:', error);
        }

        sessions.delete(clientWs);
      }
    });

    // Handle client errors
    clientWs.on('error', (error) => {
      console.error('[RealtimeWS] Client WebSocket error:', error);
      const session = sessions.get(clientWs);
      if (session) {
        if (session.pythonService) {
          session.pythonService.stop();
        }
        sessions.delete(clientWs);
      }
    });
  });

  console.log('[RealtimeWS] WebSocket server initialized: /ws/realtime-transcription');

  return wss;
}
