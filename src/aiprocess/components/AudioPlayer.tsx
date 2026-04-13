import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
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
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  ({ src, onTimeUpdate, onSeeked, onError, onReady }, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [showVolume, setShowVolume] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);

    useImperativeHandle(ref, () => ({
      seekTo: (time: number) => {
        if (audioRef.current && duration > 0) {
          audioRef.current.currentTime = time;
        }
      },
      play: () => audioRef.current?.play(),
      pause: () => audioRef.current?.pause(),
      getCurrentTime: () => audioRef.current?.currentTime || 0,
    }));

    useEffect(() => {
      if (audioRef.current) {
        audioRef.current.volume = volume;
        audioRef.current.playbackRate = playbackRate;
      }
    }, [volume, playbackRate]);

    const handleTimeUpdate = useCallback(() => {
      if (!audioRef.current) return;
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    }, [onTimeUpdate]);

    const handleLoadedMetadata = useCallback(() => {
      if (!audioRef.current) return;
      const dur = audioRef.current.duration;
      if (isFinite(dur) && dur > 0) {
        setDuration(dur);
        onReady?.(dur);
      } else {
        // WebM/Opus recordings from MediaRecorder often have Infinity duration.
        // Workaround: seek to a very large time to force the browser to resolve the real duration.
        const audio = audioRef.current;
        const onSeeked = () => {
          audio.removeEventListener('seeked', onSeeked);
          const realDur = audio.duration;
          if (isFinite(realDur) && realDur > 0) {
            setDuration(realDur);
            onReady?.(realDur);
          }
          audio.currentTime = 0;
        };
        audio.addEventListener('seeked', onSeeked);
        audio.currentTime = 1e10; // seek to "end" to resolve duration
      }
    }, [onReady]);

    const togglePlay = useCallback(() => {
      if (!audioRef.current) return;
      if (audioRef.current.paused) {
        audioRef.current.play();
      } else {
        audioRef.current.pause();
      }
    }, []);

    const skipForward = useCallback(() => {
      if (audioRef.current) {
        audioRef.current.currentTime += 10;
      }
    }, []);

    const skipBackward = useCallback(() => {
      if (audioRef.current) {
        const nextTime = audioRef.current.currentTime - 10;
        audioRef.current.currentTime = nextTime < 0 ? 0 : nextTime;
      }
    }, []);

    const handleVolumeChange = useCallback((val: number) => {
      setVolume(val);
    }, []);

    const toggleRate = useCallback(() => {
      const rates = [1, 1.25, 1.5, 2, 0.75];
      const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
      const next = rates[nextIdx];
      setPlaybackRate(next);
    }, [playbackRate]);

    const onSliderChange = useCallback((val: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = val;
        setCurrentTime(val);
        onSeeked?.(val);
      }
    }, [onSeeked]);

    return (
      <div className="custom-audio-player flex flex-col gap-1 py-1 w-full">
        {/* Native Audio Element that powers streaming */}
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onError={(e) => onError?.(e)}
        />

        {/* Progress Slider */}
        <div className="w-full px-4 pt-1">
          <Slider
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={onSliderChange}
            tooltip={{ formatter: (v) => formatTime(v || 0) }}
            styles={{
              track: { background: '#1677ff' },
              rail: { background: '#e2e8f0' }
            }}
          />
        </div>

        {/* Controls */}
        <div className="player-controls flex items-center justify-between px-4 pb-1">
          <div className="player-controls-left flex items-center gap-4">
            <button className="player-btn flex items-center justify-center text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer" onClick={skipBackward} title="后退10秒">
              <BackwardOutlined className="text-base" />
            </button>
            <button className="player-btn flex items-center justify-center text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer" onClick={togglePlay}>
              {isPlaying ? <PauseCircleFilled className="text-2xl" /> : <PlayCircleFilled className="text-2xl" />}
            </button>
            <button className="player-btn flex items-center justify-center text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer" onClick={skipForward} title="前进10秒">
              <ForwardOutlined className="text-base" />
            </button>
          </div>

          <div className="player-time text-xs text-slate-500 font-mono tracking-wider">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="player-controls-right flex items-center gap-3">
            <button className="player-btn flex items-center justify-center text-slate-500 hover:text-indigo-600 font-bold w-8 text-center cursor-pointer transition-colors text-xs" onClick={toggleRate} title="播放速度">
              {playbackRate}x
            </button>
            <div
              className="player-volume-wrapper relative flex items-center justify-center"
              onMouseEnter={() => setShowVolume(true)}
              onMouseLeave={() => setShowVolume(false)}
            >
              <button className="player-btn flex items-center justify-center text-slate-500 hover:text-indigo-600 cursor-pointer transition-colors" title="音量">
                {volume === 0 ? <SoundOutlined className="text-base" /> : <SoundFilled className="text-base" />}
              </button>
              {showVolume && (
                <div className="player-volume-popup absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-white px-3 py-4 rounded-xl shadow-xl border border-slate-100 z-50 transition-opacity">
                  <Slider
                    vertical
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={handleVolumeChange}
                    tooltip={{ formatter: (v) => `${Math.round((v || 0) * 100)}%` }}
                    style={{ height: 100, margin: 0 }}
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
