import { useState, useCallback, useRef } from 'react';
import type { Transcription } from '../types';
import type { AudioPlayerHandle } from '../components/AudioPlayer';

// 解析转录文本（可能是 JSON 格式，包含分段信息）
export const parseTranscript = (transcriptText: string) => {
  if (!transcriptText) return { text: '', segments: [] };

  try {
    const parsed = JSON.parse(transcriptText);
    if (parsed.text && Array.isArray(parsed.segments)) {
      return parsed;
    }
  } catch (e) {
    // 如果不是 JSON，当作纯文本处理
  }

  return { text: transcriptText, segments: [] };
};

// 获取说话人颜色
export const getSpeakerColor = (speakerId: number) => {
  const colors = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'red', 'volcano', 'gold', 'lime'];
  return colors[speakerId % colors.length];
};

// 格式化时间
export const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function useAudioPlayback(
  transcription: Transcription | null,
  audioPlayerRef: React.RefObject<AudioPlayerHandle | null>
) {
  const [currentTime, setCurrentTime] = useState(0);
  const [lastActiveSegmentIndex, setLastActiveSegmentIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // 滚动到对应的文字段落
  const scrollToSegment = (index: number) => {
    const segmentElement = segmentRefs.current[index];
    if (segmentElement) {
      segmentElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  };

  // 跳转到音频时间点
  const jumpToTime = (time: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.seekTo(time);
      audioPlayerRef.current.play();
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
      audioRef.current.play();
    }
  };

  // 音频时间变化时同步转录文字高亮
  const handleAudioTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
    if (!transcription) return;
    const transcriptData = parseTranscript(transcription.transcriptText || '');
    if (transcriptData.segments && transcriptData.segments.length > 0) {
      const activeIndex = transcriptData.segments.findIndex((segment: any) => {
        const startTime = segment.startTime || 0;
        const endTime = segment.endTime || startTime + 5;
        return time >= startTime && time < endTime;
      });
      if (activeIndex !== -1 && activeIndex !== lastActiveSegmentIndex) {
        setLastActiveSegmentIndex(activeIndex);
        scrollToSegment(activeIndex);
      }
    }
  }, [transcription, lastActiveSegmentIndex]);

  return {
    currentTime,
    lastActiveSegmentIndex,
    audioRef,
    segmentRefs,
    handleAudioTimeUpdate,
    jumpToTime,
    scrollToSegment,
  };
}
