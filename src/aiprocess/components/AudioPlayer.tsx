import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';
import {
  PlayCircleFilled,
  PauseCircleFilled,
  SoundOutlined,
  SoundFilled,
  ForwardOutlined,
  BackwardOutlined,
} from '@ant-design/icons';
import { Slider } from 'antd';

export interface AudioPlayerHandle {
  seekTo: (time: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
}

interface AudioPlayerProps {
  src: string;
  onTimeUpdate?: (time: number) => void;
  onSeeked?: (time: number) => void;
  onError?: (error: any) => void;
  onReady?: (duration: number) => void;
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  ({ src, onTimeUpdate, onSeeked, onError, onReady }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [showVolume, setShowVolume] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (wavesurferRef.current && duration > 0) {
          wavesurferRef.current.seekTo(time / duration);
        }
      },
      play: () => wavesurferRef.current?.play(),
      pause: () => wavesurferRef.current?.pause(),
      getCurrentTime: () => wavesurferRef.current?.getCurrentTime() || 0,
    }));

    useEffect(() => {
      if (!containerRef.current || !src) return;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#b0b8c8',
        progressColor: '#1677ff',
        cursorColor: '#1677ff',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 48,
        normalize: true,
        backend: 'MediaElement',
        mediaControls: false,
      });

      ws.load(src);

      ws.on('ready', () => {
        const dur = ws.getDuration();
        setDuration(dur);
        ws.setVolume(volume);
        onReady?.(dur);
      });

      ws.on('audioprocess', () => {
        const time = ws.getCurrentTime();
        setCurrentTime(time);
        onTimeUpdate?.(time);
      });

      ws.on('seeking', () => {
        const time = ws.getCurrentTime();
        setCurrentTime(time);
        onSeeked?.(time);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => setIsPlaying(false));

      ws.on('error', (err) => {
        console.error('WaveSurfer error:', err);
        onError?.(err);
      });

      wavesurferRef.current = ws;

      return () => {
        ws.destroy();
        wavesurferRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    const togglePlay = useCallback(() => {
      wavesurferRef.current?.playPause();
    }, []);

    const skipForward = useCallback(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.skip(10);
      }
    }, []);

    const skipBackward = useCallback(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.skip(-10);
      }
    }, []);

    const handleVolumeChange = useCallback((val: number) => {
      setVolume(val);
      wavesurferRef.current?.setVolume(val);
    }, []);

    const toggleRate = useCallback(() => {
      const rates = [1, 1.25, 1.5, 2, 0.75];
      const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
      const next = rates[nextIdx];
      setPlaybackRate(next);
      if (wavesurferRef.current) {
        wavesurferRef.current.setPlaybackRate(next);
      }
    }, [playbackRate]);

    return (
      <div className="custom-audio-player">
        {/* Waveform */}
        <div ref={containerRef} className="waveform-container" />

        {/* Controls */}
        <div className="player-controls">
          <div className="player-controls-left">
            <button className="player-btn" onClick={skipBackward} title="后退10秒">
              <BackwardOutlined />
            </button>
            <button className="player-btn player-btn-play" onClick={togglePlay}>
              {isPlaying ? <PauseCircleFilled /> : <PlayCircleFilled />}
            </button>
            <button className="player-btn" onClick={skipForward} title="前进10秒">
              <ForwardOutlined />
            </button>
          </div>

          <div className="player-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="player-controls-right">
            <button className="player-btn player-rate-btn" onClick={toggleRate} title="播放速度">
              {playbackRate}x
            </button>
            <div
              className="player-volume-wrapper"
              onMouseEnter={() => setShowVolume(true)}
              onMouseLeave={() => setShowVolume(false)}
            >
              <button className="player-btn" title="音量">
                {volume === 0 ? <SoundOutlined /> : <SoundFilled />}
              </button>
              {showVolume && (
                <div className="player-volume-popup">
                  <Slider
                    vertical
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={handleVolumeChange}
                    tooltip={{ formatter: (v) => `${Math.round((v || 0) * 100)}%` }}
                    style={{ height: 80 }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
