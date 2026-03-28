import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRecordingStore } from '../store/recordingStore';

/**
 * Floating recording indicator shown on non-realtime pages
 * when a recording session is active in the background.
 */
const RecordingIndicator: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isRecording = useRecordingStore((s) => s.isRecording);
  const isPaused = useRecordingStore((s) => s.isPaused);
  const recordingDuration = useRecordingStore((s) => s.recordingDuration);
  const segments = useRecordingStore((s) => s.segments);
  const partialText = useRecordingStore((s) => s.partialText);

  // Only show when recording is active AND user is NOT on the realtime page
  if (!isRecording || location.pathname === '/realtime') return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Show latest text snippet
  const latestText = partialText || (segments.length > 0 ? segments[segments.length - 1].text : '');
  const truncated = latestText.length > 40 ? latestText.slice(0, 40) + '...' : latestText;

  return (
    <div
      onClick={() => navigate('/realtime')}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        background: isPaused ? '#f59e0b' : '#ef4444',
        color: '#fff',
        borderRadius: 12,
        padding: '10px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        maxWidth: 360,
        transition: 'all 0.2s',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      title="点击返回实时转录"
    >
      {/* Pulsing dot */}
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#fff',
          flexShrink: 0,
          animation: isPaused ? 'none' : 'pulse-dot 1.5s ease-in-out infinite',
        }}
      />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{isPaused ? '录音已暂停' : '录音中'}</span>
          <span style={{ fontFamily: 'monospace', opacity: 0.9 }}>{formatDuration(recordingDuration)}</span>
        </div>
        {truncated && (
          <div style={{ fontSize: 11, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
            {truncated}
          </div>
        )}
      </div>

      <span style={{ fontSize: 11, opacity: 0.7, flexShrink: 0, marginLeft: 4 }}>
        返回 →
      </span>

      {/* Keyframe animation for pulsing dot */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
};

export default RecordingIndicator;
