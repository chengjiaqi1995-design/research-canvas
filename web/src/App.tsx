import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ConnectionStatus = 'idle' | 'connecting' | 'recording' | 'saving';

interface Segment {
  text: string;
  speakerId?: number;
  timestamp: number;
}

interface TranscriptionRecord {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  duration: number;
  aiProvider: string;
  status: string;
  transcriptText: string;
  createdAt: string;
}

const API_BASE = '/api';
const FALLBACK_PCM_SAMPLE_RATE = 16000;
const MAX_FALLBACK_PCM_BYTES = 300 * 1024 * 1024;

function wsBase() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downsampleToInt16(input: Float32Array, sourceSampleRate: number): ArrayBuffer {
  const target = FALLBACK_PCM_SAMPLE_RATE;
  let samples = input;
  if (sourceSampleRate !== target) {
    const ratio = sourceSampleRate / target;
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
}

function buildWavBlobFromPcm(chunks: ArrayBuffer[], sampleRate = FALLBACK_PCM_SAMPLE_RATE) {
  const dataSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (!dataSize) return null;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return new Blob([header, ...chunks], { type: 'audio/wav' });
}

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [model, setModel] = useState('qwen3-asr-flash-realtime');
  const [language, setLanguage] = useState('zh');
  const [transcriptionId, setTranscriptionId] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [partialText, setPartialText] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [records, setRecords] = useState<TranscriptionRecord[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const pcmChunksRef = useRef<ArrayBuffer[]>([]);
  const pcmBytesRef = useRef(0);
  const levelTimerRef = useRef<number | null>(null);

  const fullText = useMemo(() => {
    return [...segments.map((segment) => segment.text), partialText].filter(Boolean).join(' ');
  }, [segments, partialText]);

  const log = useCallback((line: string) => {
    const value = `${new Date().toLocaleTimeString()} ${line}`;
    setLogs((current) => [value, ...current].slice(0, 80));
  }, []);

  const loadRecords = useCallback(async () => {
    const res = await fetch(`${API_BASE}/transcriptions`);
    const json = await res.json();
    setRecords(json.data || []);
  }, []);

  useEffect(() => {
    loadRecords().catch(() => undefined);
  }, [loadRecords]);

  const rememberPcmFrame = useCallback((frame: ArrayBuffer) => {
    if (pcmBytesRef.current + frame.byteLength > MAX_FALLBACK_PCM_BYTES) return;
    pcmChunksRef.current.push(frame.slice(0));
    pcmBytesRef.current += frame.byteLength;
  }, []);

  const cleanup = useCallback(() => {
    if (levelTimerRef.current) window.cancelAnimationFrame(levelTimerRef.current);
    levelTimerRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setStatus('connecting');
    setSegments([]);
    setPartialText('');
    setTranscriptionId(null);
    mediaChunksRef.current = [];
    pcmChunksRef.current = [];
    pcmBytesRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;

      const wsUrl = `${wsBase()}/ws/realtime-transcription?${new URLSearchParams({
        model,
        language,
        sampleRate: '16000',
        enableSpeakerDiarization: 'true',
      }).toString()}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'session_created') {
          setTranscriptionId(data.transcriptionId);
          log(`session created: ${data.transcriptionId}`);
        } else if (data.type === 'ready') {
          log('ASR ready');
        } else if (data.type === 'partial') {
          setPartialText(data.text || '');
        } else if (data.type === 'transcription') {
          setSegments((current) => [...current, { text: data.text, speakerId: data.speakerId, timestamp: data.timestamp || Date.now() }]);
          setPartialText('');
        } else if (data.type === 'log') {
          log(`[${data.source}] ${data.message}`);
        } else if (data.type === 'error') {
          log(`[error] ${data.error}`);
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
      });

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule('/audio-processor.js');
      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioContext, 'recorder-worklet');
      workletRef.current = worklet;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(worklet);
      source.connect(analyser);

      const sourceSampleRate = audioContext.sampleRate;
      worklet.port.onmessage = (event) => {
        if (event.data.type !== 'audioData') return;
        if (ws.readyState !== WebSocket.OPEN) return;
        let pcmFrame: ArrayBuffer;
        if (sourceSampleRate !== FALLBACK_PCM_SAMPLE_RATE) {
          const int16 = new Int16Array(event.data.data);
          const float32 = new Float32Array(int16.length);
          for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
          }
          pcmFrame = downsampleToInt16(float32, sourceSampleRate);
        } else {
          pcmFrame = event.data.data;
        }
        rememberPcmFrame(pcmFrame);
        ws.send(pcmFrame);
      };

      const levelData = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(levelData);
        setAudioLevel(Math.min(100, (levelData.reduce((sum, v) => sum + v, 0) / levelData.length / 255) * 100));
        levelTimerRef.current = window.requestAnimationFrame(updateLevel);
      };
      updateLevel();

      setStatus('recording');
      log('recording started');
    } catch (error) {
      cleanup();
      setStatus('idle');
      log(`[start failed] ${(error as Error).message}`);
    }
  }, [cleanup, language, log, model, rememberPcmFrame]);

  const uploadAudio = useCallback(async (id: string) => {
    let uploaded = false;
    const chunks = [...mediaChunksRef.current];
    const pcmChunks = [...pcmChunksRef.current];

    async function uploadBlob(blob: Blob, fileName: string, label: string) {
      const formData = new FormData();
      formData.append('audio', blob, fileName);
      const res = await fetch(`${API_BASE}/transcriptions/${id}/upload-audio`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`${label} upload failed: ${res.status}`);
      log(`${label} uploaded (${formatBytes(blob.size)})`);
    }

    if (chunks.length) {
      const mimeType = chunks[0]?.type || 'audio/webm';
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size > 100) {
        await uploadBlob(blob, `realtime-recording.${ext}`, 'MediaRecorder audio');
        uploaded = true;
      }
    }

    if (!uploaded) {
      const wavBlob = buildWavBlobFromPcm(pcmChunks);
      if (wavBlob && wavBlob.size > 100) {
        await uploadBlob(wavBlob, 'realtime-recording.wav', 'fallback WAV audio');
        uploaded = true;
      }
    }

    if (!uploaded) throw new Error('No usable audio data to upload');
  }, [log]);

  const stopAndSave = useCallback(async () => {
    const id = transcriptionId;
    if (!id) {
      log('No transcription id yet; stop ignored.');
      return;
    }

    setStatus('saving');
    await new Promise<void>((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve();
        return;
      }
      recorder.onstop = () => resolve();
      try { recorder.requestData(); } catch {}
      recorder.stop();
    });

    wsRef.current?.close();
    wsRef.current = null;
    cleanup();

    const payload = {
      text: fullText,
      segments,
    };
    await fetch(`${API_BASE}/transcriptions/${id}/save-text`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcriptText: payload }),
    });
    await uploadAudio(id);

    log('saved');
    setStatus('idle');
    setAudioLevel(0);
    await loadRecords();
  }, [cleanup, fullText, loadRecords, log, segments, transcriptionId, uploadAudio]);

  return (
    <main className="app">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Realtime ASR Demo</p>
          <h1>实时转录模块</h1>
          <p className="sub">Browser PCM → Node WebSocket → Python DashScope/Qwen ASR → saved transcript/audio.</p>
        </div>
        <div className="controls">
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={status !== 'idle'}>
            <option value="qwen3-asr-flash-realtime">Qwen3 ASR Realtime</option>
            <option value="paraformer-realtime-v2">Paraformer Realtime v2</option>
          </select>
          <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={status !== 'idle'}>
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="mixed">Mixed</option>
          </select>
          {status === 'idle' ? (
            <button className="primary" onClick={start}>开始录音</button>
          ) : (
            <button className="primary" onClick={stopAndSave} disabled={status === 'saving'}>
              {status === 'saving' ? '保存中...' : '停止并保存'}
            </button>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="row">
            <h2>Live Transcript</h2>
            <span className={`badge ${status}`}>{status}</span>
          </div>
          <div className="meter"><span style={{ width: `${audioLevel}%` }} /></div>
          <div className="transcript">
            {segments.map((segment, index) => (
              <p key={`${segment.timestamp}-${index}`}>
                <b>Speaker {segment.speakerId ?? 0}</b>
                {segment.text}
              </p>
            ))}
            {partialText && <p className="partial"><b>Partial</b>{partialText}</p>}
            {!segments.length && !partialText && <p className="empty">等待转录内容...</p>}
          </div>
        </div>

        <div className="panel">
          <h2>Saved Recordings</h2>
          <div className="records">
            {records.map((record) => (
              <article key={record.id} className="record">
                <div>
                  <strong>{record.fileName}</strong>
                  <span>{record.aiProvider} · {record.status} · {formatBytes(record.fileSize)}</span>
                </div>
                {record.filePath ? (
                  <audio src={`${API_BASE}/transcriptions/${record.id}/audio`} controls />
                ) : (
                  <span className="no-audio">No audio file</span>
                )}
              </article>
            ))}
            {!records.length && <p className="empty">暂无保存记录</p>}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Logs</h2>
        <pre>{logs.join('\n') || 'No logs yet.'}</pre>
      </section>
    </main>
  );
}

