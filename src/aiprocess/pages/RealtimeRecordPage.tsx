import { useState, useRef, useEffect } from 'react';
import { Card, Button, Space, Alert, Tag, Modal, Switch, Select, Form, Row, Col, Slider, InputNumber } from 'antd';
import {
  AudioOutlined,
  StopOutlined,
  SaveOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { pipeline, env } from '@xenova/transformers';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApiConfig, type ApiConfig } from '../components/ApiConfigModal';
import styles from './RealtimeRecordPage.module.css';

// 配置 Xenova Transformers 环境
// 允许使用远程模型（默认就是 true，写出来为了保险）
env.allowRemoteModels = true;
// 禁止本地加载（防止它去请求 localhost 报 404）
env.allowLocalModels = false;

// 浏览器原生语音识别 API 类型定义
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

interface TranscriptionSegment {
  text: string;
  isFinal: boolean;
  speakerId?: string;
  timestamp?: number;
}

type RealtimeApiProvider = 'qwen' | 'google-speech' | 'xenova-whisper' | 'echo-transcribe' | 'echo-transcribe-ga' | 'browser-speech';

interface TranscriptionConfig {
  apiProvider: RealtimeApiProvider; // 实时转录API提供商
  sampleRate: number;
  enableSpeakerDiarization: boolean;
  enablePunctuation: boolean;
  enableGeminiCorrection: boolean; // 是否启用 Gemini 修正（仅对 xenova-whisper 有效）
  model: string;
  format: string;
  noiseThreshold: number; // 噪音过滤阈值 (0-100)
  // Echo Transcribe 专用参数
  commitTimeout?: number; // 断句间隔（秒），无文本变化时强制提交，默认 1.2
  silenceThreshold?: number; // 静音阈值（秒），用于说话人切换检测，默认 1.5
  turnDetectionSilenceDuration?: number; // 轮换检测静音时长（毫秒），默认 800
  turnDetectionThreshold?: number; // 轮换检测阈值，默认 0.35
}

const RealtimeRecordPage: React.FC = () => {
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [audioLevel, setAudioLevel] = useState(0); // 音频音量级别 (0-100)
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0); // 录音时长（秒）
  const [finalDuration, setFinalDuration] = useState(0); // 录音结束时的最终时长（秒）
  const [showSettings, setShowSettings] = useState(false);
  
  // 转录参数配置
  const [config, setConfig] = useState<TranscriptionConfig>({
    apiProvider: 'browser-speech', // 默认使用浏览器原生语音识别
    sampleRate: 16000,
    enableSpeakerDiarization: true,
    enablePunctuation: true,
    enableGeminiCorrection: false, // 默认不启用 Gemini 修正，直接使用 Whisper 转录结果
    model: 'zh-CN', // 浏览器原生语音识别默认语言：中文
    format: 'pcm',
    noiseThreshold: 500, // 默认噪音阈值 500 (RMS值，参考代码)
    // Echo Transcribe 专用参数默认值
    commitTimeout: 1.2, // 断句间隔（秒）
    silenceThreshold: 1.5, // 静音阈值（秒）
    turnDetectionSilenceDuration: 800, // 轮换检测静音时长（毫秒）
    turnDetectionThreshold: 0.35, // 轮换检测阈值
  });

  // API配置
  const [apiConfig, setApiConfig] = useState<ApiConfig>(getApiConfig);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [savingAudio, setSavingAudio] = useState(false);
  
  // Xenova Whisper 相关 refs
  const whisperTranscriberRef = useRef<any>(null);
  const whisperProcessingRef = useRef<boolean>(false);
  
  // 浏览器原生语音识别相关 refs
  const browserSpeechRecognitionRef = useRef<SpeechRecognition | null>(null);

  // 连接 WebSocket
  const connectWebSocket = (transcriptionConfig?: TranscriptionConfig): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams();
      
      // 添加 JWT token 用于认证（兼容 Google Cloud Run）
      const token = localStorage.getItem('auth_token');
      if (token) {
        params.append('token', token);
      }
      
      if (transcriptionConfig) {
        params.append('apiProvider', transcriptionConfig.apiProvider);
        params.append('sampleRate', transcriptionConfig.sampleRate.toString());
        params.append('enableSpeakerDiarization', transcriptionConfig.enableSpeakerDiarization.toString());
        params.append('enablePunctuation', transcriptionConfig.enablePunctuation.toString());
        params.append('model', transcriptionConfig.model);
        params.append('format', transcriptionConfig.format);
        params.append('noiseThreshold', transcriptionConfig.noiseThreshold.toString());
        // Echo Transcribe 专用参数
        if (transcriptionConfig.commitTimeout !== undefined) {
          params.append('commitTimeout', transcriptionConfig.commitTimeout.toString());
        }
        if (transcriptionConfig.silenceThreshold !== undefined) {
          params.append('silenceThreshold', transcriptionConfig.silenceThreshold.toString());
        }
        if (transcriptionConfig.turnDetectionSilenceDuration !== undefined) {
          params.append('turnDetectionSilenceDuration', transcriptionConfig.turnDetectionSilenceDuration.toString());
        }
        if (transcriptionConfig.turnDetectionThreshold !== undefined) {
          params.append('turnDetectionThreshold', transcriptionConfig.turnDetectionThreshold.toString());
        }
      }
      
      // 添加对应API的密钥
      switch (transcriptionConfig?.apiProvider) {
        case 'qwen':
          if (apiConfig.qwenApiKey) {
            params.append('apiKey', apiConfig.qwenApiKey);
          }
          break;
        case 'echo-transcribe':
        case 'echo-transcribe-ga':
          // echo-transcribe 和 echo-transcribe-ga 都使用 DashScope API，与 qwen 相同
          if (apiConfig.qwenApiKey) {
            params.append('apiKey', apiConfig.qwenApiKey);
          }
          break;
        case 'google-speech':
          if (apiConfig.googleSpeechApiKey) {
            params.append('apiKey', apiConfig.googleSpeechApiKey);
          } else if (apiConfig.geminiApiKey) {
            params.append('apiKey', apiConfig.geminiApiKey);
          }
          break;
      }
      
      // WebSocket URL - 生产环境使用 wss 和当前域名，本地开发使用 localhost
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.hostname === 'localhost' ? 'localhost:8080' : window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}/ws/realtime-transcription${params.toString() ? '?' + params.toString() : ''}`;
      
      console.log('🔌 正在连接 WebSocket:', wsUrl);
      setConnectionStatus('connecting');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket连接已建立');
        setConnectionStatus('connected');
        setReconnectAttempts(0);
        resolve(ws);
      };

      ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
        setConnectionStatus('disconnected');
        setError('WebSocket连接失败，请检查后端服务是否运行');
        reject(error);
      };

      ws.onclose = (event) => {
        console.log('WebSocket连接已关闭', { code: event.code, reason: event.reason, wasClean: event.wasClean });
        // 只有在不是正常关闭时才设置为 disconnected
        if (!event.wasClean) {
          setConnectionStatus('disconnected');
        }
        if (isRecording && reconnectAttempts < 3) {
          // 自动重连
          const attempts = reconnectAttempts + 1;
          setReconnectAttempts(attempts);
          setError(`连接断开，正在重连 (${attempts}/3)...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket(config)
              .then((newWs) => {
                wsRef.current = newWs;
                setupWebSocketHandlers(newWs);
              })
              .catch(() => {
                if (attempts >= 3) {
                  setError('连接失败，请检查网络或服务器状态');
                  stopRecording();
                }
              });
          }, 2000 * attempts); // 递增延迟
        }
      };
    });
  };

  // 设置 WebSocket 消息处理（参考代码的三层漏斗策略已在Python服务中实现）
  const setupWebSocketHandlers = (ws: WebSocket) => {
    ws.onmessage = (event) => {
      const receiveTime = Date.now(); // T6: 前端接收时间
      try {
        const data = JSON.parse(event.data);
        
        // 简化原始消息日志（只在调试时需要详细输出）
        // console.log(`📥 [WS Receive] Type: ${data.type}`, data);

        if (data.type === 'init') {
          setTranscriptionId(data.transcriptionId);
          setError(null);
        } else if (data.type === 'status') {
          // 状态消息 - ✅ 只打印消息文本，不打印整个对象
          if (data.message) {
            console.log('📢 状态:', data.message);
          }
        } else if (data.type === 'debug_progress') {
          // 接收来自 Python 的确认消息
          // ✅ 修复：降低日志频率，每 100 包打印一次（避免日志爆炸）
          if (data.packetId % 100 === 0) {
            console.log(`📡 [Python Progress] 包序号: ${data.packetId}, 音量(RMS): ${data.rms}`);
          }
        } else if (data.type === 'transcription') {
          // 详细延迟分析 - 每一步的时间戳
          const t1Capture = data.t1Capture || 0; // 前端采集时间
          const t2Send = data.t2Send || 0; // 前端发送时间
          const t3NodeReceive = data.t3NodeReceive || 0; // Node接收时间
          const t3PythonReceive = data.t3PythonReceive || 0; // Python接收时间
          const t4SdkCallback = data.t4SdkCallback || 0; // SDK回调时间
          const t4PythonSend = data.serverTime || 0; // Python发送时间
          const t5NodeReceive = data.nodeReceiveTime || 0; // Node接收Python输出时间
          const t5NodeSend = data.t5NodeSend || 0; // Node发送给前端时间
          const t6Receive = Date.now(); // 前端接收时间
          
          // 计算各段延迟
          const latencies: any = {};
          if (t1Capture && t2Send) latencies.t1ToT2 = t2Send - t1Capture; // 前端采集到发送
          if (t2Send && t3NodeReceive) latencies.t2ToT3 = t3NodeReceive - t2Send; // 网络传输(前端->Node)
          if (t3NodeReceive && t3PythonReceive) latencies.t3NodeToPython = t3PythonReceive - t3NodeReceive; // Node处理+转发
          if (t3PythonReceive && t4SdkCallback) latencies.t3ToT4Sdk = t4SdkCallback - t3PythonReceive; // Python发送到SDK回调
          if (t4SdkCallback && t4PythonSend) latencies.t4SdkToSend = t4PythonSend - t4SdkCallback; // SDK回调到Python发送
          if (t4PythonSend && t5NodeReceive) latencies.t4ToT5 = t5NodeReceive - t4PythonSend; // Python到Node
          if (t5NodeReceive && t5NodeSend) latencies.t5NodeProcess = t5NodeSend - t5NodeReceive; // Node处理
          if (t5NodeSend && t6Receive) latencies.t5ToT6 = t6Receive - t5NodeSend; // 网络传输(Node->前端)
          if (t1Capture && t6Receive) latencies.totalEndToEnd = t6Receive - t1Capture; // 端到端总延迟

          // 改进的日志输出格式 - 更清晰易读
          // ✅ 修复：只对最终结果或10%的partial打印（避免日志爆炸）
          const shouldLog = data.isFinal || (Math.random() < 0.1); // 10% 概率打印 partial
          
          if (shouldLog) {
            const now = Date.now();
            const timeStr = new Date(now).toISOString().split('T')[1].replace('Z', '');
            const textPreview = data.text.substring(0, 40) + (data.text.length > 40 ? '...' : '');
            
            // 主标题
            console.log(`\n${data.isFinal ? '✅' : '📝'} [${timeStr}] ${data.isFinal ? 'FINAL' : 'PARTIAL'}: "${textPreview}"`);
            
            // 延迟摘要（如果有关键时间戳）
            const delayParts: string[] = [];
            if (latencies.t3ToT4Sdk) delayParts.push(`SDK识别: ${latencies.t3ToT4Sdk}ms`);
            if (latencies.t4ToT5) delayParts.push(`Python→Node: ${latencies.t4ToT5}ms`);
            if (latencies.t5ToT6) delayParts.push(`Node→前端: ${latencies.t5ToT6}ms`);
            if (latencies.totalEndToEnd) delayParts.push(`总延迟: ${latencies.totalEndToEnd}ms`);
            
            if (delayParts.length > 0) {
              console.log(`   ⚡ ${delayParts.join(' | ')}`);
            }
            
            // 详细时间轴（只在有足够信息时显示）
            const hasEnoughInfo = t1Capture || t3NodeReceive || t4SdkCallback || t5NodeReceive;
            if (hasEnoughInfo) {
              console.log(`   📍 时间轴:`);
              
              if (t1Capture) {
                const t1Str = new Date(t1Capture).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T1[前端采集]  ${t1Str}${latencies.t1ToT2 ? ` → +${latencies.t1ToT2}ms` : ''}`);
              } else {
                console.log(`      T1[前端采集]  ❌ 缺失`);
              }
              
              if (t2Send) {
                const t2Str = new Date(t2Send).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T2[前端发送]  ${t2Str}${latencies.t2ToT3 ? ` → +${latencies.t2ToT3}ms` : ''}`);
              }
              
              if (t3NodeReceive) {
                const t3Str = new Date(t3NodeReceive).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T3[Node接收]  ${t3Str}${latencies.t3NodeToPython ? ` → +${latencies.t3NodeToPython}ms` : ''}`);
              } else {
                console.log(`      T3[Node接收]  ❌ 缺失`);
              }
              
              if (t3PythonReceive) {
                const t3pStr = new Date(t3PythonReceive).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T3[Python接收] ${t3pStr}${latencies.t3ToT4Sdk ? ` → +${latencies.t3ToT4Sdk}ms ⚠️` : ''}`);
              }
              
              if (t4SdkCallback) {
                const t4Str = new Date(t4SdkCallback).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T4[SDK回调]   ${t4Str}${latencies.t4SdkToSend ? ` → +${latencies.t4SdkToSend}ms` : ''}`);
              } else if (t3PythonReceive) {
                console.log(`      T4[SDK回调]   ❌ 缺失 (可能SDK未回调)`);
              }
              
              if (t4PythonSend) {
                const t4pStr = new Date(t4PythonSend).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T4[Python发送] ${t4pStr}${latencies.t4ToT5 ? ` → +${latencies.t4ToT5}ms` : ''}`);
              }
              
              if (t5NodeReceive) {
                const t5rStr = new Date(t5NodeReceive).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T5[Node接收]  ${t5rStr}${latencies.t5NodeProcess ? ` → +${latencies.t5NodeProcess}ms` : ''}`);
              }
              
              if (t5NodeSend) {
                const t5sStr = new Date(t5NodeSend).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T5[Node发送]  ${t5sStr}${latencies.t5ToT6 ? ` → +${latencies.t5ToT6}ms` : ''}`);
              }
              
              if (t6Receive) {
                const t6Str = new Date(t6Receive).toISOString().split('T')[1].replace('Z', '');
                console.log(`      T6[前端接收]  ${t6Str}`);
              }
            } else {
              console.log(`   ⚠️  时间戳信息不完整，无法进行详细延迟分析`);
            }
          }

          if (data.isFinal) {
            // ✅ 调试：打印接收到的数据
            console.log(`📥 前端收到: speakerId=${data.speakerId}, text=${data.text.substring(0, 50)}`);
            
            // 最终文本（commit）
            // ✅ 修复内存泄漏：只保留最近 100 条，避免无限增长
            setSegments((prev) => {
              const newSegments = [
                ...prev,
                {
                  text: data.text,
                  isFinal: true,
                  speakerId: data.speakerId, // 保留原始的 speakerId（可能是字符串或数字）
                  timestamp: receiveTime,
                },
              ];
              // 如果超过 100 条，只保留最后 100 条
              if (newSegments.length > 100) {
                return newSegments.slice(newSegments.length - 100);
              }
              return newSegments;
            });
            setPartialText('');
          } else {
            // 临时文本（partial）
            setPartialText(data.text);
          }
        } else if (data.type === 'ready') {
          // Python服务已就绪
          console.log('转录服务已就绪');
        } else if (data.type === 'error') {
          setError(data.error);
          if (data.error.includes('连接') || data.error.includes('失败') || data.error.includes('错误')) {
          stopRecording();
        }
        }
      } catch (err) {
        console.error('解析WebSocket消息错误:', err);
      }
    };
  };

  // 使用 Gemini 修正转录文本
  const correctWithGemini = async (text: string): Promise<string> => {
    if (!apiConfig.geminiApiKey || !text.trim()) {
      return text;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiConfig.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

      const prompt = `请修正以下语音转录文本，保持原意不变，只修正可能的错误（如错别字、标点符号、语法错误等）。如果文本已经是正确的，请直接返回原文。

转录文本：
${text}

修正后的文本：`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const correctedText = response.text().trim();

      return correctedText || text;
    } catch (error: any) {
      console.error('Gemini 修正失败:', error);
      return text; // 如果修正失败，返回原文
    }
  };

  // 使用 Xenova Whisper 进行实时转录
  const startXenovaWhisperTranscription = async (stream: MediaStream, audioContext: AudioContext) => {
    try {
      whisperProcessingRef.current = true;
      
      // 初始化 Whisper 模型
      if (!whisperTranscriberRef.current) {
        console.log('正在加载 Xenova Whisper 模型...');
        console.log('环境配置:', {
          allowRemoteModels: env.allowRemoteModels,
          allowLocalModels: env.allowLocalModels,
          remotePathTemplate: env.remotePathTemplate,
          remoteHost: env.remoteHost,
        });
        setError('正在加载 Whisper 模型，首次加载可能需要几分钟，请耐心等待...');
        try {
          // 使用量化模型（必须加这个，否则会去下原版大模型）
          // 尝试使用 whisper-tiny 或 whisper-small，它们更小更容易加载
          // 注意：如果模型不存在，会尝试其他模型
          const modelName = 'Xenova/whisper-tiny';  // 先尝试 tiny 模型，更小更快
          console.log(`尝试加载模型: ${modelName}`);
          
          whisperTranscriberRef.current = await pipeline(
            'automatic-speech-recognition',
            modelName,
            {
              quantized: true, // 必须加这个，使用量化模型以加快加载速度
              progress_callback: (progress: any) => {
                console.log('模型加载进度:', progress);
                if (progress?.status === 'downloading' && progress?.file) {
                  const percent = progress.progress ? Math.round(progress.progress * 100) : 0;
                  const loadedMB = (progress.loaded / 1024 / 1024).toFixed(2);
                  console.log(`模型下载进度 [${progress.file}]: ${percent}% (${loadedMB}MB)`);
                  
                  // 如果文件太小（< 1KB），可能是 HTML 错误页面
                  if (progress.loaded < 1024 && progress.file.endsWith('.json')) {
                    console.warn(`警告：${progress.file} 文件太小 (${progress.loaded} bytes)，可能是 HTML 错误页面！`);
                  }
                } else if (progress?.status === 'loading') {
                  console.log('模型加载中...', progress);
                } else if (progress?.status === 'error') {
                  console.error('模型加载错误:', progress);
                }
              },
            }
          );
          console.log('Xenova Whisper 模型加载完成');
          setError(null); // 清除加载提示
        } catch (modelError: any) {
          console.error('加载 Whisper 模型失败:', modelError);
          console.error('错误堆栈:', modelError.stack);
          console.error('请打开浏览器 Network 面板，查看实际请求的 URL 和响应内容');
          
          const errorMessage = modelError.message || String(modelError) || '未知错误';
          
          // 提供更详细的错误信息和解决方案
          let userMessage = '加载 Whisper 模型失败\n\n';
          if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed to fetch')) {
            userMessage += '网络连接失败。\n请：\n1. 打开浏览器 Network 面板\n2. 查看实际请求的 URL\n3. 检查是否能够访问 Hugging Face\n4. 如果在新加坡，网络应该没问题，可能是模型不存在';
          } else if (errorMessage.includes('JSON') || errorMessage.includes('<!doctype') || errorMessage.includes('Unexpected token')) {
            userMessage += '模型文件加载失败，返回了 HTML 而不是 JSON。\n\n可能原因：\n1. 模型名称不正确或模型不存在\n2. 请求的 URL 路径错误\n3. 网络请求被重定向到错误页面\n\n建议：\n1. 打开浏览器 Network 面板\n2. 查看实际请求的 URL（应该是 huggingface.co 的 URL）\n3. 查看响应的 HTML 内容，确认错误原因\n4. 尝试清除浏览器缓存后重试';
          } else if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin')) {
            userMessage += '跨域请求失败。可能需要配置代理或使用其他方式加载模型。';
          } else {
            userMessage += `错误详情: ${errorMessage.substring(0, 300)}`;
          }
          
          setError(userMessage);
          whisperProcessingRef.current = false;
          return;
        }
      }

      // Whisper 模型需要 16kHz 采样率的音频
      const TARGET_SAMPLE_RATE = 16000;
      const actualSampleRate = audioContext.sampleRate;
      console.log(`音频上下文采样率: ${actualSampleRate}Hz，目标采样率: ${TARGET_SAMPLE_RATE}Hz`);
      
      // 创建重采样器（如果需要）
      let needsResampling = actualSampleRate !== TARGET_SAMPLE_RATE;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(processor);
      processor.connect(audioContext.destination);

      const audioBuffer: Float32Array[] = [];
      let lastTranscriptionTime = Date.now();
      const transcriptionInterval = 2000; // ✅ 修复：减少到2秒，提高响应速度
      let isTranscribing = false; // 并发控制标志，确保同时只有一个转录任务
      let transcriptionErrorCount = 0; // ✅ 新增：错误计数，避免无限重试

      // 限制音频缓冲区大小：最多保留5秒的音频（基于实际采样率）
      const maxBufferDurationSeconds = 5;
      const maxBufferSamples = actualSampleRate * maxBufferDurationSeconds;
      
      // 每次转录最多处理3秒的音频（避免处理时间过长）
      const maxTranscriptionDurationSeconds = 3;
      const maxTranscriptionSamples = TARGET_SAMPLE_RATE * maxTranscriptionDurationSeconds;

      // 重采样函数：将音频从任意采样率转换为 16kHz
      const resampleAudio = (input: Float32Array, fromRate: number, toRate: number): Float32Array => {
        if (fromRate === toRate) return input;
        
        const ratio = fromRate / toRate;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Float32Array(outputLength) as Float32Array;
        
        for (let i = 0; i < outputLength; i++) {
          const index = i * ratio;
          const indexFloor = Math.floor(index);
          const indexCeil = Math.min(indexFloor + 1, input.length - 1);
          const fraction = index - indexFloor;
          
          // 线性插值
          output[i] = input[indexFloor] * (1 - fraction) + input[indexCeil] * fraction;
        }
        
        return output;
      };

      // 限制音频缓冲区大小，避免无限增长
      const trimAudioBuffer = () => {
        let totalLength = 0;
        let startIndex = 0;
        
        // 从后往前计算，保留最近的数据
        for (let i = audioBuffer.length - 1; i >= 0; i--) {
          totalLength += audioBuffer[i].length;
          if (totalLength > maxBufferSamples) {
            startIndex = i + 1;
            break;
          }
        }
        
        // 移除旧的音频数据
        if (startIndex > 0) {
          audioBuffer.splice(0, startIndex);
          console.log(`音频缓冲区已修剪，移除了 ${startIndex} 个旧音频块`);
        }
      };

      processor.onaudioprocess = async (e) => {
        if (!whisperProcessingRef.current) {
          console.warn('⚠️ Whisper 模型未加载，停止音频处理');
          processor.disconnect();
          return;
        }

        if (!whisperProcessingRef.current) {
          console.warn('⚠️ whisperTranscriberRef.current 为 null，跳过处理');
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // ✅ 修复：检查音频数据是否有效
        if (!inputData || inputData.length === 0) {
          return;
        }
        
        audioBuffer.push(new Float32Array(inputData));

        // 定期修剪音频缓冲区，避免无限增长
        if (audioBuffer.length > 10) {
          trimAudioBuffer();
        }

        const now = Date.now();
        // ✅ 修复：增加错误检查，如果连续失败太多次，停止转录
        if (transcriptionErrorCount > 5) {
          console.error('❌ Whisper 转录连续失败超过5次，停止转录');
          setError('Whisper 转录连续失败，请检查模型是否正确加载');
          whisperProcessingRef.current = false;
          processor.disconnect();
          return;
        }
        
        // 只有在没有转录任务正在进行时，才启动新的转录任务
        if (!isTranscribing && now - lastTranscriptionTime >= transcriptionInterval && audioBuffer.length > 0) {
          // 合并音频缓冲区
          const totalLength = audioBuffer.reduce((sum, arr) => sum + arr.length, 0);
          
          // 计算所需的最小采样点数（至少1秒的音频，基于实际采样率）
          const minSamplesForOneSecond = actualSampleRate;
          if (totalLength < minSamplesForOneSecond) {
            if (transcriptionErrorCount < 3) {
              console.log(`⏸️ 音频太短 (${totalLength} < ${minSamplesForOneSecond})，等待更多音频数据`);
            }
            return; // 音频太短，不转录
          }

          // ✅ 调试：检查音频数据是否有效（是否有声音）
          // 先合并一小部分音频来检查
          const checkSamples = Math.min(4096, totalLength);
          const checkAudio = new Float32Array(checkSamples);
          let checkOffset = checkSamples;
          for (let i = audioBuffer.length - 1; i >= 0 && checkOffset > 0; i--) {
            const chunk = audioBuffer[i];
            const takeFromChunk = Math.min(checkOffset, chunk.length);
            checkAudio.set(chunk.slice(chunk.length - takeFromChunk), checkOffset - takeFromChunk);
            checkOffset -= takeFromChunk;
          }
          
          const maxAmplitude = Math.max(...Array.from(checkAudio).map(Math.abs));
          const avgAmplitude = Array.from(checkAudio).reduce((sum, val) => sum + Math.abs(val), 0) / checkAudio.length;
          
          if (transcriptionErrorCount < 3) {
            console.log(`🔊 音频数据检查: 最大振幅=${maxAmplitude.toFixed(4)}, 平均振幅=${avgAmplitude.toFixed(4)}`);
          }
          
          // 如果音频太安静（可能是静音），跳过转录
          if (maxAmplitude < 0.001) {
            if (transcriptionErrorCount < 3) {
              console.warn('⚠️ 音频太安静（可能是静音），跳过转录');
            }
            lastTranscriptionTime = now; // 更新时间，避免频繁检查
            return;
          }

          // 限制转录的音频长度，只取最近3秒的音频
          let samplesToTake = Math.min(totalLength, maxTranscriptionSamples);
          if (needsResampling) {
            // 如果需要重采样，先计算重采样后的长度
            const ratio = actualSampleRate / TARGET_SAMPLE_RATE;
            samplesToTake = Math.min(totalLength, Math.floor(maxTranscriptionSamples * ratio));
          }

          // 从音频缓冲区末尾提取所需的音频数据
          const mergedAudio = new Float32Array(samplesToTake);
          let offset = samplesToTake;
          for (let i = audioBuffer.length - 1; i >= 0 && offset > 0; i--) {
            const chunk = audioBuffer[i];
            const takeFromChunk = Math.min(offset, chunk.length);
            mergedAudio.set(chunk.slice(chunk.length - takeFromChunk), offset - takeFromChunk);
            offset -= takeFromChunk;
          }

          // 移除已处理的音频数据（保留未处理的部分）
          const processedSamples = totalLength - offset;
          let remainingSamples = offset;
          for (let i = audioBuffer.length - 1; i >= 0 && remainingSamples > 0; i--) {
            const chunk = audioBuffer[i];
            if (remainingSamples >= chunk.length) {
              remainingSamples -= chunk.length;
              audioBuffer.splice(i, 1);
            } else {
              // 部分保留
              audioBuffer[i] = chunk.slice(0, chunk.length - remainingSamples);
              remainingSamples = 0;
            }
          }

          lastTranscriptionTime = now;
          isTranscribing = true; // 标记转录任务开始

          // 异步转录音频，避免阻塞
          (async () => {
            try {
              if (!whisperTranscriberRef.current) {
                console.warn('⚠️ 转录时发现 whisperTranscriberRef.current 为 null');
                isTranscribing = false;
                transcriptionErrorCount++;
                return;
              }
              
              // 将音频重采样到 16kHz（如果需要）
              let audioForTranscription: Float32Array = mergedAudio;
              if (needsResampling) {
                console.log(`🔄 重采样音频: ${actualSampleRate}Hz -> ${TARGET_SAMPLE_RATE}Hz`);
                audioForTranscription = resampleAudio(mergedAudio, actualSampleRate, TARGET_SAMPLE_RATE) as Float32Array;
                // 确保不超过最大长度
                if (audioForTranscription.length > maxTranscriptionSamples) {
                  audioForTranscription = audioForTranscription.slice(-maxTranscriptionSamples) as Float32Array;
                }
              } else {
                // 确保不超过最大长度
                if (audioForTranscription.length > maxTranscriptionSamples) {
                  audioForTranscription = audioForTranscription.slice(-maxTranscriptionSamples) as Float32Array;
                }
              }
              
              const audioDuration = (audioForTranscription.length / TARGET_SAMPLE_RATE).toFixed(2);
              console.log(`🎤 开始转录音频: ${audioForTranscription.length} 采样点（约 ${audioDuration}秒），采样率: ${TARGET_SAMPLE_RATE}Hz`);
              
              // ✅ 修复：添加超时控制，避免转录任务卡死
              const transcriptionPromise = whisperTranscriberRef.current(audioForTranscription, {
                return_timestamps: false,
                task: 'transcribe', // 明确指定为转录任务，而不是翻译任务
                chunk_length_s: Math.min(3, Math.ceil(audioForTranscription.length / TARGET_SAMPLE_RATE)), // 根据实际音频长度设置
              });
              
              // 设置10秒超时
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('转录超时（10秒）')), 10000);
              });
              
              const result = await Promise.race([transcriptionPromise, timeoutPromise]);

              // ✅ 调试：打印完整的 result 结构（前几次）
              if (transcriptionErrorCount < 3) {
                console.log('🔍 Whisper 转录结果结构:', {
                  hasResult: !!result,
                  resultType: typeof result,
                  resultKeys: result ? Object.keys(result) : [],
                  resultText: result?.text,
                  resultFull: result,
                });
              }

              // ✅ 修复：检查 result 的结构，可能 text 在不同位置
              let rawText = '';
              if (result) {
                if (result.text) {
                  rawText = result.text.trim();
                } else if (typeof result === 'string') {
                  rawText = result.trim();
                } else if (result.chunks && result.chunks.length > 0) {
                  // 某些模型返回 chunks 数组
                  rawText = result.chunks.map((chunk: any) => chunk.text || chunk).join(' ').trim();
                } else {
                  // 尝试从其他可能的字段获取
                  rawText = (result.transcription || result.output || JSON.stringify(result)).trim();
                }
              }

              if (rawText && rawText.length > 0) {
                console.log(`✅ 转录成功: "${rawText}"`);
                transcriptionErrorCount = 0; // ✅ 重置错误计数
                
                // 过滤掉明显错误的重复结果（如连续重复的字符）
                // 简单的重复检测：如果文本中某个字符连续出现超过10次，可能是错误结果
                let isValid = true;
                for (let i = 0; i < rawText.length - 10; i++) {
                  const char = rawText[i];
                  let repeatCount = 1;
                  for (let j = i + 1; j < rawText.length && rawText[j] === char; j++) {
                    repeatCount++;
                  }
                  if (repeatCount > 10) {
                    isValid = false;
                    console.warn(`检测到重复字符 "${char}" 连续出现 ${repeatCount} 次，跳过此次转录结果`);
                    break;
                  }
                }
                
                if (isValid) {
                  // 先添加为部分文本
                  setPartialText(rawText);
                  
                  // 根据配置决定是否进行 Gemini 修正
                  if (config.enableGeminiCorrection && rawText.length > 5 && apiConfig.geminiApiKey) {
                    try {
                      const correctedText = await correctWithGemini(rawText);
                      console.log(`Gemini 修正后: "${correctedText}"`);
                      
                      // 添加为最终片段
                      // ✅ 修复内存泄漏：只保留最近 100 条
                      setSegments(prev => {
                        const newSegments = [...prev, {
                          text: correctedText,
                          isFinal: true,
                          timestamp: Date.now(),
                        }];
                        return newSegments.length > 100 ? newSegments.slice(newSegments.length - 100) : newSegments;
                      });
                    } catch (geminiError: any) {
                      console.error('Gemini 修正失败，使用原始文本:', geminiError);
                      // Gemini 修正失败，使用原始文本
                      // ✅ 修复内存泄漏：只保留最近 100 条
                      setSegments(prev => {
                        const newSegments = [...prev, {
                          text: rawText,
                          isFinal: true,
                          timestamp: Date.now(),
                        }];
                        return newSegments.length > 100 ? newSegments.slice(newSegments.length - 100) : newSegments;
                      });
                    }
                  } else {
                    // 不启用 Gemini 修正，直接使用 Whisper 转录结果
                    // ✅ 修复内存泄漏：只保留最近 100 条
                    setSegments(prev => {
                      const newSegments = [...prev, {
                        text: rawText,
                        isFinal: true,
                        timestamp: Date.now(),
                      }];
                      return newSegments.length > 100 ? newSegments.slice(newSegments.length - 100) : newSegments;
                    });
                  }
                }
              } else {
                console.warn('⚠️ Whisper 转录结果为空', {
                  hasResult: !!result,
                  resultType: typeof result,
                  resultValue: result,
                  audioLength: audioForTranscription.length,
                  audioDuration: (audioForTranscription.length / TARGET_SAMPLE_RATE).toFixed(2) + 's',
                });
                transcriptionErrorCount++;
              }
            } catch (error: any) {
              transcriptionErrorCount++;
              console.error('❌ Whisper 转录错误:', error);
              console.error('错误详情:', {
                message: error.message,
                name: error.name,
                audioLength: mergedAudio.length,
                sampleRate: actualSampleRate,
                targetSampleRate: TARGET_SAMPLE_RATE,
                errorCount: transcriptionErrorCount,
              });
              
              // ✅ 修复：如果错误次数过多，显示错误提示
              if (transcriptionErrorCount > 3) {
                setError(`Whisper 转录连续失败 ${transcriptionErrorCount} 次: ${error.message || '未知错误'}`);
              }
            } finally {
              isTranscribing = false; // 标记转录任务完成
            }
          })();
        }
      };
    } catch (error: any) {
      console.error('初始化 Xenova Whisper 失败:', error);
      setError('初始化 Whisper 失败: ' + (error.message || '未知错误'));
      whisperProcessingRef.current = false;
    }
  };

  // 开始录音
  const startRecording = async () => {
    try {
      setError(null);
      setConnectionStatus('connecting');
      setReconnectAttempts(0);
      setRecordingDuration(0);

      // 请求麦克风权限（使用配置的采样率）
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: config.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // 如果是 xenova-whisper，使用本地转录
      if (config.apiProvider === 'xenova-whisper') {
        // 创建 MediaRecorder 用于保存音频文件
        audioChunksRef.current = [];
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            // ✅ 修复内存泄漏：只保留最近 10 分钟的音频数据（600 个块，每秒1个）
            // 如果超过限制，移除最旧的数据
            const MAX_AUDIO_CHUNKS = 600; // 10 分钟 * 60 秒
            if (audioChunksRef.current.length > MAX_AUDIO_CHUNKS) {
              const removed = audioChunksRef.current.splice(0, audioChunksRef.current.length - MAX_AUDIO_CHUNKS);
              console.log(`清理旧音频数据: 移除了 ${removed.length} 个音频块`);
            }
          }
        };

        mediaRecorder.start(1000);

        // 创建 AnalyserNode 用于音频可视化
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: config.sampleRate,
        });
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);

        // 使用 Xenova Whisper 进行本地转录
        await startXenovaWhisperTranscription(stream, audioContext);

        setIsRecording(true);
        setConnectionStatus('connected');

        // 开始计时
        durationIntervalRef.current = setInterval(() => {
          setRecordingDuration((prev) => prev + 1);
        }, 1000);

        return;
      }

      // 如果是 browser-speech，使用浏览器原生语音识别
      if (config.apiProvider === 'browser-speech') {
        // 检测是否是移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // 检查浏览器是否支持 Web Speech API
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
          if (isMobile) {
            setError('移动设备不支持浏览器原生语音识别。iOS Safari 完全不支持，Android Chrome 支持有限。建议使用其他转录方式（如 Echo Transcribe 或 Qwen）。');
          } else {
            setError('您的浏览器不支持语音识别功能。请使用 Chrome、Edge 或 Safari 浏览器。');
          }
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        // 移动设备警告（但不阻止，因为 Android Chrome 可能支持）
        if (isMobile) {
          const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
          if (isIOS) {
            setError('⚠️ iOS 设备不支持浏览器原生语音识别。请使用其他转录方式（如 Echo Transcribe 或 Qwen）。');
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          // Android 设备可能支持，但显示警告
          console.warn('⚠️ 移动设备上的浏览器语音识别可能不稳定，建议使用 Wi-Fi 连接。');
        }

        // 创建 MediaRecorder 用于保存音频文件
        audioChunksRef.current = [];
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            const MAX_AUDIO_CHUNKS = 600;
            if (audioChunksRef.current.length > MAX_AUDIO_CHUNKS) {
              const removed = audioChunksRef.current.splice(0, audioChunksRef.current.length - MAX_AUDIO_CHUNKS);
              console.log(`清理旧音频数据: 移除了 ${removed.length} 个音频块`);
            }
          }
        };

        mediaRecorder.start(1000);

        // 创建 AnalyserNode 用于音频可视化
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: config.sampleRate,
        });
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);

        // 初始化浏览器原生语音识别
        const recognition = new SpeechRecognition();
        recognition.continuous = true; // 持续识别
        recognition.interimResults = true; // 返回中间结果
        recognition.lang = config.model || 'zh-CN'; // 使用 model 字段作为语言代码，默认中文

        // 处理识别结果
        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          // 显示中间结果
          if (interimTranscript) {
            setPartialText(interimTranscript);
          }

          // 处理最终结果
          if (finalTranscript) {
            const finalText = finalTranscript.trim();
            console.log('✅ 浏览器语音识别结果:', finalText);
            
            // ✅ 修复内存泄漏：只保留最近 100 条
            setSegments(prev => {
              const newSegments = [...prev, {
                text: finalText,
                isFinal: true,
                timestamp: Date.now(),
              }];
              return newSegments.length > 100 ? newSegments.slice(newSegments.length - 100) : newSegments;
            });
            
            setPartialText(''); // 清空中间结果
          }
        };

        // 处理错误
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          console.error('❌ 浏览器语音识别错误:', event.error, event.message);
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          
          if (event.error === 'no-speech') {
            // 无语音输入，不显示错误
            return;
          } else if (event.error === 'audio-capture') {
            setError('无法捕获音频，请检查麦克风权限。移动设备请确保已授予麦克风权限。');
          } else if (event.error === 'not-allowed') {
            if (isMobile) {
              setError('麦克风权限被拒绝。请在手机浏览器设置中允许麦克风访问，或使用其他转录方式。');
            } else {
              setError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
            }
          } else if (event.error === 'network') {
            if (isMobile) {
              setError('网络连接错误。移动设备建议使用 Wi-Fi 连接，或使用其他转录方式。');
            } else {
              setError('网络连接错误，请检查网络连接');
            }
          } else if (event.error === 'service-not-allowed') {
            if (isMobile) {
              setError('您的设备或浏览器不支持语音识别服务。iOS 设备不支持，Android 设备可能受限。建议使用其他转录方式（如 Echo Transcribe 或 Qwen）。');
            } else {
              setError('语音识别服务不可用，请检查浏览器设置');
            }
          } else if (event.error === 'aborted') {
            // 识别被中止，可能是用户操作或系统限制，不显示错误
            console.log('语音识别被中止');
            return;
          } else {
            const errorMsg = `语音识别错误: ${event.error}`;
            if (isMobile) {
              setError(`${errorMsg}。移动设备上的浏览器语音识别可能不稳定，建议使用其他转录方式。`);
            } else {
              setError(errorMsg);
            }
          }
        };

        // 处理识别结束
        recognition.onend = () => {
          console.log('浏览器语音识别已结束');
          // 如果还在录音且 recognition 引用还存在，自动重新启动识别
          if (browserSpeechRecognitionRef.current) {
            try {
              browserSpeechRecognitionRef.current.start();
            } catch (e) {
              console.log('重新启动识别失败，可能需要等待:', e);
              // 等待一小段时间后重试
              setTimeout(() => {
                if (browserSpeechRecognitionRef.current) {
                  try {
                    browserSpeechRecognitionRef.current.start();
                  } catch (err) {
                    console.error('重试启动识别失败:', err);
                  }
                }
              }, 100);
            }
          }
        };

        // 保存引用
        browserSpeechRecognitionRef.current = recognition;

        // 开始识别
        try {
          recognition.start();
          console.log('✅ 浏览器语音识别已启动');
        } catch (error: any) {
          console.error('启动浏览器语音识别失败:', error);
          setError('启动语音识别失败: ' + (error.message || '未知错误'));
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        // ✅ 修复：为浏览器语音识别创建转录记录
        try {
          const token = localStorage.getItem('auth_token');
          const baseUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:8080/api' 
            : '/api';
          
          const response = await fetch(`${baseUrl}/transcriptions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              title: `浏览器语音识别 - ${new Date().toLocaleString()}`,
              aiProvider: 'browser-speech',
              language: config.model || 'zh-CN',
            }),
          });

          if (response.ok) {
            const data = await response.json();
            setTranscriptionId(data.id);
            console.log('✅ 浏览器语音识别转录记录已创建:', data.id);
          } else {
            console.warn('创建转录记录失败，但继续录音');
          }
        } catch (err) {
          console.warn('创建转录记录时出错，但继续录音:', err);
        }

        setIsRecording(true);
        setConnectionStatus('connected');

        // 开始计时
        durationIntervalRef.current = setInterval(() => {
          setRecordingDuration((prev) => prev + 1);
        }, 1000);

        return;
      }

      // 创建 MediaRecorder 用于保存音频文件
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // ✅ 修复内存泄漏：只保留最近 10 分钟的音频数据（600 个块，每秒1个）
          // 如果超过限制，移除最旧的数据
          const MAX_AUDIO_CHUNKS = 600; // 10 分钟 * 60 秒
          if (audioChunksRef.current.length > MAX_AUDIO_CHUNKS) {
            const removed = audioChunksRef.current.splice(0, audioChunksRef.current.length - MAX_AUDIO_CHUNKS);
            console.log(`清理旧音频数据: 移除了 ${removed.length} 个音频块`);
          }
        }
      };

      mediaRecorder.start(1000); // 每秒收集一次数据

      // 创建 WebSocket 连接（传递配置参数）
      const ws = await connectWebSocket(config);
      wsRef.current = ws;
      setupWebSocketHandlers(ws);

      // 创建 AudioContext（使用配置的采样率）
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: config.sampleRate,
      });
      audioContextRef.current = audioContext;

      // 加载 AudioWorklet
      try {
        await audioContext.audioWorklet.addModule('/audio-processor.js');
        
        // 创建 AudioWorkletNode，使用 correct name 'recorder-worklet'
        const workletNode = new AudioWorkletNode(audioContext, 'recorder-worklet', {
          processorOptions: {
            noiseThreshold: config.noiseThreshold, // 直接使用RMS值
          },
        });
        audioWorkletNodeRef.current = workletNode;

        // 处理来自 AudioWorklet 的音频数据
        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && ws.readyState === WebSocket.OPEN) {
            const t1Capture = event.data.t1Capture || event.data.timestamp; // T1: 前端采集时间
            const t2Send = Date.now(); // T2: 前端发送时间
            const packetId = event.data.packetId;
            
            // ✅ 修复：降低日志频率，每 100 包输出一次（避免日志爆炸）
            if (packetId % 100 === 0) {
              const t1ToT2 = t2Send - t1Capture;
              const timeStr = new Date(t2Send).toISOString().split('T')[1].replace('Z', '');
              console.log(`📤 [${timeStr}] 发送音频包 #${packetId} (采集→发送: ${t1ToT2}ms)`);
            }
            ws.send(event.data.data);
          }
        };

        // 创建音频源
      const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);

        // 创建 AnalyserNode 用于音频可视化
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);

        // 开始监控音频级别
        startAudioLevelMonitoring(analyser);

        setIsRecording(true);

        // 开始计时
        durationIntervalRef.current = setInterval(() => {
          setRecordingDuration((prev) => prev + 1);
        }, 1000);
      } catch (workletError: any) {
        console.warn('AudioWorklet 不支持，回退到 ScriptProcessorNode:', workletError);
        // 回退到 ScriptProcessorNode
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const source = audioContext.createMediaStreamSource(stream);

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
              const sample = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = sample < 0 
                ? sample * 0x8000 
                : sample * 0x7FFF;
          }
          ws.send(pcmData.buffer);
        }
      };

        // 创建 AnalyserNode 用于音频可视化
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);

        setIsRecording(true);

        // 开始计时
        durationIntervalRef.current = setInterval(() => {
          setRecordingDuration((prev) => prev + 1);
        }, 1000);
      }
    } catch (err: any) {
      console.error('启动录音失败:', err);
      setError(err.message || '无法访问麦克风，请检查权限设置');
      setConnectionStatus('disconnected');
      
      // 如果 WebSocket 连接失败，给出更明确的错误提示
      if (err.message && err.message.includes('WebSocket')) {
        setError('WebSocket 连接失败，请确保后端服务已启动（端口 8080）');
      }
    }
  };

  // 监控音频级别
  const startAudioLevelMonitoring = (analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateAudioLevel = () => {
      if (!isRecording && !audioContextRef.current) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const level = Math.min(100, (average / 255) * 100);
      setAudioLevel(level);
      
      audioLevelIntervalRef.current = requestAnimationFrame(updateAudioLevel);
    };
    
    updateAudioLevel();
  };

  // 停止录音
  const stopRecording = () => {
    // 清理定时器
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (audioLevelIntervalRef.current) {
      cancelAnimationFrame(audioLevelIntervalRef.current);
      audioLevelIntervalRef.current = null;
    }

    // 停止 MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // 关闭 WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 停止媒体流
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // 关闭 AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 清理 AudioWorkletNode
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    // 清理 Xenova Whisper 相关
    whisperProcessingRef.current = false;

    // 停止浏览器语音识别
    if (browserSpeechRecognitionRef.current) {
      try {
        browserSpeechRecognitionRef.current.stop();
        browserSpeechRecognitionRef.current = null;
        console.log('✅ 浏览器语音识别已停止');
      } catch (error) {
        console.error('停止浏览器语音识别失败:', error);
      }
    }

    setIsRecording(false);
    setConnectionStatus('disconnected');
    setAudioLevel(0);
    // 保存最终录音时长
    setFinalDuration(recordingDuration);
  };

  // 上传音频文件到后端
  const uploadAudioFile = async (transcriptionId: string): Promise<boolean> => {
    if (audioChunksRef.current.length === 0) {
      console.warn('没有录音数据可上传');
      return false;
    }

    try {
      setSavingAudio(true);
      
      // 创建音频 Blob
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      const extension = mimeType === 'audio/webm' ? 'webm' : 'm4a';
      
      // 创建 FormData
      const formData = new FormData();
      formData.append('audio', audioBlob, `realtime-recording-${Date.now()}.${extension}`);
      
      // 获取 token
      const token = localStorage.getItem('auth_token');
      const baseUrl = window.location.hostname === 'localhost' 
        ? 'http://localhost:8080/api' 
        : '/api';
      
      // 上传音频文件
      const response = await fetch(`${baseUrl}/transcriptions/${transcriptionId}/upload-audio`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('上传音频文件失败');
      }
      
      console.log('音频文件上传成功');
      return true;
    } catch (err: any) {
      console.error('上传音频文件失败:', err);
      setError('上传音频文件失败: ' + err.message);
      return false;
    } finally {
      setSavingAudio(false);
    }
  };

  // 保存并查看详情
  const saveAndView = async () => {
    // 对于浏览器语音识别，如果没有 transcriptionId，先创建一个
    let currentTranscriptionId = transcriptionId;
    
    if (config.apiProvider === 'browser-speech' && !currentTranscriptionId) {
      try {
        const token = localStorage.getItem('auth_token');
        const baseUrl = window.location.hostname === 'localhost' 
          ? 'http://localhost:8080/api' 
          : '/api';
        
        // 合并所有转录文本
        const allText = segments.map(s => s.text).join(' ') + (partialText ? ' ' + partialText : '');
        
        const response = await fetch(`${baseUrl}/transcriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: `浏览器语音识别 - ${new Date().toLocaleString()}`,
            aiProvider: 'browser-speech',
            language: config.model || 'zh-CN',
            content: allText,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          currentTranscriptionId = data.id;
          setTranscriptionId(data.id);
          console.log('✅ 创建转录记录成功:', data.id);
        } else {
          throw new Error('创建转录记录失败');
        }
      } catch (err: any) {
        console.error('创建转录记录失败:', err);
        setError('保存失败: ' + (err.message || '未知错误'));
        return;
      }
    }

    if (currentTranscriptionId) {
      // 先上传音频文件（如果有）
      if (audioChunksRef.current.length > 0) {
        await uploadAudioFile(currentTranscriptionId);
      }
      // 然后跳转到详情页
      navigate(`/transcription/${currentTranscriptionId}`);
    }
  };

  // 清空重新开始
  const clearAndRestart = () => {
    setSegments([]);
    setPartialText('');
    setTranscriptionId(null);
    setError(null);
    setRecordingDuration(0);
    setFinalDuration(0);
  };

  // 格式化录音时长
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 计算转录总字数
  const getTotalWordCount = (): number => {
    const segmentsText = segments.map(s => s.text).join('');
    const allText = segmentsText + partialText;
    // 中文字符计数（包括标点）
    return allText.replace(/\s/g, '').length;
  };

  // 计算说话人数量
  const getSpeakerCount = (): number => {
    const speakerIds = new Set<string>();
    segments.forEach(seg => {
      if (seg.speakerId) {
        speakerIds.add(seg.speakerId);
      }
    });
    return speakerIds.size || 1; // 至少1个说话人
  };

  // 获取录音状态显示内容（思路2 + 思路3结合）
  const getRecordingStatusDisplay = () => {
    // 思路3：智能动态显示
    // 1. 保存音频中
    if (savingAudio) {
      return {
        show: true,
        status: 'saving',
        content: '💾 正在保存音频...',
        className: `${styles.recordingStatus} ${styles.saving}`
      };
    }

    // 2. 录音中
    if (isRecording) {
      const wordCount = getTotalWordCount();
      return {
        show: true,
        status: 'recording',
        content: `🔴 录音中 ${formatDuration(recordingDuration)}${wordCount > 0 ? ` · ${wordCount} 字` : ''}`,
        className: `${styles.recordingStatus} ${styles.recording}`
      };
    }

    // 3. 录音结束（有转录内容）
    if (segments.length > 0 && !isRecording) {
      const wordCount = getTotalWordCount();
      const speakerCount = config.enableSpeakerDiarization ? getSpeakerCount() : 0;
      // 使用最终时长，如果没有则使用当前时长（兼容性处理）
      const duration = finalDuration > 0 ? finalDuration : recordingDuration;
      const durationText = duration > 0 ? formatDuration(duration) : '';

      let content = `✓ 录音完成`;
      if (durationText) content += ` ${durationText}`;
      if (wordCount > 0) content += ` · ${wordCount} 字`;
      if (speakerCount > 1) content += ` · ${speakerCount} 人`;

      return {
        show: true,
        status: 'completed',
        content,
        className: `${styles.recordingStatus} ${styles.completed}`
      };
    }

    // 4. 配置检查（未录音且API未配置）
    // 只有当启用 Gemini 修正时才需要 Gemini API Key
    const needsApiKey = (config.apiProvider === 'qwen' && !apiConfig.qwenApiKey) ||
                        (config.apiProvider === 'echo-transcribe' && !apiConfig.qwenApiKey) ||
                        (config.apiProvider === 'echo-transcribe-ga' && !apiConfig.qwenApiKey) ||
                        (config.apiProvider === 'xenova-whisper' && config.enableGeminiCorrection && !apiConfig.geminiApiKey);
    if (needsApiKey && !isRecording) {
      let providerName = 'API';
      if (config.apiProvider === 'xenova-whisper') {
        providerName = 'Gemini';
      } else if (config.apiProvider === 'echo-transcribe') {
        providerName = 'Echo Transcribe (DashScope)';
      } else if (config.apiProvider === 'echo-transcribe-ga') {
        providerName = 'Echo Transcribe GA (DashScope)';
      } else if (config.apiProvider === 'qwen') {
        providerName = '通义千问';
      }
      return {
        show: true,
        status: 'config',
        content: `⚙️ 请配置${providerName}密钥`,
        className: `${styles.recordingStatus} ${styles.config}`
      };
    }

    // 5. 默认：不显示（思路3：隐藏状态区域）
    return {
      show: false,
      status: 'hidden',
      content: '',
      className: ''
    };
  };

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  // 当切换到 browser-speech 时，确保 model 是有效的语言代码
  useEffect(() => {
    if (config.apiProvider === 'browser-speech') {
      const validLanguageCodes = ['zh-CN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'];
      if (!validLanguageCodes.includes(config.model)) {
        console.log(`检测到无效的语言代码 "${config.model}"，自动更新为 "zh-CN"`);
        setConfig(prev => ({ ...prev, model: 'zh-CN' }));
      }
    }
  }, [config.apiProvider, config.model]);

  const getSpeakerColor = (speakerId?: string | number) => {
    if (!speakerId) return '#1890ff';
    const speakerIdStr = typeof speakerId === 'number' ? String(speakerId) : speakerId;
    const colors = ['#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1'];
    const index = parseInt(speakerIdStr.replace(/\D/g, '')) % colors.length;
    return colors[index];
  };

  // 格式化说话人ID显示
  const formatSpeakerId = (speakerId: string | number | undefined): string => {
    // ✅ 修复：如果启用了说话人分离，即使只有一个说话人也显示（speakerId >= 1）
    if (config.enableSpeakerDiarization) {
      if (!speakerId || speakerId === 0 || speakerId === '0') return '';
      const num = typeof speakerId === 'string' ? parseInt(speakerId.replace(/\D/g, '')) : speakerId;
      return `说话人${num}`;
    }
    return ''; // 未启用说话人分离时不显示
  };

  return (
    <div className={styles.realtimeRecordPage}>
      <Card className={styles.recordCard}>
        <div className={styles.pageHeader}>
          <div className={styles.pageHeaderLeft}>
            <h1 className={styles.pageTitle}>实时录音转录</h1>
            <p className={styles.pageDescription}>
              点击开始录音，AI将实时识别您的语音并转换为文字
            </p>
          </div>
          <div className={styles.pageHeaderRight}>
            {(() => {
              const statusDisplay = getRecordingStatusDisplay();
              if (statusDisplay.show) {
                return (
                  <div className={statusDisplay.className}>
                    {statusDisplay.content}
                  </div>
                );
              }
              return null;
            })()}
            {!isRecording ? (
              <Button
                type="primary"
                size="small"
                icon={<AudioOutlined />}
                onClick={startRecording}
                disabled={connectionStatus === 'connecting'}
              >
                {connectionStatus === 'connecting' ? '连接中...' : '开始录音'}
              </Button>
            ) : (
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={stopRecording}
              >
                停止录音
              </Button>
            )}
            <Button
              icon={<SettingOutlined />}
              onClick={() => setShowSettings(true)}
              type="default"
              size="small"
              title="转录参数设置"
              disabled={isRecording}
            >
              设置
            </Button>
            {segments.length > 0 && !isRecording && (
              <>
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={saveAndView}
                  disabled={config.apiProvider === 'browser-speech' ? false : !transcriptionId}
                >
                  保存并查看详情
                </Button>
                <Button 
                  size="small"
                  icon={<DeleteOutlined />} 
                  onClick={clearAndRestart}
                >
                  清空重新开始
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <Alert
            type={reconnectAttempts > 0 && reconnectAttempts < 3 ? 'warning' : 'error'}
            closable
            onClose={() => setError(null)}
            style={{ marginBottom: 24 }}
            title="错误"
            description={error}
            action={
              reconnectAttempts > 0 && reconnectAttempts < 3 ? (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    setReconnectAttempts(0);
                    setError(null);
                  }}
                >
                  取消重连
                </Button>
              ) : null
            }
          />
        )}


        {/* 参数设置弹窗 */}
        <Modal
          title={
            <Space>
              <SettingOutlined />
              <span>转录参数设置</span>
            </Space>
          }
          open={showSettings}
          onCancel={() => setShowSettings(false)}
          footer={[
            <Button key="cancel" onClick={() => setShowSettings(false)}>
              关闭
            </Button>
          ]}
          width={800}
        >
          <Form layout="vertical" initialValues={config} key={config.apiProvider}>
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item 
                  name="apiProvider"
                  extra="选择实时语音识别服务提供商"
                >
                  <Select
                    value={config.apiProvider}
                    onChange={(value) => {
                      // 根据API提供商设置默认模型
                      let defaultModel = 'paraformer-realtime-v2';
                      if (value === 'qwen') {
                        defaultModel = 'paraformer-realtime-v2';
                      } else if (value === 'google-speech') {
                        defaultModel = 'google-speech-v2';
                      } else if (value === 'xenova-whisper') {
                        defaultModel = 'whisper-tiny';
                      } else if (value === 'echo-transcribe') {
                        defaultModel = 'fun-asr-realtime-2025-11-07'; // echo-transcribe 默认模型
                      } else if (value === 'echo-transcribe-ga') {
                        defaultModel = 'fun-asr-realtime-2025-11-07'; // echo-transcribe-ga 默认模型（与 echo-transcribe 相同）
                      } else if (value === 'browser-speech') {
                        defaultModel = 'zh-CN'; // 浏览器语音识别默认语言：中文
                        // 如果当前 model 不是有效的语言代码，强制使用 zh-CN
                        const validLanguageCodes = ['zh-CN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'];
                        if (!validLanguageCodes.includes(config.model)) {
                          defaultModel = 'zh-CN';
                        } else {
                          // 如果当前 model 是有效的语言代码，保持它
                          defaultModel = config.model;
                        }
                      }
                      setConfig({ ...config, apiProvider: value, model: defaultModel });
                    }}
                    options={[
                      { label: '通义千问 (Qwen) - 推荐', value: 'qwen' },
                      { label: 'Google Speech-to-Text', value: 'google-speech' },
                      { label: 'Xenova Whisper (本地)', value: 'xenova-whisper' },
                      { label: 'Echo Transcribe', value: 'echo-transcribe' },
                      { label: 'Echo Transcribe GA (Global Accelerator)', value: 'echo-transcribe-ga' },
                      { label: '浏览器原生语音识别', value: 'browser-speech' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
            {/* 浏览器原生语音识别只显示语言选择 */}
            {config.apiProvider === 'browser-speech' ? (
              <>
                {/* 移动设备警告 */}
                {(() => {
                  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
                  if (isMobile) {
                    return (
                      <Row gutter={16}>
                        <Col span={24}>
                          <Alert
                            message={isIOS ? "iOS 设备不支持" : "移动设备支持有限"}
                            description={isIOS 
                              ? "iOS Safari 和 Chrome iOS 都不支持浏览器原生语音识别。建议使用其他转录方式（如 Echo Transcribe 或 Qwen）。"
                              : "Android Chrome 可能支持，但可能不稳定。建议使用 Wi-Fi 连接，或使用其他转录方式（如 Echo Transcribe 或 Qwen）。"
                            }
                            type="warning"
                            showIcon
                            style={{ marginBottom: 16 }}
                          />
                        </Col>
                      </Row>
                    );
                  }
                  return null;
                })()}
                <Row gutter={16}>
                  <Col span={24}>
                    <Form.Item 
                      name="model"
                      extra="选择语音识别的语言（浏览器原生语音识别会自动处理采样率、标点符号等）"
                    >
                      <Select
                        value={
                          // 如果当前 model 不是有效的语言代码，强制使用默认值 zh-CN
                          (() => {
                            const validCodes = ['zh-CN', 'en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR', 'de-DE', 'es-ES'];
                            const currentModel = config.model;
                            if (validCodes.includes(currentModel)) {
                              return currentModel;
                            }
                            // 如果不是有效代码，立即更新 config（使用 useEffect 的方式）
                            return 'zh-CN';
                          })()
                        }
                        onChange={(value) => setConfig({ ...config, model: value })}
                        options={[
                          { label: '中文 (zh-CN)', value: 'zh-CN' },
                          { label: '英文 (en-US)', value: 'en-US' },
                        { label: '英文 (en-GB)', value: 'en-GB' },
                        { label: '日文 (ja-JP)', value: 'ja-JP' },
                        { label: '韩文 (ko-KR)', value: 'ko-KR' },
                        { label: '法文 (fr-FR)', value: 'fr-FR' },
                        { label: '德文 (de-DE)', value: 'de-DE' },
                        { label: '西班牙文 (es-ES)', value: 'es-ES' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
              </>
            ) : (
              <>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item 
                      label="采样率 (Hz)" 
                      name="sampleRate"
                      extra={
                        config.apiProvider === 'xenova-whisper' 
                          ? 'Xenova Whisper 固定使用 16kHz' 
                          : undefined
                      }
                    >
                      <Select
                        value={config.sampleRate}
                        onChange={(value) => setConfig({ ...config, sampleRate: value })}
                        disabled={config.apiProvider === 'xenova-whisper'}
                        options={[
                          { label: '8000 Hz', value: 8000 },
                          { label: '16000 Hz (推荐)', value: 16000 },
                          { label: '48000 Hz', value: 48000 },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item 
                      label="模型" 
                      name="model"
                      extra={
                        config.apiProvider === 'xenova-whisper' 
                          ? '使用本地 Whisper Tiny 模型' 
                          : config.apiProvider === 'echo-transcribe' || config.apiProvider === 'echo-transcribe-ga'
                          ? 'Echo Transcribe 支持的 DashScope 模型'
                          : undefined
                      }
                    >
                      <Select
                        value={config.model}
                        onChange={(value) => setConfig({ ...config, model: value })}
                        disabled={config.apiProvider === 'xenova-whisper'}
                        options={
                          config.apiProvider === 'qwen' || config.apiProvider === 'echo-transcribe' || config.apiProvider === 'echo-transcribe-ga'
                            ? [
                                { label: 'FunASR Realtime 2025-11-07 (推荐)', value: 'fun-asr-realtime-2025-11-07' },
                                { label: 'Paraformer Realtime V2', value: 'paraformer-realtime-v2' },
                                { label: 'Paraformer Realtime V1', value: 'paraformer-realtime-v1' },
                              ]
                            : config.apiProvider === 'xenova-whisper'
                            ? [
                                { label: 'Whisper Tiny (推荐)', value: 'whisper-tiny' },
                              ]
                            : [
                                { label: '默认模型', value: 'default' },
                              ]
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item 
                      label="说话人分离" 
                      name="enableSpeakerDiarization"
                      extra={
                        config.apiProvider === 'xenova-whisper' 
                          ? 'Whisper 模型不支持说话人分离'
                          : '自动识别和标记不同说话人'
                      }
                    >
                      <Switch
                        checked={config.enableSpeakerDiarization}
                        onChange={(checked) => setConfig({ ...config, enableSpeakerDiarization: checked })}
                        checkedChildren="开启"
                        unCheckedChildren="关闭"
                        disabled={config.apiProvider === 'xenova-whisper'}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item 
                      label="标点符号" 
                      name="enablePunctuation"
                      extra={
                        config.apiProvider === 'xenova-whisper' 
                          ? 'Whisper 模型不支持标点符号'
                          : '自动添加标点符号'
                      }
                    >
                      <Switch
                        checked={config.enablePunctuation}
                        onChange={(checked) => setConfig({ ...config, enablePunctuation: checked })}
                        checkedChildren="开启"
                        unCheckedChildren="关闭"
                        disabled={config.apiProvider === 'xenova-whisper'}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )}
            {config.apiProvider === 'xenova-whisper' && (
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item 
                    label="启用 Gemini 修正" 
                    name="enableGeminiCorrection"
                    extra="开启后，Whisper 转录结果将经过 Gemini 修正，可以添加标点符号和优化文本。关闭则直接使用 Whisper 原始转录结果。"
                  >
                    <Switch
                      checked={config.enableGeminiCorrection}
                      onChange={(checked) => setConfig({ ...config, enableGeminiCorrection: checked })}
                      checkedChildren="开启"
                      unCheckedChildren="关闭"
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
            {/* Echo Transcribe 专用参数 */}
            {(config.apiProvider === 'echo-transcribe' || config.apiProvider === 'echo-transcribe-ga') && (
              <>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item 
                      label="断句间隔 (秒)" 
                      name="commitTimeout"
                      extra="无文本变化时强制提交的时间间隔，默认 1.2 秒"
                    >
                      <InputNumber
                        value={config.commitTimeout}
                        onChange={(value) => setConfig({ ...config, commitTimeout: value || 1.2 })}
                        min={0.5}
                        max={5.0}
                        step={0.1}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item 
                      label="静音阈值 (秒)" 
                      name="silenceThreshold"
                      extra="用于说话人切换检测的静音时长，默认 1.5 秒"
                    >
                      <InputNumber
                        value={config.silenceThreshold}
                        onChange={(value) => setConfig({ ...config, silenceThreshold: value || 1.5 })}
                        min={0.5}
                        max={5.0}
                        step={0.1}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item 
                      label="轮换检测静音时长 (毫秒)" 
                      name="turnDetectionSilenceDuration"
                      extra="SDK 检测说话人切换的静音时长，默认 800 毫秒"
                    >
                      <InputNumber
                        value={config.turnDetectionSilenceDuration}
                        onChange={(value) => setConfig({ ...config, turnDetectionSilenceDuration: value || 800 })}
                        min={200}
                        max={2000}
                        step={100}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item 
                      label="轮换检测阈值" 
                      name="turnDetectionThreshold"
                      extra="说话人切换检测的敏感度，值越小越敏感，默认 0.35"
                    >
                      <InputNumber
                        value={config.turnDetectionThreshold}
                        onChange={(value) => setConfig({ ...config, turnDetectionThreshold: value || 0.35 })}
                        min={0.1}
                        max={1.0}
                        step={0.05}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )}
            {/* 音频格式 - 仅对非 Echo Transcribe 和非 browser-speech 服务显示 */}
            {(config.apiProvider !== 'echo-transcribe' && config.apiProvider !== 'echo-transcribe-ga' && config.apiProvider !== 'browser-speech') && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item 
                    label="音频格式" 
                    name="format"
                    extra="当前仅支持 PCM 格式"
                  >
                    <Select
                      value={config.format}
                      onChange={(value) => setConfig({ ...config, format: value })}
                      options={[
                        { label: 'PCM (推荐)', value: 'pcm' },
                        { label: 'WAV', value: 'wav' },
                      ]}
                      disabled
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
            {/* 噪音过滤阈值 - 仅对非 browser-speech 服务显示 */}
            {config.apiProvider !== 'browser-speech' && (
              <Row gutter={16}>
                <Col span={config.apiProvider === 'echo-transcribe' || config.apiProvider === 'echo-transcribe-ga' ? 24 : 12}>
                  <Form.Item 
                    label={`噪音过滤阈值: ${config.noiseThreshold}`} 
                    name="noiseThreshold"
                    extra="RMS值，低于此阈值的音频将被过滤（推荐: 300-800）"
                  >
                    <Slider
                      min={0}
                      max={3000}
                      value={config.noiseThreshold}
                      onChange={(value) => setConfig({ ...config, noiseThreshold: value })}
                      marks={{
                        0: '0',
                        500: '500',
                        1000: '1000',
                        2000: '2000',
                        3000: '3000',
                      }}
                      tooltip={{ formatter: (value) => `${value}` }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </Form>
        </Modal>

        <div className={styles.recordControls}>
          <Space size="large" vertical style={{ width: '100%' }}>
            {isRecording && (
              <div style={{ width: '100%', textAlign: 'center' }}>
                <div className={styles.recordingIndicator}>
                  <span className={styles.pulseDot}></span>
                  <span>正在录音... {formatDuration(recordingDuration)}</span>
                </div>
                
                {/* 音频可视化 */}
                <div className={styles.audioVisualizer}>
                  <div className={styles.audioLevelBar}>
                    <div
                      className={styles.audioLevelFill}
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <div className={styles.audioLevelText}>
                    音量: {Math.round(audioLevel)}%
                  </div>
                </div>
              </div>
            )}
          </Space>
        </div>

        <div className={styles.transcriptionResult}>
          {segments.length === 0 && !partialText && (
            <div className={styles.emptyState}>
              <p>还没有转录内容</p>
              <p className={styles.hint}>点击"开始录音"开始说话</p>
            </div>
          )}

          <div className={styles.transcriptText}>
            {(() => {
              // ✅ 修复：合并相同说话人的连续句子，只在说话人变化时换行
              const groupedSegments: Array<{ speakerId?: string | number; texts: string[] }> = [];
              
              segments.forEach((segment) => {
                const lastGroup = groupedSegments[groupedSegments.length - 1];
                const currentSpeakerId = segment.speakerId || undefined;
                
                // 如果最后一个组存在且说话人相同，则合并文本
                if (lastGroup && lastGroup.speakerId === currentSpeakerId) {
                  lastGroup.texts.push(segment.text);
                } else {
                  // 说话人变化或第一个句子，创建新组
                  groupedSegments.push({
                    speakerId: currentSpeakerId,
                    texts: [segment.text],
                  });
                }
              });
              
              // 检查是否有多个不同的说话人
              const uniqueSpeakers = new Set(
                groupedSegments
                  .map(g => g.speakerId)
                  .filter(id => id !== undefined && id !== 0 && id !== '0')
              );
              const hasMultipleSpeakers = uniqueSpeakers.size > 1;
              
              return groupedSegments.map((group, groupIndex) => {
                // 只有在有多个说话人时才显示说话人标签
                const speakerLabel = hasMultipleSpeakers ? formatSpeakerId(group.speakerId) : '';
                const combinedText = group.texts.join('');
                
                return (
                  <div key={groupIndex} className={styles.transcriptSegment}>
                    {speakerLabel && (
                      <Tag
                        color={getSpeakerColor(group.speakerId)}
                        style={{ marginRight: 8, fontWeight: 500 }}
                      >
                        {speakerLabel}
                      </Tag>
                    )}
                    <span className={styles.finalText}>{combinedText}</span>
                  </div>
                );
              });
            })()}

            {partialText && (
              <div className={`${styles.transcriptSegment} ${styles.partial}`}>
                <span className={styles.partialText}>{partialText}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default RealtimeRecordPage;
