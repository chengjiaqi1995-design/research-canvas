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

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; userId?: string };
    // server.js signs JWT with { sub }, aiprocess-api signs with { userId }
    const userId = decoded.sub || decoded.userId;
    if (!userId) {
      console.error('[RealtimeWS] JWT missing sub/userId field. Decoded payload keys:', Object.keys(decoded));
      return null;
    }
    return userId;
  } catch (error) {
    const errMsg = (error as Error).message;
    console.error(`[RealtimeWS] JWT verification failed: ${errMsg} | token length: ${token.length} | JWT_SECRET set: ${!!process.env.JWT_SECRET} | token starts with: ${token.substring(0, 10)}...`);
    // If verification fails, try to decode without verification to see if the token structure is valid
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        console.error(`[RealtimeWS] Token payload (unverified): sub=${payload.sub}, userId=${payload.userId}, exp=${payload.exp}, iat=${payload.iat}`);
        if (payload.exp) {
          const expiresAt = new Date(payload.exp * 1000);
          const now = new Date();
          console.error(`[RealtimeWS] Token expires: ${expiresAt.toISOString()}, now: ${now.toISOString()}, expired: ${now > expiresAt}`);
        }
      } else {
        console.error(`[RealtimeWS] Token is not a valid JWT format (${parts.length} parts instead of 3)`);
      }
    } catch (decodeErr) {
      console.error('[RealtimeWS] Could not decode token payload:', (decodeErr as Error).message);
    }
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

      // Verify auth token — try multiple sources (query param, Sec-WebSocket-Protocol header)
      // URL query params may get mangled through Nginx → Cloud Run → http-proxy-middleware chain
      let token = params.get('token');

      // Fallback: extract token from Sec-WebSocket-Protocol header (format: "auth-<jwt>")
      if (!token) {
        const protocols = req.headers['sec-websocket-protocol'] as string | undefined;
        if (protocols) {
          const protoList = protocols.split(',').map((s: string) => s.trim());
          const authProto = protoList.find((p: string) => p.startsWith('auth-'));
          if (authProto) {
            token = authProto.slice(5); // strip "auth-" prefix
          }
        }
      }

      if (!token) {
        console.error('[RealtimeWS] No auth token found in query params or protocol header');
        throw new Error('No auth token provided');
      }

      console.log('[RealtimeWS] Token source:', params.get('token') ? 'query' : 'protocol-header', '| length:', token.length, '| prefix:', token.substring(0, 20) + '...');

      let userId = verifyToken(token);

      // If query-param token failed, try protocol header token (and vice versa)
      if (!userId) {
        const protocols2 = req.headers['sec-websocket-protocol'] as string | undefined;
        if (protocols2) {
          const protoList = protocols2.split(',').map((s: string) => s.trim());
          const authProto = protoList.find((p: string) => p.startsWith('auth-'));
          if (authProto) {
            const protoToken = authProto.slice(5);
            if (protoToken !== token) {
              console.log('[RealtimeWS] Trying protocol-header token as fallback...');
              userId = verifyToken(protoToken);
            }
          }
        }
      }

      if (!userId) {
        console.error('[RealtimeWS] All token verification methods failed');
        throw new Error('Invalid or expired auth token');
      }

      console.log('[RealtimeWS] User authenticated:', userId);

      // Ensure dev-local user exists in DB (WebSocket bypasses auth middleware)
      if (userId === 'dev-local') {
        try {
          const existing = await prisma.user.findUnique({ where: { id: 'dev-local' }, select: { id: true } });
          if (!existing) {
            await prisma.user.create({
              data: { id: 'dev-local', googleId: 'dev-local', email: 'dev@localhost', name: 'Dev User' },
            });
            console.log('[RealtimeWS] Created dev-local user in database');
          }
        } catch (e) {
          // non-blocking - user may already exist
        }
      }

      // Create transcription record
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
      const transcription = await prisma.transcription.create({
        data: {
          fileName: dateStr,
          filePath: '', // Realtime recording has no file path
          fileSize: 0,
          aiProvider: 'qwen',
          status: 'processing',
          userId,
        },
      });

      // Create Python transcription service
      const pythonService = new PythonTranscriptionService({
        apiKey,
        modelName: transcriptionConfig.model,
        noiseThreshold: transcriptionConfig.noiseThreshold,
        turnDetectionSilenceDuration: transcriptionConfig.turnDetectionSilenceDuration,
        turnDetectionThreshold: transcriptionConfig.turnDetectionThreshold,
        enableSpeakerDiarization: transcriptionConfig.enableSpeakerDiarization,
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
            speakerId: data.speakerId !== undefined && data.speakerId !== null && data.speakerId !== 0
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
          };
          if (data.speakerId && data.speakerId !== 0) {
            message.speakerId = String(data.speakerId);
          }
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
