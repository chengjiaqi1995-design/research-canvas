import { create } from 'zustand';

// ====== Types ======

export interface TranscriptionSegment {
  text: string;
  isFinal: boolean;
  speakerId?: string;
  timestamp?: number;
}

export interface Highlight {
  id: string;
  text: string;
  note: string;
  speakerId?: string;
  timestamp: number;
  segmentIndex: number;
}

export interface AILog {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: 'client' | 'server' | 'python';
  message: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type AudioSource = 'mic' | 'system' | 'both';
export type TranscriptionLanguage = 'zh' | 'en' | 'ja' | 'mixed';

// ====== Non-reactive refs (live outside React, never trigger re-renders) ======

const refs = {
  ws: null as WebSocket | null,
  mediaStream: null as MediaStream | null,
  displayStream: null as MediaStream | null,
  audioContext: null as AudioContext | null,
  audioWorkletNode: null as AudioWorkletNode | null,
  analyser: null as AnalyserNode | null,
  mediaRecorder: null as MediaRecorder | null,
  audioChunks: [] as Blob[],
  durationInterval: null as ReturnType<typeof setInterval> | null,
  audioLevelRAF: null as number | null,
  isPaused: false,
  isRecording: false,
  wsReconnectCount: 0,
};

// ====== Helper: read auth token ======

const getAuthToken = (): string | null => {
  if (import.meta.env.DEV) return 'dev-token';
  try {
    const rcStored = localStorage.getItem('rc_auth_user');
    if (rcStored) {
      const parsed = JSON.parse(rcStored);
      if (parsed._credential) return parsed._credential;
    }
  } catch { /* ignore */ }
  return localStorage.getItem('auth_token');
};

const getApiConfig = () => {
  try {
    const stored = localStorage.getItem('apiConfig');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

// ====== Store interface ======

interface RecordingState {
  // State
  isRecording: boolean;
  isPaused: boolean;
  connectionStatus: ConnectionStatus;
  transcriptionId: string | null;
  segments: TranscriptionSegment[];
  partialText: string;
  error: string | null;
  connectionMessage: string | null;  // ASR status messages (reconnecting, stall, etc.)
  audioLevel: number;
  recordingDuration: number;
  uploadingAudio: boolean;
  highlights: Highlight[];
  aiLogs: AILog[];

  // Settings (persisted across sessions)
  noiseThreshold: number;
  model: string;
  enableSpeakerDiarization: boolean;
  enablePunctuation: boolean;
  sampleRate: number;
  turnDetectionSilenceDuration: number;
  turnDetectionThreshold: number;
  enableDisfluencyRemoval: boolean;
  audioSource: AudioSource;
  language: TranscriptionLanguage;
  // Commit strategy params (0 = use model/language default)
  commitStrongMin: number;
  commitWeakMin: number;
  commitForceLen: number;
  commitBufferIsEnd: number;
  commitSilTimeout: number; // seconds, 0 = default
  commitMaxPending: number;

  // Actions
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  stopAndSave: () => Promise<string | null>;
  togglePause: () => void;
  clearError: () => void;
  addAiLog: (level: AILog['level'], source: AILog['source'], message: string) => void;
  addHighlight: (text: string) => void;
  removeHighlight: (id: string) => void;
  updateHighlightNote: (id: string, note: string) => void;

  // Settings setters
  setNoiseThreshold: (v: number) => void;
  setModel: (v: string) => void;
  setEnableSpeakerDiarization: (v: boolean) => void;
  setEnablePunctuation: (v: boolean) => void;
  setSampleRate: (v: number) => void;
  setTurnDetectionSilenceDuration: (v: number) => void;
  setTurnDetectionThreshold: (v: number) => void;
  setEnableDisfluencyRemoval: (v: boolean) => void;
  setAudioSource: (v: AudioSource) => void;
  setLanguage: (v: TranscriptionLanguage) => void;
  setCommitStrongMin: (v: number) => void;
  setCommitWeakMin: (v: number) => void;
  setCommitForceLen: (v: number) => void;
  setCommitBufferIsEnd: (v: number) => void;
  setCommitSilTimeout: (v: number) => void;
  setCommitMaxPending: (v: number) => void;
}

// ====== Internals (not exported, used by actions) ======

function logAI(level: AILog['level'], source: AILog['source'], message: string) {
  useRecordingStore.getState().addAiLog(level, source, message);
}

function cleanupResources() {
  if (refs.durationInterval) {
    clearInterval(refs.durationInterval);
    refs.durationInterval = null;
  }
  if (refs.audioLevelRAF) {
    cancelAnimationFrame(refs.audioLevelRAF);
    refs.audioLevelRAF = null;
  }
  if (refs.mediaRecorder && refs.mediaRecorder.state !== 'inactive') {
    try { refs.mediaRecorder.stop(); } catch { /* ignore */ }
  }
  if (refs.ws) {
    refs.ws.close();
    refs.ws = null;
  }
  if (refs.mediaStream) {
    refs.mediaStream.getTracks().forEach((t) => t.stop());
    refs.mediaStream = null;
  }
  if (refs.displayStream) {
    refs.displayStream.getTracks().forEach((t) => t.stop());
    refs.displayStream = null;
  }
  if (refs.audioContext) {
    refs.audioContext.close();
    refs.audioContext = null;
  }
  if (refs.audioWorkletNode) {
    refs.audioWorkletNode.disconnect();
    refs.audioWorkletNode = null;
  }
  refs.analyser = null;
}

function startAudioLevelMonitoring(analyser: AnalyserNode) {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const update = () => {
    if (!refs.isRecording && !refs.audioContext) return;
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
    const level = Math.min(100, (average / 255) * 100);
    useRecordingStore.setState({ audioLevel: level });
    refs.audioLevelRAF = requestAnimationFrame(update);
  };
  update();
}

function connectWebSocket(state: RecordingState, existingTranscriptionId?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    const token = getAuthToken();
    if (token) params.append('token', token);

    params.append('apiProvider', 'qwen');
    params.append('sampleRate', state.sampleRate.toString());
    params.append('enableSpeakerDiarization', state.enableSpeakerDiarization.toString());
    params.append('enablePunctuation', state.enablePunctuation.toString());
    params.append('model', state.model);
    params.append('format', 'pcm');
    params.append('noiseThreshold', state.noiseThreshold.toString());
    params.append('turnDetectionSilenceDuration', state.turnDetectionSilenceDuration.toString());
    params.append('turnDetectionThreshold', state.turnDetectionThreshold.toString());
    params.append('enableDisfluencyRemoval', state.enableDisfluencyRemoval.toString());
    params.append('language', state.language);
    // Commit strategy overrides (0 = use server default)
    if (state.commitStrongMin > 0) params.append('commitStrongMin', state.commitStrongMin.toString());
    if (state.commitWeakMin > 0) params.append('commitWeakMin', state.commitWeakMin.toString());
    if (state.commitForceLen > 0) params.append('commitForceLen', state.commitForceLen.toString());
    if (state.commitBufferIsEnd > 0) params.append('commitBufferIsEnd', state.commitBufferIsEnd.toString());
    if (state.commitSilTimeout > 0) params.append('commitSilTimeout', state.commitSilTimeout.toString());
    if (state.commitMaxPending > 0) params.append('commitMaxPending', state.commitMaxPending.toString());
    if (existingTranscriptionId) params.append('existingTranscriptionId', existingTranscriptionId);

    const apiConfig = getApiConfig();
    if (!apiConfig.qwenApiKey) {
      reject(new Error('未配置 Qwen API Key，请在右上角设置中输入完整的 API Key'));
      return;
    }
    if (apiConfig.qwenApiKey.includes('****')) {
      reject(new Error('API Key 已失效（被掩码覆盖），请在右上角设置中重新输入完整的 Qwen API Key'));
      return;
    }
    params.append('apiKey', apiConfig.qwenApiKey);

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname === 'localhost' ? 'localhost:8081' : window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}/ws/realtime-transcription?${params.toString()}`;

    console.log('Connecting WebSocket:', wsUrl.replace(/token=[^&]+/, 'token=***').replace(/apiKey=[^&]+/, 'apiKey=***'));
    logAI('info', 'client', `WebSocket 连接中... 模型: ${state.model}, 采样率: ${state.sampleRate}Hz`);
    useRecordingStore.setState({ connectionStatus: 'connecting' });

    const protocols = token ? [`auth-${token}`] : undefined;
    const ws = new WebSocket(wsUrl, protocols);

    ws.onopen = () => {
      console.log('WebSocket connected');
      logAI('info', 'client', 'WebSocket 已连接');
      useRecordingStore.setState({ connectionStatus: 'connected' });
      resolve(ws);
    };
    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      logAI('error', 'client', 'WebSocket 连接失败');
      useRecordingStore.setState({ connectionStatus: 'disconnected', error: 'WebSocket connection failed.' });
      reject(err);
    };
    ws.onclose = (event) => {
      console.log('WebSocket closed', { code: event.code, reason: event.reason, wasClean: event.wasClean });
      logAI('warn', 'client', `WebSocket 关闭 (code=${event.code}, reason=${event.reason || '无'}, clean=${event.wasClean})`);
      useRecordingStore.setState({ connectionStatus: 'disconnected' });

      // If still recording, the WebSocket died unexpectedly — notify user
      const state = useRecordingStore.getState();
      if (state.isRecording && refs.isRecording) {
        refs.wsReconnectCount++;
        const attempt = refs.wsReconnectCount;
        const MAX_RECONNECTS = 5;

        if (attempt > MAX_RECONNECTS) {
          console.error(`[RecordingStore] Max reconnect attempts (${MAX_RECONNECTS}) reached`);
          logAI('error', 'client', `重连失败，已达最大重试次数 (${MAX_RECONNECTS})`);
          useRecordingStore.setState({
            connectionMessage: null,
            error: `连接已断开（重连${MAX_RECONNECTS}次失败），请停止后重新开始录音`,
          });
          return;
        }

        console.warn(`[RecordingStore] WebSocket closed while recording! Reconnect attempt ${attempt}/${MAX_RECONNECTS}...`);
        logAI('warn', 'client', `录音中 WebSocket 断开，重连 ${attempt}/${MAX_RECONNECTS}...`);
        useRecordingStore.setState({ connectionMessage: `[WS] 连接断开，正在重连 (${attempt}/${MAX_RECONNECTS})...` });

        // Auto-reconnect after a short delay
        setTimeout(async () => {
          const currentState = useRecordingStore.getState();
          if (!currentState.isRecording || !refs.isRecording) return; // user stopped

          try {
            const newWs = await connectWebSocket(currentState, currentState.transcriptionId ?? undefined);
            refs.ws = newWs;
            setupWebSocketHandlers(newWs);
            refs.wsReconnectCount = 0; // reset on success
            logAI('info', 'client', '重连成功，继续转录');
            useRecordingStore.setState({ connectionStatus: 'connected', connectionMessage: '[WS] 重连成功，继续转录' });
            setTimeout(() => useRecordingStore.setState({ connectionMessage: null }), 3000);
            console.log('[RecordingStore] WebSocket reconnected successfully');
          } catch (err) {
            console.error('[RecordingStore] WebSocket reconnect failed:', err);
            logAI('error', 'client', `重连失败: ${(err as Error).message}`);
            useRecordingStore.setState({
              connectionMessage: null,
              error: '连接已断开且重连失败，请停止后重新开始录音',
            });
          }
        }, 2000);
      }
    };
  });
}

function setupWebSocketHandlers(ws: WebSocket) {
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'init') {
        logAI('info', 'server', `会话初始化完成, transcriptionId=${data.transcriptionId}`);
        useRecordingStore.setState({ transcriptionId: data.transcriptionId, error: null });
      } else if (data.type === 'status') {
        if (data.message) {
          console.log('Status:', data.message);
          logAI('info', 'server', data.message);
          // Show reconnect/stall messages to user, clear on success
          if (data.message.includes('重连') || data.message.includes('无响应') || data.message.includes('reconnect')) {
            useRecordingStore.setState({ connectionMessage: data.message });
            // Auto-clear success message after 3s
            if (data.message.includes('成功') || data.message.includes('success')) {
              setTimeout(() => useRecordingStore.setState({ connectionMessage: null }), 3000);
            }
          } else if (data.message.includes('established') || data.message.includes('transcribing')) {
            useRecordingStore.setState({ connectionMessage: null });
          }
        }
      } else if (data.type === 'transcription') {
        if (data.isFinal) {
          const textPreview = data.text.length > 30 ? data.text.slice(0, 30) + '...' : data.text;
          logAI('info', 'server', `[commit] ${data.speakerId != null ? `Speaker ${data.speakerId}: ` : ''}${textPreview}`);
          useRecordingStore.setState((s) => {
            const newSegments = [
              ...s.segments,
              { text: data.text, isFinal: true, speakerId: data.speakerId, timestamp: Date.now() },
            ];
            return {
              segments: newSegments,
              partialText: '',
            };
          });
        } else {
          useRecordingStore.setState({ partialText: data.text });
        }
      } else if (data.type === 'ready') {
        logAI('info', 'server', 'ASR 转录服务就绪');
        console.log('Transcription service ready');
      } else if (data.type === 'error') {
        logAI('error', 'server', `错误: ${data.error}`);
        useRecordingStore.setState({ error: data.error });
      } else if (data.type === 'log') {
        // Server-side AI operation logs
        logAI(data.level || 'info', data.source || 'server', data.message || '');
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
      logAI('error', 'client', `WebSocket 消息解析失败: ${(err as Error).message}`);
    }
  };
}

async function uploadAudio(transcriptionId: string): Promise<void> {
  console.log(`[RecordingStore] uploadAudio called, transcriptionId=${transcriptionId}, chunks=${refs.audioChunks.length}`);
  const audioChunks = [...refs.audioChunks]; // copy before cleanup
  refs.audioChunks = [];

  if (audioChunks.length === 0) {
    console.warn('[RecordingStore] No audio chunks to upload — MediaRecorder may not have captured data');
    return;
  }

  useRecordingStore.setState({ uploadingAudio: true });
  try {
    const mimeType = audioChunks[0]?.type || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mimeType });
    const sizeKB = (audioBlob.size / 1024).toFixed(1);
    console.log(`[RecordingStore] Audio blob: ${sizeKB}KB, type: ${mimeType}, chunks: ${audioChunks.length}`);
    logAI('info', 'client', `音频文件准备上传: ${sizeKB}KB, ${audioChunks.length} chunks, 格式: ${mimeType}`);

    if (audioBlob.size < 100) {
      console.warn('[RecordingStore] Audio blob too small, skipping upload');
      logAI('warn', 'client', '音频文件太小 (<100B)，跳过上传');
      return;
    }

    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const formData = new FormData();
    formData.append('audio', audioBlob, `realtime-recording.${ext}`);

    const token = getAuthToken();
    const baseUrl = import.meta.env.DEV ? 'http://localhost:8081/api' : '/api';
    const uploadUrl = `${baseUrl}/transcriptions/${transcriptionId}/upload-audio`;
    console.log(`[RecordingStore] Uploading audio to: ${uploadUrl}`);

    const resp = await fetch(uploadUrl, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[RecordingStore] Upload failed: ${resp.status} ${text}`);
      logAI('error', 'client', `音频上传失败: HTTP ${resp.status} — ${text.slice(0, 100)}`);
    } else {
      const result = await resp.json();
      console.log('[RecordingStore] Audio uploaded successfully:', result?.data?.filePath);
      logAI('info', 'client', `音频上传成功: ${result?.data?.filePath || '已保存'}`);
    }
  } catch (err) {
    console.error('[RecordingStore] Failed to upload audio:', err);
    logAI('error', 'client', `音频上传异常: ${(err as Error).message}`);
  } finally {
    useRecordingStore.setState({ uploadingAudio: false });
  }
}

// ====== Settings persistence ======

const SETTINGS_KEY = 'recording_settings';

interface PersistedSettings {
  noiseThreshold: number;
  model: string;
  enableSpeakerDiarization: boolean;
  enablePunctuation: boolean;
  sampleRate: number;
  turnDetectionSilenceDuration: number;
  turnDetectionThreshold: number;
  enableDisfluencyRemoval: boolean;
  audioSource: AudioSource;
  language: TranscriptionLanguage;
  commitStrongMin: number;
  commitWeakMin: number;
  commitForceLen: number;
  commitBufferIsEnd: number;
  commitSilTimeout: number;
  commitMaxPending: number;
}

const defaultSettings: PersistedSettings = {
  noiseThreshold: 500,
  model: 'paraformer-realtime-v2',
  enableSpeakerDiarization: true,
  enablePunctuation: true,
  sampleRate: 16000,
  turnDetectionSilenceDuration: 800,
  turnDetectionThreshold: 0.4,
  enableDisfluencyRemoval: false,
  audioSource: 'mic',
  language: 'zh',
  commitStrongMin: 0,
  commitWeakMin: 0,
  commitForceLen: 0,
  commitBufferIsEnd: 0,
  commitSilTimeout: 0,
  commitMaxPending: 0,
};

function loadSettings(): PersistedSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...defaultSettings, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...defaultSettings };
}

function saveSettings(partial: Partial<PersistedSettings>) {
  try {
    const current = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...partial }));
  } catch { /* ignore */ }
}

/** Send commit param updates to server via WebSocket during active recording */
function sendCommitParamsUpdate() {
  if (!refs.ws || refs.ws.readyState !== WebSocket.OPEN) return;
  const s = useRecordingStore.getState();
  const params: Record<string, number> = {};
  if (s.commitStrongMin) params.commit_strong_min = s.commitStrongMin;
  if (s.commitWeakMin) params.commit_weak_min = s.commitWeakMin;
  if (s.commitForceLen) params.commit_force_len = s.commitForceLen;
  if (s.commitBufferIsEnd) params.commit_buffer_is_end = s.commitBufferIsEnd;
  if (s.commitSilTimeout) params.commit_sil_timeout = s.commitSilTimeout;
  if (s.commitMaxPending) params.commit_max_pending = s.commitMaxPending;
  refs.ws.send(JSON.stringify({ type: 'update_commit_params', params }));
}

// ====== Create store ======

const initialSettings = loadSettings();

export const useRecordingStore = create<RecordingState>((set, get) => ({
  // State
  isRecording: false,
  isPaused: false,
  connectionStatus: 'disconnected',
  transcriptionId: null,
  segments: [],
  partialText: '',
  error: null,
  connectionMessage: null,
  audioLevel: 0,
  recordingDuration: 0,
  uploadingAudio: false,
  highlights: [],
  aiLogs: [],

  // Settings (restored from localStorage)
  ...initialSettings,

  // === Actions ===

  addAiLog: (level, source, message) => {
    set((s) => {
      const logs = [...s.aiLogs, { ts: Date.now(), level, source, message }];
      // Keep last 500 entries
      return { aiLogs: logs.length > 500 ? logs.slice(-500) : logs };
    });
  },

  startRecording: async () => {
    const state = get();
    try {
      set({ error: null, connectionMessage: null, connectionStatus: 'connecting', recordingDuration: 0, segments: [], partialText: '', highlights: [], aiLogs: [] });
      refs.audioChunks = [];
      refs.wsReconnectCount = 0;

      // 1. Acquire audio stream
      let stream: MediaStream;
      if (state.audioSource === 'mic') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } else if (state.audioSource === 'system') {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        displayStream.getVideoTracks().forEach((t) => t.stop());
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length === 0) throw new Error('No system audio captured. Make sure to check "Share audio".');
        stream = new MediaStream(audioTracks);
        refs.displayStream = displayStream;
      } else {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        displayStream.getVideoTracks().forEach((t) => t.stop());
        refs.displayStream = displayStream;
        const sysAudioTracks = displayStream.getAudioTracks();
        if (sysAudioTracks.length === 0) {
          stream = micStream;
        } else {
          const mixCtx = new AudioContext();
          const micSrc = mixCtx.createMediaStreamSource(micStream);
          const sysSrc = mixCtx.createMediaStreamSource(new MediaStream(sysAudioTracks));
          const dest = mixCtx.createMediaStreamDestination();
          micSrc.connect(dest);
          sysSrc.connect(dest);
          stream = dest.stream;
          refs.mediaStream = micStream; // keep for cleanup
        }
      }
      refs.mediaStream = stream;
      logAI('info', 'client', `音频源获取成功: ${state.audioSource}, tracks=${stream.getAudioTracks().length}`);

      // 2. MediaRecorder for audio backup
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      refs.mediaRecorder = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          refs.audioChunks.push(event.data);
          // No chunk limit — keep full recording for lossless save.
          // Real-time transcription goes through a separate WebSocket path.
        }
      };
      mediaRecorder.start(1000);

      // 3. WebSocket
      const ws = await connectWebSocket(state);
      refs.ws = ws;
      setupWebSocketHandlers(ws);

      // 4. AudioContext + AudioWorklet
      let audioContext: AudioContext;
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      } catch {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      refs.audioContext = audioContext;
      const actualSampleRate = audioContext.sampleRate;
      const TARGET = 16000;
      const needsResampling = actualSampleRate !== TARGET;

      const downsampleToInt16 = (input: Float32Array): ArrayBuffer => {
        let samples = input;
        if (needsResampling) {
          const ratio = actualSampleRate / TARGET;
          const outLen = Math.floor(input.length / ratio);
          const resampled = new Float32Array(outLen);
          for (let i = 0; i < outLen; i++) {
            const idx = i * ratio;
            const lo = Math.floor(idx);
            const hi = Math.min(lo + 1, input.length - 1);
            const frac = idx - lo;
            resampled[i] = input[lo] * (1 - frac) + input[hi] * frac;
          }
          samples = resampled;
        }
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return pcm.buffer;
      };

      try {
        await audioContext.audioWorklet.addModule('/audio-processor.js');
        const workletNode = new AudioWorkletNode(audioContext, 'recorder-worklet', {
          processorOptions: { noiseThreshold: state.noiseThreshold },
        });
        refs.audioWorkletNode = workletNode;

        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && refs.ws?.readyState === WebSocket.OPEN && !refs.isPaused) {
            if (needsResampling) {
              const int16 = new Int16Array(event.data.data);
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
              }
              refs.ws.send(downsampleToInt16(float32));
            } else {
              refs.ws.send(event.data.data);
            }
          }
        };

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        refs.analyser = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);
      } catch (workletError) {
        console.warn('AudioWorklet not supported, falling back to ScriptProcessor:', workletError);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(processor);
        processor.connect(audioContext.destination);
        processor.onaudioprocess = (e) => {
          if (refs.ws?.readyState === WebSocket.OPEN && !refs.isPaused) {
            refs.ws.send(downsampleToInt16(e.inputBuffer.getChannelData(0)));
          }
        };
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        refs.analyser = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);
      }

      // 5. Duration timer
      refs.durationInterval = setInterval(() => {
        useRecordingStore.setState((s) => ({ recordingDuration: s.recordingDuration + 1 }));
      }, 1000);

      refs.isRecording = true;
      refs.isPaused = false;
      logAI('info', 'client', '录音已开始');
      set({ isRecording: true, isPaused: false });
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      logAI('error', 'client', `录音启动失败: ${err.message}`);
      set({ error: err.message || 'Failed to start recording', connectionStatus: 'disconnected' });
    }
  },

  stopRecording: () => {
    cleanupResources();
    refs.isRecording = false;
    refs.isPaused = false;
    set({ isRecording: false, isPaused: false, connectionStatus: 'disconnected', audioLevel: 0 });
  },

  stopAndSave: async () => {
    const { transcriptionId } = get();
    if (!transcriptionId) {
      get().stopRecording();
      return null;
    }

    // Wait for MediaRecorder to finalize (flush last chunk)
    await new Promise<void>((resolve) => {
      const recorder = refs.mediaRecorder;
      if (!recorder || recorder.state === 'inactive') { resolve(); return; }
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch { /* ignore */ }
      recorder.stop();
    });
    console.log(`[RecordingStore] MediaRecorder finalized, audioChunks: ${refs.audioChunks.length}`);

    // Prevent cleanupResources from stopping MediaRecorder again
    refs.mediaRecorder = null;
    cleanupResources();
    refs.isRecording = false;
    refs.isPaused = false;
    set({ isRecording: false, isPaused: false, connectionStatus: 'disconnected', audioLevel: 0 });

    // Wait briefly for server to finish saving text (server has 800ms flush delay)
    await new Promise(resolve => setTimeout(resolve, 1200));

    // Upload audio
    await uploadAudio(transcriptionId);

    const savedId = transcriptionId;
    // Reset for next session
    set({ transcriptionId: null, segments: [], partialText: '', highlights: [] });
    return savedId;
  },

  togglePause: () => {
    const wasPaused = refs.isPaused;
    refs.isPaused = !wasPaused;

    if (!wasPaused) {
      // Pause
      if (refs.durationInterval) { clearInterval(refs.durationInterval); refs.durationInterval = null; }
      if (refs.mediaRecorder?.state === 'recording') refs.mediaRecorder.pause();
    } else {
      // Resume
      refs.durationInterval = setInterval(() => {
        useRecordingStore.setState((s) => ({ recordingDuration: s.recordingDuration + 1 }));
      }, 1000);
      if (refs.mediaRecorder?.state === 'paused') refs.mediaRecorder.resume();
    }
    set({ isPaused: !wasPaused });
  },

  clearError: () => set({ error: null }),

  addHighlight: (text: string) => {
    const hl: Highlight = { id: `hl-${Date.now()}`, text, note: '', timestamp: Date.now(), segmentIndex: -1 };
    set((s) => ({ highlights: [...s.highlights, hl] }));
  },

  removeHighlight: (id: string) => set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) })),

  updateHighlightNote: (id: string, note: string) =>
    set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? { ...h, note } : h)) })),

  // Settings setters (persist to localStorage)
  setNoiseThreshold: (v) => { set({ noiseThreshold: v }); saveSettings({ noiseThreshold: v }); },
  setModel: (v) => {
    const updates: Partial<PersistedSettings> = { model: v };
    // Qwen3-ASR 使用 server_vad 自动管理，不支持 threshold 参数，给独立默认值
    const isQwen3 = v === 'qwen3-asr-flash-realtime';
    const wasQwen3 = get().model === 'qwen3-asr-flash-realtime';
    if (isQwen3 && !wasQwen3) {
      // 切到 Qwen3：threshold=0.2（比 Paraformer 更灵敏），silence 保持 800ms
      updates.turnDetectionSilenceDuration = 800;
      updates.turnDetectionThreshold = 0.2;
    } else if (!isQwen3 && wasQwen3) {
      // 从 Qwen3 切回其他模型：恢复 Paraformer 默认值
      updates.turnDetectionSilenceDuration = 800;
      updates.turnDetectionThreshold = 0.4;
    }
    set(updates);
    saveSettings(updates);
  },
  setEnableSpeakerDiarization: (v) => { set({ enableSpeakerDiarization: v }); saveSettings({ enableSpeakerDiarization: v }); },
  setEnablePunctuation: (v) => { set({ enablePunctuation: v }); saveSettings({ enablePunctuation: v }); },
  setSampleRate: (v) => { set({ sampleRate: v }); saveSettings({ sampleRate: v }); },
  setTurnDetectionSilenceDuration: (v) => { set({ turnDetectionSilenceDuration: v }); saveSettings({ turnDetectionSilenceDuration: v }); },
  setTurnDetectionThreshold: (v) => { set({ turnDetectionThreshold: v }); saveSettings({ turnDetectionThreshold: v }); },
  setEnableDisfluencyRemoval: (v) => { set({ enableDisfluencyRemoval: v }); saveSettings({ enableDisfluencyRemoval: v }); },
  setAudioSource: (v) => { set({ audioSource: v }); saveSettings({ audioSource: v }); },
  setLanguage: (v) => { set({ language: v }); saveSettings({ language: v }); },
  setCommitStrongMin: (v) => { set({ commitStrongMin: v }); saveSettings({ commitStrongMin: v }); sendCommitParamsUpdate(); },
  setCommitWeakMin: (v) => { set({ commitWeakMin: v }); saveSettings({ commitWeakMin: v }); sendCommitParamsUpdate(); },
  setCommitForceLen: (v) => { set({ commitForceLen: v }); saveSettings({ commitForceLen: v }); sendCommitParamsUpdate(); },
  setCommitBufferIsEnd: (v) => { set({ commitBufferIsEnd: v }); saveSettings({ commitBufferIsEnd: v }); sendCommitParamsUpdate(); },
  setCommitSilTimeout: (v) => { set({ commitSilTimeout: v }); saveSettings({ commitSilTimeout: v }); sendCommitParamsUpdate(); },
  setCommitMaxPending: (v) => { set({ commitMaxPending: v }); saveSettings({ commitMaxPending: v }); sendCommitParamsUpdate(); },
}));
