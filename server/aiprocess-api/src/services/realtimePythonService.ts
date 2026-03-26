import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';

export interface TranscriptionMessage {
  type: 'status' | 'commit' | 'partial' | 'error' | 'pong' | 'debug_progress';
  message?: string;
  speaker_id?: number;
  text?: string;
}

export interface TranscriptionConfig {
  apiKey: string;
  modelName: string;
  noiseThreshold: number;
  turnDetectionSilenceDuration?: number;
  turnDetectionThreshold?: number;
  enableSpeakerDiarization?: boolean;
}

/**
 * Python transcription service manager (qwen only).
 * Communicates with Python service via stdin/stdout.
 */
export class PythonTranscriptionService extends EventEmitter {
  private process: ChildProcess | null = null;
  private initialized: boolean = false;
  private buffer: string = '';
  private readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer size
  private bufferCheckInterval: NodeJS.Timeout | null = null;

  constructor(private config: TranscriptionConfig) {
    super();
  }

  /**
   * Start the Python service
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, '../../python_service', 'realtime_transcription.py');

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

      // Handle stdout (Python output)
      this.process.stdout?.setEncoding('utf8');
      this.process.stdout?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        this.buffer += text;
        this._processBuffer();
        this._checkBufferSize();
      });

      // Start periodic buffer size check (every 30 seconds)
      this.bufferCheckInterval = setInterval(() => {
        this._checkBufferSize();
      }, 30000);

      // Handle stderr (Python errors)
      this.process.stderr?.setEncoding('utf8');
      this.process.stderr?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        console.error('Python stderr:', text);
      });

      // Handle process exit
      this.process.on('exit', (code) => {
        console.log(`Python process exited with code: ${code}`);
        this.initialized = false;
        if (this.bufferCheckInterval) {
          clearInterval(this.bufferCheckInterval);
          this.bufferCheckInterval = null;
        }
        this.emit('close');
      });

      // Handle process error
      this.process.on('error', (error) => {
        console.error('Python process error:', error);
        this.emit('error', error);
        reject(error);
      });

      // Wait for Python process to start, send init, then wait for SDK ready
      const initTimeout = setTimeout(() => {
        console.warn('[PythonService] SDK init timed out after 10s, resolving anyway');
        resolve();
      }, 10000);

      // Listen for SDK ready status
      const onReady = (message: string) => {
        if (message.includes('Started successfully') || message.includes('启动成功') || message.includes('Connection established') || message.includes('连接建立')) {
          clearTimeout(initTimeout);
          this.removeListener('status', onReady);
          resolve();
        }
      };
      this.on('status', onReady);

      setTimeout(() => {
        this.sendInit();
      }, 500);
    });
  }

  /**
   * Send initialization message
   */
  private sendInit(): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    const message: any = {
      type: 'init',
      api_key: this.config.apiKey,
      model_name: this.config.modelName,
      noise_threshold: this.config.noiseThreshold,
      turn_detection_silence_duration_ms: this.config.turnDetectionSilenceDuration ?? 800,
      turn_detection_threshold: this.config.turnDetectionThreshold ?? 0.4,
      disable_speaker_diarization: this.config.enableSpeakerDiarization === false,
    };

    try {
      const messageStr = JSON.stringify(message) + '\n';
      this.process.stdin.write(messageStr, 'utf8');
      console.log('[RealtimePython] Sent init message to Python service');
    } catch (error: any) {
      console.error('[RealtimePython] Failed to send init message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Send audio data
   */
  sendAudioFrame(pcmData: Buffer, t3NodeReceive: number = 0): void {
    if (!this.process || !this.process.stdin) {
      console.warn('[RealtimePython] Python process or stdin not ready, cannot send audio data');
      return;
    }

    try {
      const t3NodeSend = Date.now();
      const base64Data = pcmData.toString('base64');
      const message = {
        type: 'audio',
        data: base64Data,
        t3NodeSend,
        t3NodeReceive,
      };

      const messageStr = JSON.stringify(message) + '\n';
      this.process.stdin.write(messageStr, 'utf8');
    } catch (error: any) {
      console.error('[RealtimePython] Failed to send audio data:', error);
    }
  }

  /**
   * Stop service
   */
  stop(): void {
    if (this.bufferCheckInterval) {
      clearInterval(this.bufferCheckInterval);
      this.bufferCheckInterval = null;
    }
    if (this.process && this.process.stdin) {
      try {
        const stopMessage = JSON.stringify({ type: 'stop' }) + '\n';
        this.process.stdin.write(stopMessage, 'utf8');
        setTimeout(() => {
          if (this.process) {
            this.process.kill();
          }
        }, 500);
      } catch (error) {
        if (this.process) {
          this.process.kill();
        }
      }
    }
    this.initialized = false;
  }

  /**
   * Process buffered messages
   */
  private _processBuffer(): void {
    const nodeReceiveTime = Date.now();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const message: any = JSON.parse(trimmedLine);
        message.nodeReceiveTime = nodeReceiveTime;
        this._handleMessage(message);
      } catch (error) {
        console.error('[RealtimePython] Failed to parse Python message:', trimmedLine);
      }
    }
  }

  /**
   * Check buffer size; if over limit, clean up
   */
  private _checkBufferSize(): void {
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      console.warn(`[RealtimePython] Buffer size exceeded limit (${this.buffer.length} > ${this.MAX_BUFFER_SIZE}), cleaning buffer`);
      const lastNewlineIndex = this.buffer.lastIndexOf('\n');
      if (lastNewlineIndex > 0) {
        this.buffer = this.buffer.substring(lastNewlineIndex + 1);
      } else {
        this.buffer = '';
      }
    }
  }

  /**
   * Handle messages from Python
   */
  private _handleMessage(message: TranscriptionMessage): void {
    switch (message.type) {
      case 'status':
        if (message.message?.includes('Started successfully') || message.message?.includes('Connection established')) {
          this.initialized = true;
          console.log('[RealtimePython] Python service initialized');
        }
        this.emit('status', message.message);
        break;

      case 'commit':
        console.log(`[RealtimePython] commit: speaker_id=${message.speaker_id}, text=${message.text?.substring(0, 50)}`);
        this.emit('commit', {
          speakerId: message.speaker_id !== undefined && message.speaker_id !== null ? message.speaker_id : 0,
          text: message.text || '',
        });
        break;

      case 'partial':
        this.emit('partial', {
          speakerId: message.speaker_id || 0,
          text: message.text || '',
        });
        break;

      case 'error':
        console.error('[RealtimePython] Python service error:', message.message);
        this.emit('error', message.message || 'Unknown error');
        break;

      case 'pong':
        // Heartbeat response
        break;

      case 'debug_progress':
        // Progress from Python, log occasionally
        if ((message as any).packetId % 200 === 0) {
          console.log(`[RealtimePython] Progress: packet #${(message as any).packetId}, RMS: ${(message as any).rms}`);
        }
        break;

      default:
        // Unknown message type, ignore
        break;
    }
  }
}
