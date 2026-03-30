import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordingStore } from '../store/recordingStore';

interface SelectionPopup {
  x: number;
  y: number;
  text: string;
}

const RealtimeRecordPage: React.FC = () => {
  const navigate = useNavigate();

  // ====== Read from global store ======
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isPaused = useRecordingStore((s) => s.isPaused);
  const connectionStatus = useRecordingStore((s) => s.connectionStatus);
  const segments = useRecordingStore((s) => s.segments);
  const partialText = useRecordingStore((s) => s.partialText);
  const error = useRecordingStore((s) => s.error);
  const connectionMessage = useRecordingStore((s) => s.connectionMessage);
  const audioLevel = useRecordingStore((s) => s.audioLevel);
  const recordingDuration = useRecordingStore((s) => s.recordingDuration);
  const uploadingAudio = useRecordingStore((s) => s.uploadingAudio);
  const highlights = useRecordingStore((s) => s.highlights);

  // Settings
  const noiseThreshold = useRecordingStore((s) => s.noiseThreshold);
  const model = useRecordingStore((s) => s.model);
  const enableSpeakerDiarization = useRecordingStore((s) => s.enableSpeakerDiarization);
  const enablePunctuation = useRecordingStore((s) => s.enablePunctuation);
  const sampleRate = useRecordingStore((s) => s.sampleRate);
  const turnDetectionSilenceDuration = useRecordingStore((s) => s.turnDetectionSilenceDuration);
  const turnDetectionThreshold = useRecordingStore((s) => s.turnDetectionThreshold);
  const enableDisfluencyRemoval = useRecordingStore((s) => s.enableDisfluencyRemoval);
  const audioSource = useRecordingStore((s) => s.audioSource);
  const language = useRecordingStore((s) => s.language);
  const commitStrongMin = useRecordingStore((s) => s.commitStrongMin);
  const commitWeakMin = useRecordingStore((s) => s.commitWeakMin);
  const commitForceLen = useRecordingStore((s) => s.commitForceLen);
  const commitBufferIsEnd = useRecordingStore((s) => s.commitBufferIsEnd);
  const commitSilTimeout = useRecordingStore((s) => s.commitSilTimeout);

  // Actions
  const startRecording = useRecordingStore((s) => s.startRecording);
  const stopAndSave = useRecordingStore((s) => s.stopAndSave);
  const togglePause = useRecordingStore((s) => s.togglePause);
  const clearError = useRecordingStore((s) => s.clearError);
  const addHighlight = useRecordingStore((s) => s.addHighlight);
  const removeHighlight = useRecordingStore((s) => s.removeHighlight);
  const updateHighlightNote = useRecordingStore((s) => s.updateHighlightNote);

  // ====== Local UI state ======
  const [showSettings, setShowSettings] = useState(false);
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(true);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);

  const transcriptAreaRef = useRef<HTMLDivElement>(null);
  const transcriptionEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    transcriptionEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments, partialText]);

  // NOTE: No cleanup on unmount! Recording continues in the global store.

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleStopAndNavigate = async () => {
    const savedId = await stopAndSave();
    if (savedId) {
      navigate(`/transcription/${savedId}`);
    }
  };

  // Text selection for key points
  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
    const selectedText = selection.toString().trim();
    if (selectedText.length < 2) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = transcriptAreaRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setSelectionPopup({
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top - containerRect.top - 8,
      text: selectedText,
    });
  }, []);

  const addSelectionHighlight = useCallback(() => {
    if (!selectionPopup) return;
    addHighlight(selectionPopup.text);
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionPopup, addHighlight]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectionPopup && !(e.target as HTMLElement)?.closest?.('.selection-popup-btn')) {
        setSelectionPopup(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectionPopup]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 border-b border-slate-200 shrink-0" style={{ minHeight: 38 }}>
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-800">实时转录</h1>
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
          {/* Highlights panel toggle */}
          <button
            onClick={() => setShowHighlightsPanel(!showHighlightsPanel)}
            className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
              showHighlightsPanel
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
            title="Toggle highlights panel"
          >
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
              {highlights.length > 0 && <span>{highlights.length}</span>}
            </span>
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={clearError} className="ml-2 text-red-500 hover:text-red-700 font-medium">
            Dismiss
          </button>
        </div>
      )}

      {connectionMessage && !error && (
        <div className={`mx-4 mt-3 p-2.5 rounded-lg text-sm flex items-center gap-2 ${
          connectionMessage.includes('成功') || connectionMessage.includes('success')
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-amber-50 border border-amber-200 text-amber-700'
        }`}>
          {connectionMessage.includes('成功') || connectionMessage.includes('success') ? (
            <span>✓</span>
          ) : (
            <span className="inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          )}
          {connectionMessage}
        </div>
      )}

      {/* Controls bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 shrink-0">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={uploadingAudio}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <span className="w-3 h-3 rounded-full bg-white" />
            {uploadingAudio ? '上传中...' : '开始录音'}
          </button>
        ) : (
          <>
            <button
              onClick={togglePause}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isPaused
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-yellow-500 hover:bg-yellow-600 text-white'
              }`}
            >
              {isPaused ? (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                  继续
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="3" width="6" height="18" /><rect x="14" y="3" width="6" height="18" /></svg>
                  暂停
                </>
              )}
            </button>
            <button
              onClick={handleStopAndNavigate}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <span className="w-3 h-3 rounded bg-white" />
              停止并保存
            </button>
          </>
        )}

        {/* Recording indicator */}
        {isRecording && (
          <span className="flex items-center gap-1.5 text-xs text-red-600">
            {isPaused ? (
              <>
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-yellow-600">已暂停</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                录音中
              </>
            )}
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

        {/* Audio source selector */}
        <select
          value={audioSource}
          onChange={(e) => useRecordingStore.getState().setAudioSource(e.target.value as 'mic' | 'system' | 'both')}
          disabled={isRecording}
          className="text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white text-slate-600 disabled:opacity-50"
        >
          <option value="mic">🎤 麦克风</option>
          <option value="system">🖥️ 系统内录</option>
          <option value="both">🎤+🖥️ 混合</option>
        </select>

        {/* Model selector */}
        <select
          value={model}
          onChange={(e) => useRecordingStore.getState().setModel(e.target.value)}
          disabled={isRecording}
          className="text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white text-slate-600 disabled:opacity-50"
        >
          <option value="paraformer-realtime-v2">Paraformer v2</option>
          <option value="fun-asr-realtime">FunASR</option>
          <option value="qwen3-asr-flash-realtime">Qwen3-ASR</option>
        </select>

        {/* Language selector */}
        <select
          value={language}
          onChange={(e) => useRecordingStore.getState().setLanguage(e.target.value as any)}
          disabled={isRecording}
          className="text-xs px-2 py-1.5 border border-slate-200 rounded-md bg-white text-slate-600 disabled:opacity-50"
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="mixed">中英混合</option>
        </select>

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
          设置
        </button>
      </div>

      {/* Settings panel (collapsible) — shows per-model per-language commit params */}
      {showSettings && !isRecording && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
          {/* All settings in one table */}
          {(() => {
            const isQwen3 = model === 'qwen3-asr-flash-realtime';
            const langKey = (language === 'en' || language === 'mixed') ? 'en' : 'zh';
            const commitDefaults: Record<string, Record<string, {strong_min: number, weak_min: number, force_len: number, buffer_is_end: number}>> = {
              'paraformer-realtime-v2': {
                zh: { strong_min: 5, weak_min: 50, force_len: 120, buffer_is_end: 3 },
                en: { strong_min: 25, weak_min: 60, force_len: 150, buffer_is_end: 10 },
              },
              'fun-asr-realtime': {
                zh: { strong_min: 8, weak_min: 60, force_len: 150, buffer_is_end: 5 },
                en: { strong_min: 40, weak_min: 120, force_len: 250, buffer_is_end: 20 },
              },
            };
            const cd = commitDefaults[model]?.[langKey] || commitDefaults['paraformer-realtime-v2'].zh;
            const silDefault = langKey === 'en' ? 1.0 : 0.8;
            const inputClass = (customized: boolean) =>
              `w-20 px-1.5 py-1 text-right font-mono text-xs border rounded outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${customized ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-700'}`;

            type Row = { label: string; hint: string; value: number | string | boolean; unit?: string; type: 'number' | 'select' | 'checkbox'; onChange: (v: any) => void; step?: number; customized?: boolean };
            const rows: Row[] = [
              { label: '采样率', hint: '音频采样率，一般不用改', value: sampleRate, unit: 'Hz', type: 'select', onChange: (v: string) => useRecordingStore.getState().setSampleRate(Number(v)) },
              { label: '噪音阈值', hint: '低于此 RMS 值的音频视为静音不发送。环境嘈杂调高，安静调低。0~2000', value: noiseThreshold, type: 'number', step: 50, onChange: (v: number) => useRecordingStore.getState().setNoiseThreshold(v) },
              { label: '说话人识别', hint: '多人对话时区分不同说话人（部分模型不支持）', value: enableSpeakerDiarization, type: 'checkbox', onChange: (v: boolean) => useRecordingStore.getState().setEnableSpeakerDiarization(v) },
              { label: '自动标点', hint: '自动添加标点符号', value: enablePunctuation, type: 'checkbox', onChange: (v: boolean) => useRecordingStore.getState().setEnablePunctuation(v) },
              { label: '去除语气词', hint: '过滤嗯、啊、就是等填充词', value: enableDisfluencyRemoval, type: 'checkbox', onChange: (v: boolean) => useRecordingStore.getState().setEnableDisfluencyRemoval(v) },
              { label: 'VAD 静默时长', hint: 'ASR 引擎判定一句话结束所需的静默时间。200~2000ms', value: turnDetectionSilenceDuration, unit: 'ms', type: 'number', step: 100, onChange: (v: number) => useRecordingStore.getState().setTurnDetectionSilenceDuration(v) },
              { label: 'VAD 阈值', hint: '语音活动检测灵敏度，越低越灵敏。0.1~0.9', value: turnDetectionThreshold, type: 'number', step: 0.05, onChange: (v: number) => useRecordingStore.getState().setTurnDetectionThreshold(v) },
            ];

            const commitRows: Row[] = isQwen3 ? [] : [
              { label: '强标点换行', hint: `遇到 .?! 时，文本至少多长才换行。越大行越长。中文 5~15 / 英文 25~60`, value: commitStrongMin || cd.strong_min, type: 'number', onChange: (v: number) => useRecordingStore.getState().setCommitStrongMin(v === cd.strong_min ? 0 : v), customized: !!commitStrongMin },
              { label: '弱标点换行', hint: `遇到逗号时，文本至少多长才换行。越大逗号处越不容易断。中文 40~80 / 英文 80~200`, value: commitWeakMin || cd.weak_min, type: 'number', onChange: (v: number) => useRecordingStore.getState().setCommitWeakMin(v === cd.weak_min ? 0 : v), customized: !!commitWeakMin },
              { label: '强制换行长度', hint: `无标点时的最大行长。超过此长度强制换行。中文 100~200 / 英文 150~400`, value: commitForceLen || cd.force_len, type: 'number', onChange: (v: number) => useRecordingStore.getState().setCommitForceLen(v === cd.force_len ? 0 : v), customized: !!commitForceLen },
              { label: '短文本合并', hint: `短于此长度的句子不单独成行，和下一句合并。越大合并越多。0~50`, value: commitBufferIsEnd || cd.buffer_is_end, type: 'number', onChange: (v: number) => useRecordingStore.getState().setCommitBufferIsEnd(v === cd.buffer_is_end ? 0 : v), customized: !!commitBufferIsEnd },
              { label: '静默超时', hint: `文本停止变化多久后强制换行。越大越不容易因停顿断句。0.5~3.0s`, value: commitSilTimeout || silDefault, unit: 's', type: 'number', step: 0.1, onChange: (v: number) => useRecordingStore.getState().setCommitSilTimeout(v === silDefault ? 0 : v), customized: !!commitSilTimeout },
            ];

            const renderRow = (r: Row) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 pr-3 text-slate-700 whitespace-nowrap font-medium">{r.label}</td>
                <td className="py-1.5 pr-3 text-slate-400 text-[11px]">{r.hint}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {r.type === 'checkbox' ? (
                    <input type="checkbox" checked={r.value as boolean} onChange={(e) => r.onChange(e.target.checked)} className="accent-blue-500" />
                  ) : r.type === 'select' ? (
                    <select value={r.value as number} onChange={(e) => r.onChange(e.target.value)} className="px-1.5 py-1 border border-slate-200 rounded text-xs bg-white text-slate-700">
                      <option value={16000}>16000</option>
                      <option value={8000}>8000</option>
                    </select>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <input type="number" step={r.step || 1} className={inputClass(!!r.customized)} value={r.value as number}
                        onChange={(e) => r.onChange(Number(e.target.value) || 0)} />
                      {r.unit && <span className="text-slate-400 text-[11px]">{r.unit}</span>}
                    </span>
                  )}
                </td>
              </tr>
            );

            return (
              <table className="w-full text-xs">
                <tbody>
                  {rows.map(renderRow)}
                  {commitRows.length > 0 && (
                    <tr className="border-b border-slate-200">
                      <td colSpan={3} className="pt-3 pb-1 text-[11px] font-medium text-slate-500">
                        断句策略
                        <span className="font-normal text-slate-400 ml-2">
                          {model === 'fun-asr-realtime' ? 'FunASR' : 'Paraformer v2'} / {langKey === 'en' ? 'English' : '中文'}
                          {(commitStrongMin || commitWeakMin || commitForceLen || commitBufferIsEnd || commitSilTimeout) ? ' · 橙色 = 已自定义' : ''}
                        </span>
                      </td>
                    </tr>
                  )}
                  {commitRows.map(renderRow)}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {/* Main content: transcription + highlights panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Transcription area */}
        <div
          ref={transcriptAreaRef}
          className={`flex-1 overflow-y-auto px-4 py-3 relative ${showHighlightsPanel ? 'border-r border-slate-200' : ''}`}
          onMouseUp={handleTextSelection}
        >
          {segments.length === 0 && !partialText && !isRecording && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <p className="text-sm">点击「开始录音」开始实时转录</p>
              <p className="text-xs mt-1 text-slate-300">使用 Qwen Paraformer Realtime V2</p>
            </div>
          )}

          {segments.length === 0 && !partialText && isRecording && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mb-3" />
              <p className="text-sm">正在聆听，请对着麦克风说话...</p>
            </div>
          )}

          {segments.map((segment, index) => (
            <div key={index} className="mb-0.5 px-1.5 py-0.5 -mx-1.5 rounded hover:bg-slate-50 transition-colors">
              {segment.speakerId && (
                <span className="inline-block text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mr-2 mb-0.5">
                  Speaker {segment.speakerId}
                </span>
              )}
              <span className="text-sm leading-snug text-slate-800">{segment.text}</span>
            </div>
          ))}

          {/* Selection popup */}
          {selectionPopup && (
            <button
              className="selection-popup-btn absolute z-50 flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg shadow-lg hover:bg-amber-600 transition-colors"
              style={{ left: selectionPopup.x, top: selectionPopup.y, transform: 'translate(-50%, -100%)' }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={addSelectionHighlight}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
              标记要点
            </button>
          )}

          {partialText && (
            <div className="mb-0.5 px-1.5">
              <span className="text-sm text-slate-400 italic leading-snug">{partialText}</span>
            </div>
          )}

          <div ref={transcriptionEndRef} />
        </div>

        {/* Highlights summary panel */}
        {showHighlightsPanel && (
          <div className="w-80 shrink-0 flex flex-col bg-slate-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-white shrink-0">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
                Key Points
                {highlights.length > 0 && (
                  <span className="text-xs font-normal text-slate-400">({highlights.length})</span>
                )}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {highlights.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center px-4">
                  <svg className="w-8 h-8 mb-2 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                  <p className="text-xs">选中文本后点击「标记要点」按钮</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {highlights.map((hl) => (
                    <div key={hl.id} className="bg-white rounded-lg border border-slate-200 p-2.5 shadow-sm">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <span className="text-[10px] text-slate-400">{formatTime(hl.timestamp)}</span>
                        <button
                          onClick={() => removeHighlight(hl.id)}
                          className="shrink-0 text-slate-300 hover:text-red-400 transition-colors p-0.5"
                          title="Remove"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed mb-1.5">{hl.text}</p>
                      {editingNoteId === hl.id ? (
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { updateHighlightNote(hl.id, editingNoteText); setEditingNoteId(null); }
                              else if (e.key === 'Escape') { setEditingNoteId(null); }
                            }}
                            placeholder="添加备注..."
                            className="flex-1 text-[11px] px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:border-amber-400"
                            autoFocus
                          />
                          <button
                            onClick={() => { updateHighlightNote(hl.id, editingNoteText); setEditingNoteId(null); }}
                            className="text-[10px] px-1.5 py-1 bg-amber-500 text-white rounded hover:bg-amber-600"
                          >OK</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingNoteId(hl.id); setEditingNoteText(hl.note); }}
                          className="text-[11px] text-slate-400 hover:text-amber-600 transition-colors"
                        >
                          {hl.note || '+ 添加备注'}
                        </button>
                      )}
                      {hl.note && editingNoteId !== hl.id && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 mt-1">{hl.note}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RealtimeRecordPage;
