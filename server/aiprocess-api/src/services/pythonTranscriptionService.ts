import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';

export interface TranscriptionMessage {
  type: 'status' | 'commit' | 'partial' | 'error' | 'pong';
  message?: string;
  speaker_id?: number;
  text?: string;
}

export interface TranscriptionConfig {
  apiKey: string;
  modelName: string;
  noiseThreshold: number;
  provider?: 'qwen' | 'echo-transcribe' | 'echo-transcribe-ga'; // 指定使用的转录服务
  // Echo Transcribe 专用参数
  commitTimeout?: number; // 断句间隔（秒）
  silenceThreshold?: number; // 静音阈值（秒）
  turnDetectionSilenceDuration?: number; // 轮换检测静音时长（毫秒）
  turnDetectionThreshold?: number; // 轮换检测阈值
}

/**
 * Python 转录服务管理器
 * 通过 stdin/stdout 与 Python 服务通信
 */
export class PythonTranscriptionService extends EventEmitter {
  private process: ChildProcess | null = null;
  private initialized: boolean = false;
  private buffer: string = '';
  private readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB 最大 buffer 大小
  private bufferCheckInterval: NodeJS.Timeout | null = null;

  constructor(private config: TranscriptionConfig) {
    super();
  }

  /**
   * 启动 Python 服务
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 根据 provider 选择不同的 Python 脚本
      let scriptName = 'realtime_transcription.py';
      if (this.config.provider === 'echo-transcribe') {
        scriptName = 'echo_transcribe.py';
      } else if (this.config.provider === 'echo-transcribe-ga') {
        scriptName = 'echo_transcribe_ga.py';
      }
      const pythonScript = path.join(__dirname, '../../python_service', scriptName);
      
      // 检测 Python 命令（Windows 可能是 python 或 py）
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      
      // 启动 Python 进程
      // 设置环境变量确保 Python 使用 UTF-8 编码
      const env = { ...process.env };
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';
      
      // 如果是 GA 版本，传递 GA endpoint 环境变量
      if (this.config.provider === 'echo-transcribe-ga') {
        // 从环境变量获取 GA endpoint，如果未设置，Python 脚本会使用默认 endpoint
        if (process.env.DASHSCOPE_GA_ENDPOINT) {
          env.DASHSCOPE_GA_ENDPOINT = process.env.DASHSCOPE_GA_ENDPOINT;
          console.log(`🌐 [GA] 传递 GA endpoint: ${process.env.DASHSCOPE_GA_ENDPOINT}`);
        } else {
          console.warn('⚠️ [GA] 未配置 DASHSCOPE_GA_ENDPOINT，将使用默认 endpoint（用于对比测试）');
        }
      }
      
      this.process = spawn(pythonCmd, [pythonScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '../../'),
        shell: process.platform === 'win32', // Windows 需要 shell
        env: env, // 传递环境变量
      });

      // 处理 stdout（Python 输出）
      // 确保使用 UTF-8 编码解码
      this.process.stdout?.setEncoding('utf8');
      this.process.stdout?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        // ✅ 修复：只在调试时打印，避免日志爆炸（Python stdout 可能很频繁）
        // console.log('📥 Python stdout:', text.substring(0, 200)); // 已注释，避免日志爆炸
        this.buffer += text;
        this._processBuffer();
        this._checkBufferSize();
      });
      
      // 启动定期检查 buffer 大小（每30秒检查一次）
      this.bufferCheckInterval = setInterval(() => {
        this._checkBufferSize();
      }, 30000);

      // 处理 stderr（Python 错误）
      // 确保使用 UTF-8 编码解码
      this.process.stderr?.setEncoding('utf8');
      this.process.stderr?.on('data', (data: string | Buffer) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        console.error('Python stderr:', text);
      });

      // 处理进程退出
      this.process.on('exit', (code) => {
        console.log(`Python 进程退出，代码: ${code}`);
        this.initialized = false;
        this.emit('close');
      });

      // 处理进程错误
      this.process.on('error', (error) => {
        console.error('Python 进程错误:', error);
        this.emit('error', error);
        reject(error);
      });

      // 等待一下确保进程启动
      setTimeout(() => {
        // 发送初始化消息
        this.sendInit();
        resolve();
      }, 500);
    });
  }

  /**
   * 发送初始化消息
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
    };
    
    // Echo Transcribe 专用参数
    if (this.config.commitTimeout !== undefined) {
      message.commit_timeout = this.config.commitTimeout;
    }
    if (this.config.silenceThreshold !== undefined) {
      message.silence_threshold = this.config.silenceThreshold;
    }
    if (this.config.turnDetectionSilenceDuration !== undefined) {
      message.turn_detection_silence_duration_ms = this.config.turnDetectionSilenceDuration;
    }
    if (this.config.turnDetectionThreshold !== undefined) {
      message.turn_detection_threshold = this.config.turnDetectionThreshold;
    }

    try {
      const messageStr = JSON.stringify(message) + '\n';
      this.process.stdin.write(messageStr, 'utf8');
      console.log('📤 已发送初始化消息到 Python 服务');
    } catch (error: any) {
      console.error('❌ 发送初始化消息失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 发送音频数据
   */
  sendAudioFrame(pcmData: Buffer, t3NodeReceive: number = 0): void {
    if (!this.process || !this.process.stdin) {
      console.warn('⚠️ Python进程或stdin未就绪，无法发送音频数据');
      return;
    }

    // 注意：不检查 initialized，因为初始化是异步的，音频数据应该在初始化完成后也能发送
    // 如果服务未初始化，Python服务会忽略这些数据

    try {
      const t3NodeSend = Date.now(); // T3: Node.js 发送给 Python 的时间
      // 将 PCM 数据编码为 base64
      const base64Data = pcmData.toString('base64');
      const message = {
        type: 'audio',
        data: base64Data,
        t3NodeSend, // 记录 Node 发送时间
        t3NodeReceive, // 记录 Node 接收时间（从 websocketService 传递）
      };

      const messageStr = JSON.stringify(message) + '\n';
      this.process.stdin.write(messageStr, 'utf8');
    } catch (error: any) {
      console.error('❌ 发送音频数据失败:', error);
    }
  }

  /**
   * 停止服务
   */
  stop(): void {
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
   * 处理缓冲区中的消息
   */
  private _processBuffer(): void {
    const nodeReceiveTime = Date.now();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // 只在调试时输出原始消息（减少日志噪音）
      // console.log(`🐍 [Python -> Node] Raw: ${trimmedLine.substring(0, 100)}`);

      try {
        const message: any = JSON.parse(trimmedLine);
        message.nodeReceiveTime = nodeReceiveTime;
        this._handleMessage(message);
      } catch (error) {
        console.error('❌ 解析 Python 消息失败 (可能包含报错):', trimmedLine);
      }
    }
  }

  /**
   * 检查 buffer 大小，如果超过限制则清理
   */
  private _checkBufferSize(): void {
    if (this.buffer.length > this.MAX_BUFFER_SIZE) {
      console.warn(`⚠️ Buffer 大小超过限制 (${this.buffer.length} > ${this.MAX_BUFFER_SIZE})，清理 buffer`);
      // 尝试保留最后一行（可能不完整）
      const lastNewlineIndex = this.buffer.lastIndexOf('\n');
      if (lastNewlineIndex > 0) {
        this.buffer = this.buffer.substring(lastNewlineIndex + 1);
      } else {
        // 如果没有换行符，清空 buffer（可能是异常情况）
        this.buffer = '';
      }
    }
  }

  /**
   * 处理来自 Python 的消息
   */
  private _handleMessage(message: TranscriptionMessage): void {
    // 简化消息日志（只在需要调试时显示）
    // console.log('📨 收到Python消息:', message.type, message);
    
    switch (message.type) {
      case 'status':
        if (message.message?.includes('启动成功') || message.message?.includes('连接建立')) {
          this.initialized = true;
          console.log('✅ Python服务已初始化');
        }
        this.emit('status', message.message);
        break;

      case 'commit':
        // ✅ 调试：打印 speaker_id 信息
        console.log(`✅ 收到commit消息: speaker_id=${message.speaker_id}, text=${message.text?.substring(0, 50)}`);
        this.emit('commit', {
          speakerId: message.speaker_id !== undefined && message.speaker_id !== null ? message.speaker_id : 0,
          text: message.text || '',
        });
        break;

      case 'partial':
        console.log('📝 收到partial消息:', message.text);
        this.emit('partial', {
          speakerId: message.speaker_id || 0,
          text: message.text || '',
        });
        break;

      case 'error':
        console.error('❌ Python服务错误:', message.message);
        this.emit('error', message.message || '未知错误');
        break;

      case 'pong':
        // 心跳响应
        break;
    }
  }
}

