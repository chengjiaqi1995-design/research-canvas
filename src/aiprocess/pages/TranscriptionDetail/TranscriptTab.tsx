import React from 'react';
import {
  Tag,
  List as AntdList,
  message,
} from 'antd';
import AudioPlayer from '../../components/AudioPlayer';
import type { AudioPlayerHandle } from '../../components/AudioPlayer';
import RichTextEditor from '../../components/RichTextEditor';
import type { Transcription } from '../../types';
import { parseTranscript, getSpeakerColor, formatTime } from '../../hooks/useAudioPlayback';
import styles from '../TranscriptionDetailPage.module.css';

interface TranscriptTabProps {
  transcription: Transcription;
  id: string | undefined;
  audioPlayerRef: React.RefObject<AudioPlayerHandle | null>;
  segmentRefs: React.MutableRefObject<{ [key: number]: HTMLDivElement | null }>;
  transcriptContentRef: React.RefObject<HTMLDivElement | null>;
  currentTime: number;
  handleAudioTimeUpdate: (time: number) => void;
  jumpToTime: (time: number) => void;
  getAudioUrl: () => string;
  getProviderText: (provider: string) => string;
  formatFileSize: (bytes: number) => string;
}

const TranscriptTab: React.FC<TranscriptTabProps> = ({
  transcription,
  id,
  audioPlayerRef,
  segmentRefs,
  transcriptContentRef,
  currentTime,
  handleAudioTimeUpdate,
  jumpToTime,
  getAudioUrl,
  getProviderText,
  formatFileSize,
}) => {
  return (
    <div className={styles.transcriptTabContent}>
      {/* 转录信息 - 仅转录类型显示 */}
      {transcription.type !== 'merge' && transcription.type !== 'note' && (
        <div style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: '#fafafa',
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 12,
          color: '#666',
        }}>
          <span>
            转录模型: {getProviderText(transcription.aiProvider)}
          </span>
          <span>
            文件大小: {formatFileSize(transcription.fileSize)}
          </span>
        </div>
      )}
      {/* 音频播放器 - 仅转录类型显示 */}
      {transcription.type !== 'merge' && transcription.type !== 'note' && (
        <div className={styles.audioPlayerContainer} style={{ marginBottom: 12, flexShrink: 0 }}>
          {id && transcription.filePath && (
            <AudioPlayer
              ref={audioPlayerRef}
              src={getAudioUrl()}
              onTimeUpdate={handleAudioTimeUpdate}
              onSeeked={handleAudioTimeUpdate}
              onError={() => message.error('音频加载失败，请检查文件是否存在')}
            />
          )}
          {id && !transcription.filePath && (
            <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '4px', color: '#999', fontSize: '13px' }}>
              实时转录 - 无音频文件
            </div>
          )}
          {!id && (
            <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '4px', color: '#999', fontSize: '13px' }}>
              暂无音频文件
            </div>
          )}
        </div>
      )}
      {/* 合并类型显示合并源信息 */}
      {transcription.type === 'merge' && transcription.mergeSources && transcription.mergeSources.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>合并源 ({transcription.mergeSources.length} 个):</h4>
          <AntdList
            size="small"
            dataSource={transcription.mergeSources}
            renderItem={(source, index) => (
              <AntdList.Item style={{ padding: '8px 0' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                    {source.title || `源 ${index + 1}`}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {source.content.replace(/<[^>]*>/g, '').substring(0, 100)}...
                  </div>
                </div>
              </AntdList.Item>
            )}
          />
        </div>
      )}
      <div className={styles.transcriptContent} ref={transcriptContentRef}>
        {(() => {
          const transcriptData = parseTranscript(transcription.transcriptText || '');
          // 对于合并类型，直接显示文本内容
          if (transcription.type === 'merge') {
            return (
              <div style={{ padding: 16 }}><RichTextEditor content={transcriptData.text || ""} onChange={() => { }} editable={false} hideToolbar={true} /></div>
            );
          }
          return transcriptData.segments && transcriptData.segments.length > 0 ? (
            <div className={styles.transcriptSegments}>
              {transcriptData.segments.map((segment: any, index: number) => {
                const startTime = segment.startTime || 0;
                const endTime = segment.endTime || startTime + 5;
                const isActive = currentTime >= startTime && currentTime < endTime;

                return (
                  <div
                    key={index}
                    ref={(el) => {
                      segmentRefs.current[index] = el;
                    }}
                    className={`${styles.transcriptSegment} ${isActive ? styles.active : ''}`}
                    onClick={() => jumpToTime(startTime)}
                    style={{ cursor: 'pointer' }}
                    title={`点击跳转到 ${formatTime(startTime)}`}
                  >
                    {segment.speakerId !== undefined && segment.speakerId !== null && (
                      <Tag
                        color={getSpeakerColor(segment.speakerId)}
                        style={{ marginRight: 8, marginBottom: 4 }}
                      >
                        说话人 {segment.speakerId + 1}
                      </Tag>
                    )}
                    {startTime > 0 && (
                      <span className={styles.timeStamp} style={{ marginRight: 8, color: '#999', fontSize: 12 }}>
                        {formatTime(startTime)}
                      </span>
                    )}
                    <span className={styles.transcriptSegmentText}>{segment.text}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              {/* 文字笔记不显示分段提示 */}
              {transcription.type !== 'note' && (
                <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', borderRadius: 4, fontSize: 13, color: '#d46b08' }}>
                  ℹ️ 此转录没有分段信息，无法进行时间点跳转。使用通义千问进行转录可获得分段和说话人信息。
                </div>
              )}
              <div style={{ padding: 12 }}><RichTextEditor content={transcriptData.text || "暂无转录内容"} onChange={() => { }} editable={false} hideToolbar={true} /></div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default TranscriptTab;
