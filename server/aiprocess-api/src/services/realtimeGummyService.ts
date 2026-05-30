import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';

export interface GummyConfig {
  apiKey: string;
  modelName?: string;           // gummy-realtime-v1
  noiseThreshold?: number;
  language?: string;            // zh / en / ja / ko / mixed / ja-en (→ auto)
  translationTarget?: string;   // en / zh / ja / ko ...
  maxEndSilenceMs?: number;
}

/**
 * Wraps the Python Gummy realtime service (ASR + translation in one stream).
 *
 * Events emitted:
 *   - 'status'              (message: string)
 *   - 'commit'              ({ speakerId, text, segmentIndex? })
 *   - 'partial'             ({ speakerId, text })
 *   - 'translation_commit'  ({ speakerId, text, segmentIndex? })
 *   - 'translation_partial' ({ speakerId, text, segmentIndex? })
 *   - 'progress'            ({ packetId, rms })
 *   - 'error'               (message: string)
 *   - 'close'               ()
 *
 * Matches PythonTranscriptionService's audio API (sendAudioFrame/stop) so the
 * WebSocket layer can swap providers without restructuring.
 */
export class PythonGummyService extends EventEmitter {
  private process: ChildProcess | null = null;
  private initialized = false;
  private buffer = '';
  private readonly MAX_BUFFER_SIZE = 1024 * 1024;
  private bufferCheckInterval: NodeJS.Timeout | null = null;

  constructor(private config: GummyConfig) {
    super();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, '../../python_service', 'realtime_gummy.py');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

      const env = { ...process.env };
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';

      this.process = spawn(pythonCmd, [pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../../'),
        shell: process.platform === 'win32',
        env,
      });

      this.process.stdout?.setEncoding('utf8');
      this.process.stdout?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        this.buffer += text;
        this._processBuffer();
        this._checkBufferSize();
      });

      this.bufferCheckInterval = setInterval(() => this._checkBufferSize(), 30000);

      this.process.stderr?.setEncoding('utf8');
      this.process.stderr?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        console.error('[Gummy] Python stderr:', text);
      });

      this.process.on('exit', (code) => {
        console.log(`[Gummy] Python process exited with code: ${code}`);
        this.initialized = false;
        if (this.bufferCheckInterval) {
          clearInterval(this.bufferCheckInterval);
          this.bufferCheckInterval = null;
        }
        this.emit('close');
      });

      this.process.on('error', (error) => {
        console.error('[Gummy] Python process error:', error);
        this.emit('error', error);
        reject(error);
      });

      const initTimeout = setTimeout(() => {
        console.warn('[Gummy] SDK init timed out after 10s, resolving anyway');
        resolve();
      }, 10000);

      const onReady = (message: string) => {
        if (
          message.includes('Started successfully') ||
          message.includes('Connection established')
        ) {
          clearTimeout(initTimeout);
          this.removeListener('status', onReady);
          resolve();
        }
      };
      this.on('status', onReady);

      setTimeout(() => this._sendInit(), 500);
    });
  }

  private _sendInit(): void {
    if (!this.process || !this.process.stdin) return;
    const message: any = {
      type: 'init',
      api_key: this.config.apiKey,
      model_name: this.config.modelName || 'gummy-realtime-v1',
      noise_threshold: this.config.noiseThreshold ?? 500,
      language: this.config.language || 'zh',
      translation_target: this.config.translationTarget || 'en',
      max_end_silence_ms: this.config.maxEndSilenceMs ?? 800,
    };
    try {
      this.process.stdin.write(JSON.stringify(message) + '\n', 'utf8');
      console.log('[Gummy] Sent init:', {
        model: message.model_name,
        language: message.language,
        translation_target: message.translation_target,
      });
    } catch (error: any) {
      console.error('[Gummy] Failed to send init:', error);
      this.emit('error', error);
    }
  }

  /** Same signature as PythonTranscriptionService for drop-in compatibility. */
  sendAudioFrame(pcmData: Buffer, t3NodeReceive: number = 0): void {
    if (!this.process || !this.process.stdin) return;
    try {
      const message = {
        type: 'audio',
        data: pcmData.toString('base64'),
        t3NodeSend: Date.now(),
        t3NodeReceive,
      };
      this.process.stdin.write(JSON.stringify(message) + '\n', 'utf8');
    } catch (error: any) {
      console.error('[Gummy] Failed to send audio frame:', error);
    }
  }

  /** No-op for Gummy (cloud-side VAD; commit params do not apply). Kept for API parity. */
  updateCommitParams(_params: Record<string, number>): void {
    /* intentionally empty */
  }

  stop(): void {
    if (this.bufferCheckInterval) {
      clearInterval(this.bufferCheckInterval);
      this.bufferCheckInterval = null;
    }
    if (this.process && this.process.stdin) {
      try {
        this.process.stdin.write(JSON.stringify({ type: 'stop' }) + '\n', 'utf8');
        setTimeout(() => {
          if (this.process) this.process.kill();
        }, 500);
      } catch {
        if (this.process) this.process.kill();
      }
    }
    this.initialized = false;
  }

  private _processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message: any = JSON.parse(trimmed);
        this._handleMessage(message);
      } catch {
        console.error('[Gummy] Failed to parse Python message:', trimmed);
      }
    }
  }

  private _checkBufferSize(): void {
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      const lastNewlineIndex = this.buffer.lastIndexOf('\n');
      this.buffer = lastNewlineIndex > 0 ? this.buffer.substring(lastNewlineIndex + 1) : '';
    }
  }

  private _handleMessage(message: any): void {
    switch (message.type) {
      case 'status':
        if (
          message.message?.includes('Started successfully') ||
          message.message?.includes('Connection established')
        ) {
          this.initialized = true;
        }
        this.emit('status', message.message);
        break;

      case 'commit':
        this.emit('commit', {
          speakerId: message.speaker_id ?? 0,
          text: message.text || '',
          segmentIndex: message.segment_index,
        });
        break;

      case 'partial':
        this.emit('partial', {
          speakerId: message.speaker_id ?? 0,
          text: message.text || '',
        });
        break;

      case 'translation_commit':
        this.emit('translation_commit', {
          speakerId: message.speaker_id ?? 0,
          text: message.text || '',
          segmentIndex: message.segment_index,
        });
        break;

      case 'translation_partial':
        this.emit('translation_partial', {
          speakerId: message.speaker_id ?? 0,
          text: message.text || '',
          segmentIndex: message.segment_index,
        });
        break;

      case 'error':
        console.error('[Gummy] service error:', message.message);
        this.emit('error', message.message || 'Unknown error');
        break;

      case 'pong':
        break;

      case 'debug_progress':
        if (message.packetId && message.packetId % 200 === 0) {
          this.emit('progress', { packetId: message.packetId, rms: message.rms });
        }
        break;

      default:
        break;
    }
  }
}
