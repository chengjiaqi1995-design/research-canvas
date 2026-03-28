import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface TranscriptionSegment {
  text: string;
  isFinal: boolean;
  speakerId?: string;
  timestamp?: number;
}

// Read API config from localStorage
const getApiConfig = () => {
  try {
    const stored = localStorage.getItem('apiConfig');
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const RealtimeRecordPage: React.FC = () => {
  const navigate = useNavigate();
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [partialText, setPartialText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);

  // Transcription parameters
  const [noiseThreshold, setNoiseThreshold] = useState(500);
  const [model, setModel] = useState('paraformer-realtime-v2');
  const [enableSpeakerDiarization, setEnableSpeakerDiarization] = useState(true);
  const [enablePunctuation, setEnablePunctuation] = useState(true);
  const [sampleRate, setSampleRate] = useState(16000);
  const [turnDetectionSilenceDuration, setTurnDetectionSilenceDuration] = useState(800);
  const [turnDetectionThreshold, setTurnDetectionThreshold] = useState(0.4);
  const [enableDisfluencyRemoval, setEnableDisfluencyRemoval] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioLevelIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptionEndRef = useRef<HTMLDivElement | null>(null);
  const isRecordingRef = useRef(false);

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Auto-scroll to bottom when segments change
  useEffect(() => {
    transcriptionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments, partialText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startAudioLevelMonitoring = (analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateAudioLevel = () => {
      if (!isRecordingRef.current && !audioContextRef.current) return;

      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      const level = Math.min(100, (average / 255) * 100);
      setAudioLevel(level);

      audioLevelIntervalRef.current = requestAnimationFrame(updateAudioLevel);
    };

    updateAudioLevel();
  };

  const connectWebSocket = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams();

      // 读取 auth token，兼容多种存储方式
      let token: string | null = null;
      if (import.meta.env.DEV) {
        // 本地开发使用 dev-token
        token = 'dev-token';
      } else {
        try {
          const rcStored = localStorage.getItem('rc_auth_user');
          if (rcStored) {
            const parsed = JSON.parse(rcStored);
            if (parsed._credential) token = parsed._credential;
          }
        } catch (e) { /* ignore */ }
        if (!token) token = localStorage.getItem('auth_token');
      }
      if (token) {
        params.append('token', token);
      }

      params.append('apiProvider', 'qwen');
      params.append('sampleRate', sampleRate.toString());
      params.append('enableSpeakerDiarization', enableSpeakerDiarization.toString());
      params.append('enablePunctuation', enablePunctuation.toString());
      params.append('model', model);
      params.append('format', 'pcm');
      params.append('noiseThreshold', noiseThreshold.toString());
      params.append('turnDetectionSilenceDuration', turnDetectionSilenceDuration.toString());
      params.append('turnDetectionThreshold', turnDetectionThreshold.toString());
      params.append('enableDisfluencyRemoval', enableDisfluencyRemoval.toString());

      // Send API key — validate it's not masked
      const apiConfig = getApiConfig();
      if (!apiConfig.qwenApiKey) {
        throw new Error('未配置 Qwen API Key，请在右上角设置中输入完整的 API Key');
      }
      if (apiConfig.qwenApiKey.includes('****')) {
        throw new Error('API Key 已失效（被掩码覆盖），请在右上角设置中重新输入完整的 Qwen API Key');
      }
      params.append('apiKey', apiConfig.qwenApiKey);

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Dev: connect directly to aiprocess-api (8081), bypassing server.js proxy
      // Prod: connect via nginx which proxies to backend
      const wsHost = window.location.hostname === 'localhost' ? 'localhost:8081' : window.location.host;
      const wsUrl = `${wsProtocol}//${wsHost}/ws/realtime-transcription?${params.toString()}`;

      console.log('Connecting WebSocket:', wsUrl.replace(/token=[^&]+/, 'token=***').replace(/apiKey=[^&]+/, 'apiKey=***'));
      setConnectionStatus('connecting');
      // Pass auth token via Sec-WebSocket-Protocol header as well (URL params may
      // get mangled through the Nginx → Cloud Run → http-proxy-middleware chain)
      const protocols = token ? [`auth-${token}`] : undefined;
      const ws = new WebSocket(wsUrl, protocols);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        resolve(ws);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setConnectionStatus('disconnected');
        setError('WebSocket connection failed. Check that the backend is running.');
        reject(err);
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed', { code: event.code, reason: event.reason });
        if (!event.wasClean) {
          setConnectionStatus('disconnected');
        }
      };
    });
  };

  const setupWebSocketHandlers = (ws: WebSocket) => {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
          setTranscriptionId(data.transcriptionId);
          setError(null);
        } else if (data.type === 'status') {
          if (data.message) {
            console.log('Status:', data.message);
          }
        } else if (data.type === 'transcription') {
          if (data.isFinal) {
            setSegments((prev) => {
              const newSegments = [
                ...prev,
                {
                  text: data.text,
                  isFinal: true,
                  speakerId: data.speakerId,
                  timestamp: Date.now(),
                },
              ];
              if (newSegments.length > 100) {
                return newSegments.slice(newSegments.length - 100);
              }
              return newSegments;
            });
            setPartialText('');
          } else {
            setPartialText(data.text);
          }
        } else if (data.type === 'ready') {
          console.log('Transcription service ready');
        } else if (data.type === 'error') {
          setError(data.error);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };
  };

  const startRecording = async () => {
    try {
      setError(null);
      setConnectionStatus('connecting');
      setRecordingDuration(0);
      setSegments([]);
      setPartialText('');

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // Create MediaRecorder to save recording
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
            audioChunksRef.current.splice(0, audioChunksRef.current.length - MAX_AUDIO_CHUNKS);
          }
        }
      };
      mediaRecorder.start(1000);

      // Connect WebSocket
      const ws = await connectWebSocket();
      wsRef.current = ws;
      setupWebSocketHandlers(ws);

      // Create AudioContext — try 16kHz, but browser may use device native rate
      let audioContext: AudioContext;
      try {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
        });
      } catch {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioContextRef.current = audioContext;
      const actualSampleRate = audioContext.sampleRate;
      const TARGET_SAMPLE_RATE = 16000;
      const needsResampling = actualSampleRate !== TARGET_SAMPLE_RATE;
      if (needsResampling) {
        console.log(`Audio resampling: ${actualSampleRate}Hz → ${TARGET_SAMPLE_RATE}Hz`);
      }

      // Downsample helper: convert Float32 samples from actualRate to targetRate, output Int16 PCM
      const downsampleToInt16 = (input: Float32Array): ArrayBuffer => {
        let samples = input;
        if (needsResampling) {
          const ratio = actualSampleRate / TARGET_SAMPLE_RATE;
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

      // Load AudioWorklet
      try {
        await audioContext.audioWorklet.addModule('/audio-processor.js');

        const workletNode = new AudioWorkletNode(audioContext, 'recorder-worklet', {
          processorOptions: { noiseThreshold },
        });
        audioWorkletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && ws.readyState === WebSocket.OPEN) {
            if (needsResampling) {
              // AudioWorklet sends Int16 at native rate; re-decode, resample, re-encode
              const int16 = new Int16Array(event.data.data);
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
              }
              ws.send(downsampleToInt16(float32));
            } else {
              ws.send(event.data.data);
            }
          }
        };

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);

        // Create AnalyserNode for audio level visualization
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);
      } catch (workletError) {
        console.warn('AudioWorklet not supported, falling back to ScriptProcessor:', workletError);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            ws.send(downsampleToInt16(inputData));
          }
        };

        // AnalyserNode for fallback path
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;
        source.connect(analyser);
        startAudioLevelMonitoring(analyser);
      }

      setIsRecording(true);

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setError(err.message || 'Failed to start recording');
      setConnectionStatus('disconnected');
    }
  };

  const stopRecording = useCallback(() => {
    // Clear timers
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (audioLevelIntervalRef.current) {
      cancelAnimationFrame(audioLevelIntervalRef.current);
      audioLevelIntervalRef.current = null;
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Disconnect AudioWorkletNode
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }

    setIsRecording(false);
    setConnectionStatus('disconnected');
    setAudioLevel(0);
  }, []);

  const handleStopAndNavigate = async () => {
    if (!transcriptionId) {
      stopRecording();
      return;
    }

    // Wait for MediaRecorder to finalize before uploading
    const waitForMediaRecorder = (): Promise<void> => {
      return new Promise((resolve) => {
        const recorder = mediaRecorderRef.current;
        if (!recorder || recorder.state === 'inactive') {
          resolve();
          return;
        }
        recorder.onstop = () => resolve();
        // Request final data then stop
        try { recorder.requestData(); } catch { /* ignore */ }
        recorder.stop();
      });
    };

    // Stop MediaRecorder first and wait for final chunk
    await waitForMediaRecorder();

    // Now stop everything else (WebSocket, AudioContext, etc.)
    // But don't call stopRecording() which would try to stop MediaRecorder again
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (audioLevelIntervalRef.current) {
      cancelAnimationFrame(audioLevelIntervalRef.current);
      audioLevelIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current = null;
    }
    setIsRecording(false);
    setConnectionStatus('disconnected');
    setAudioLevel(0);

    // Upload recorded audio
    const audioChunks = audioChunksRef.current;
    console.log(`[RealtimeRecord] Audio chunks to upload: ${audioChunks.length}`);
    if (audioChunks.length > 0) {
      setUploadingAudio(true);
      try {
        const mimeType = audioChunks[0]?.type || 'audio/webm';
        const audioBlob = new Blob(audioChunks, { type: mimeType });
        console.log(`[RealtimeRecord] Audio blob size: ${audioBlob.size}, type: ${mimeType}`);
        const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'webm';
        const formData = new FormData();
        formData.append('audio', audioBlob, `realtime-recording.${ext}`);

        // Get auth token
        let token: string | null = null;
        if (import.meta.env.DEV) {
          token = 'dev-token';
        } else {
          try {
            const rcStored = localStorage.getItem('rc_auth_user');
            if (rcStored) {
              const parsed = JSON.parse(rcStored);
              if (parsed._credential) token = parsed._credential;
            }
          } catch { /* ignore */ }
          if (!token) token = localStorage.getItem('auth_token');
        }

        const baseUrl = import.meta.env.DEV ? 'http://localhost:8081/api' : '/api';
        const uploadUrl = `${baseUrl}/transcriptions/${transcriptionId}/upload-audio`;
        console.log(`[RealtimeRecord] Uploading audio to: ${uploadUrl}`);
        const resp = await fetch(uploadUrl, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });
        if (!resp.ok) {
          console.error(`[RealtimeRecord] Upload failed: ${resp.status} ${resp.statusText}`);
          const text = await resp.text();
          console.error(`[RealtimeRecord] Response: ${text}`);
        } else {
          console.log('[RealtimeRecord] Audio uploaded successfully');
        }
      } catch (err) {
        console.error('[RealtimeRecord] Failed to upload audio:', err);
      } finally {
        setUploadingAudio(false);
      }
    } else {
      console.warn('[RealtimeRecord] No audio chunks to upload');
    }

    navigate(`/transcription/${transcriptionId}`);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/transcription')}
            className="text-slate-500 hover:text-slate-700 text-sm"
          >
            &larr; Back
          </button>
          <h1 className="text-base font-semibold text-slate-800">Real-time Transcription</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <span
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-green-100 text-green-700'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-slate-400'
              }`}
            />
            {connectionStatus === 'connected'
              ? 'Connected'
              : connectionStatus === 'connecting'
              ? 'Connecting...'
              : 'Disconnected'}
          </span>
          {/* Duration */}
          {(isRecording || recordingDuration > 0) && (
            <span className="text-xs font-mono text-slate-500">{formatDuration(recordingDuration)}</span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700 font-medium">
            Dismiss
          </button>
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 shrink-0">
        {/* Record / Stop button */}
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={uploadingAudio}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span className="w-3 h-3 rounded-full bg-white" />
            {uploadingAudio ? 'Uploading...' : 'Start Recording'}
          </button>
        ) : (
          <button
            onClick={handleStopAndNavigate}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span className="w-3 h-3 rounded bg-white" />
            Stop & Save
          </button>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <span className="flex items-center gap-1.5 text-xs text-red-600">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Recording
          </span>
        )}

        {/* Audio level bar */}
        <div className="flex-1 max-w-xs">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-75"
              style={{ width: `${audioLevel}%` }}
            />
          </div>
        </div>

        {/* Settings toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          disabled={isRecording}
          className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
            showSettings
              ? 'bg-blue-50 border-blue-300 text-blue-600'
              : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
          } disabled:opacity-50`}
        >
          Settings
        </button>
      </div>

      {/* Settings panel (collapsible) */}
      {showSettings && !isRecording && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-xs">
            {/* Model */}
            <div>
              <label className="block text-slate-500 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"
              >
                <option value="paraformer-realtime-v2">Paraformer Realtime v2</option>
                <option value="paraformer-realtime-v1">Paraformer Realtime v1</option>
                <option value="fun-asr-realtime">FunASR Realtime</option>
                <option value="qwen3-asr-flash-realtime">Qwen3-ASR Flash Realtime (最新)</option>
              </select>
            </div>

            {/* Sample Rate */}
            <div>
              <label className="block text-slate-500 mb-1">Sample Rate</label>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value))}
                className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"
              >
                <option value={16000}>16000 Hz</option>
                <option value={8000}>8000 Hz</option>
              </select>
            </div>

            {/* Noise Threshold */}
            <div>
              <label className="block text-slate-500 mb-1">Noise Threshold: {noiseThreshold}</label>
              <input
                type="range"
                min={0}
                max={2000}
                step={50}
                value={noiseThreshold}
                onChange={(e) => setNoiseThreshold(Number(e.target.value))}
                className="w-full accent-slate-500"
              />
            </div>

            {/* Speaker Diarization */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="speakerDiarization"
                checked={enableSpeakerDiarization}
                onChange={(e) => setEnableSpeakerDiarization(e.target.checked)}
                className="accent-blue-500"
              />
              <label htmlFor="speakerDiarization" className="text-slate-600">Speaker Diarization</label>
            </div>

            {/* Punctuation */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="punctuation"
                checked={enablePunctuation}
                onChange={(e) => setEnablePunctuation(e.target.checked)}
                className="accent-blue-500"
              />
              <label htmlFor="punctuation" className="text-slate-600">Auto Punctuation</label>
            </div>

            {/* Disfluency Removal */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="disfluencyRemoval"
                checked={enableDisfluencyRemoval}
                onChange={(e) => setEnableDisfluencyRemoval(e.target.checked)}
                className="accent-blue-500"
              />
              <label htmlFor="disfluencyRemoval" className="text-slate-600">Remove Filler Words (嗯、啊、就是...)</label>
            </div>

            {/* Turn Detection Silence */}
            <div>
              <label className="block text-slate-500 mb-1">Silence Duration: {turnDetectionSilenceDuration}ms</label>
              <input
                type="range"
                min={200}
                max={2000}
                step={100}
                value={turnDetectionSilenceDuration}
                onChange={(e) => setTurnDetectionSilenceDuration(Number(e.target.value))}
                className="w-full accent-slate-500"
              />
            </div>

            {/* Turn Detection Threshold */}
            <div>
              <label className="block text-slate-500 mb-1">Turn Threshold: {turnDetectionThreshold}</label>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={turnDetectionThreshold}
                onChange={(e) => setTurnDetectionThreshold(Number(e.target.value))}
                className="w-full accent-slate-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Transcription area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {segments.length === 0 && !partialText && !isRecording && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <p className="text-sm">Click "Start Recording" to begin real-time transcription</p>
            <p className="text-xs mt-1 text-slate-300">Uses Qwen Paraformer Realtime V2</p>
          </div>
        )}

        {segments.length === 0 && !partialText && isRecording && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mb-3" />
            <p className="text-sm">Listening... speak into your microphone</p>
          </div>
        )}

        {segments.map((segment, index) => (
          <div key={index} className="mb-2">
            {segment.speakerId && (
              <span className="inline-block text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mr-2 mb-0.5">
                Speaker {segment.speakerId}
              </span>
            )}
            <span className="text-sm text-slate-800 leading-relaxed">{segment.text}</span>
          </div>
        ))}

        {partialText && (
          <div className="mb-2">
            <span className="text-sm text-slate-400 italic leading-relaxed">{partialText}</span>
          </div>
        )}

        <div ref={transcriptionEndRef} />
      </div>
    </div>
  );
};

export default RealtimeRecordPage;
