import React, { useState, useCallback } from 'react';
import {
  Button,
  Input,
  Modal,
  Select,
  Tooltip,
  Tag,
} from 'antd';
import {
  EditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { Transcription } from '../../types';
import type { MetadataField, MetadataFormValues } from '../../hooks/useMetadataEditor';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import { aiApi } from '../../../db/apiClient';
import { getApiConfig } from '../../components/ApiConfigModal';
import styles from '../TranscriptionDetailPage.module.css';

interface MetadataHeaderProps {
  transcription: Transcription;
  // File name editing
  editingFileName: boolean;
  editedFileName: string;
  setEditedFileName: (v: string) => void;
  handleSaveFileName: () => void;
  handleStartEditFileName: () => void;
  handleCancelEditFileName: () => void;
  // Metadata modal
  showMetadataModal: boolean;
  editedMetadata: MetadataFormValues;
  setEditedMetadata: React.Dispatch<React.SetStateAction<MetadataFormValues>>;
  industries: string[];
  handleOpenMetadataModal: () => void;
  handleSaveMetadata: () => void;
  handleCloseMetadataModal: () => void;
  // Legacy single-field edit (kept for double-click)
  editingMetadata: MetadataField | null;
  handleStartEditMetadata: (field: MetadataField) => void;
  handleCancelEditMetadata: () => void;
  formatParticipants: (participants: string | undefined | null) => string;
  // Tags (inline in title row)
  tagsNode?: React.ReactNode;
  // Processing status
  onReprocess?: () => void;
}

const FIELD_LABELS: Record<MetadataField, string> = {
  topic: '主题',
  organization: '公司',
  intermediary: '中介',
  industry: '行业',
  country: '国家',
  participants: '参与人',
  eventDate: '发生时间',
  speaker: '演讲人',
};

const MetadataHeader: React.FC<MetadataHeaderProps> = ({
  transcription,
  editingFileName,
  editedFileName,
  setEditedFileName,
  handleSaveFileName,
  handleStartEditFileName,
  handleCancelEditFileName,
  showMetadataModal,
  editedMetadata,
  setEditedMetadata,
  industries,
  handleOpenMetadataModal,
  handleSaveMetadata,
  handleCloseMetadataModal,
  editingMetadata,
  handleStartEditMetadata,
  handleCancelEditMetadata,
  formatParticipants,
  tagsNode,
  onReprocess,
}) => {
  const { isReadOnly } = useReadOnly();
  const [aiLoading, setAiLoading] = useState(false);

  // AI assist: fill metadata from transcript
  const handleAiFill = useCallback(async () => {
    if (!transcription?.transcriptText && !transcription?.summary) return;
    setAiLoading(true);

    try {
      const config = getApiConfig();
      const namingModel = config.namingModel || 'gemini-3-flash';

      const systemPrompt = `你是一个金融研究助手。根据会议/通话的转录文本和总结，提取以下元数据字段。

要求：
- topic: 会议主题，简洁描述（20字以内）
- organization: 涉及的主要公司名称
- intermediary: 中介机构（券商、咨询公司等），没有则留空
- industry: 行业分类
- country: 国家/地区（中国/美国/日本/韩国/欧洲/印度/其他）
- participants: 参与人类型，只能是 management / expert / sellside 之一
- eventDate: 会议发生的大致日期，格式如 2024/3/15，如果无法判断则留空
- speaker: 演讲人/嘉宾的姓名，如果有多位用逗号分隔

严格按 JSON 格式输出，不要任何解释：
{"topic":"","organization":"","intermediary":"","industry":"","country":"","participants":"","eventDate":"","speaker":""}`;

      const textSnippet = (transcription.transcriptText || '').slice(0, 3000);
      const summarySnippet = (transcription.summary || '').slice(0, 1500);

      let result = '';
      for await (const event of aiApi.chatStream({
        model: namingModel,
        messages: [{ role: 'user', content: `转录文本（前3000字）：\n${textSnippet}\n\n总结：\n${summarySnippet}` }],
        systemPrompt,
      })) {
        if (event.type === 'text' && event.content) {
          result += event.content;
        }
      }

      // Parse JSON from response
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setEditedMetadata((prev) => ({
          topic: parsed.topic || prev.topic,
          organization: parsed.organization || prev.organization,
          intermediary: parsed.intermediary || prev.intermediary,
          industry: parsed.industry || prev.industry,
          country: parsed.country || prev.country,
          participants: parsed.participants || prev.participants,
          eventDate: parsed.eventDate || prev.eventDate,
          speaker: parsed.speaker || prev.speaker,
        }));
      }
    } catch (err) {
      console.error('AI metadata extraction failed:', err);
    } finally {
      setAiLoading(false);
    }
  }, [transcription, setEditedMetadata]);

  // Compact processing status indicator
  const renderStatusBadge = () => {
    const status = transcription.status;
    if (status === 'processing') {
      const step = transcription.processingStep;
      const steps = [
        { key: 'transcribing', label: '语音转文字' },
        { key: 'summarizing', label: 'AI 总结生成' },
        { key: 'extracting_metadata', label: '元数据提取' },
        { key: 'finalizing', label: '保存结果' },
      ];
      const currentIdx = steps.findIndex(s => s.key === step);
      const currentLabel = currentIdx >= 0 ? steps[currentIdx].label : '处理中';
      const progress = `${Math.max(currentIdx, 0) + 1}/${steps.length}`;

      const tooltipContent = (
        <div style={{ fontSize: 12 }}>
          {steps.map((s, idx) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {idx < currentIdx ? (
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />
              ) : idx === currentIdx ? (
                <LoadingOutlined style={{ color: '#1890ff', fontSize: 11 }} />
              ) : (
                <span style={{ display: 'inline-block', width: 11, height: 11, borderRadius: '50%', border: '1px solid #666', boxSizing: 'border-box' }} />
              )}
              <span style={{ color: idx === currentIdx ? '#1890ff' : idx < currentIdx ? '#52c41a' : '#999' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      );

      return (
        <Tooltip title={tooltipContent} placement="bottomRight">
          <Tag icon={<SyncOutlined spin />} color="processing" style={{ cursor: 'default', marginRight: 0 }}>
            {currentLabel} ({progress})
          </Tag>
        </Tooltip>
      );
    }

    if (status === 'failed') {
      return (
        <Tooltip title={transcription.errorMessage || '处理失败'}>
          <Tag
            icon={<CloseCircleOutlined />}
            color="error"
            style={{ cursor: onReprocess ? 'pointer' : 'default', marginRight: 0 }}
            onClick={onReprocess}
          >
            失败 {onReprocess && <ReloadOutlined style={{ marginLeft: 4 }} />}
          </Tag>
        </Tooltip>
      );
    }

    return null;
  };

  // Render a single-field inline edit modal (legacy, for double-click)
  const renderSingleFieldModal = () => {
    if (!editingMetadata) return null;
    return (
      <Modal
        title={`编辑${FIELD_LABELS[editingMetadata]}`}
        open={true}
        onOk={handleSaveMetadata}
        onCancel={handleCancelEditMetadata}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        {editingMetadata === 'participants' ? (
          <Select
            value={editedMetadata.participants || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, participants: value })}
            placeholder="请选择参与人类型"
            style={{ width: '100%' }}
            autoFocus
          >
            <Select.Option value="management">Management</Select.Option>
            <Select.Option value="expert">Expert</Select.Option>
            <Select.Option value="sellside">Sellside</Select.Option>
          </Select>
        ) : editingMetadata === 'industry' ? (
          <Select
            value={editedMetadata.industry || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, industry: value })}
            placeholder="请选择行业"
            style={{ width: '100%' }}
            autoFocus
            showSearch
          >
            {industries.map(industry => (
              <Select.Option key={industry} value={industry}>{industry}</Select.Option>
            ))}
          </Select>
        ) : editingMetadata === 'country' ? (
          <Select
            value={editedMetadata.country || undefined}
            onChange={(value) => setEditedMetadata({ ...editedMetadata, country: value })}
            placeholder="请选择国家/地区"
            style={{ width: '100%' }}
            autoFocus
          >
            <Select.Option value="中国">中国</Select.Option>
            <Select.Option value="美国">美国</Select.Option>
            <Select.Option value="日本">日本</Select.Option>
            <Select.Option value="韩国">韩国</Select.Option>
            <Select.Option value="欧洲">欧洲</Select.Option>
            <Select.Option value="印度">印度</Select.Option>
            <Select.Option value="其他">其他</Select.Option>
          </Select>
        ) : (
          <Input
            value={editedMetadata[editingMetadata]}
            onChange={(e) => setEditedMetadata({ ...editedMetadata, [editingMetadata]: e.target.value })}
            onPressEnter={handleSaveMetadata}
            autoFocus
            placeholder={`请输入${FIELD_LABELS[editingMetadata]}`}
          />
        )}
      </Modal>
    );
  };

  // Full metadata editing modal
  const renderMetadataModal = () => {
    if (!showMetadataModal) return null;

    const fieldRow = (label: string, content: React.ReactNode) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ width: 60, fontSize: 13, color: '#666', textAlign: 'right', flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1 }}>{content}</div>
      </div>
    );

    return (
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>编辑元数据</span>
            <Button
              type="primary"
              ghost
              size="small"
              icon={aiLoading ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={handleAiFill}
              loading={aiLoading}
              style={{ marginRight: 24 }}
            >
              AI 填充
            </Button>
          </div>
        }
        open={true}
        onOk={handleSaveMetadata}
        onCancel={handleCloseMetadataModal}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <div style={{ padding: '8px 0' }}>
          {fieldRow('主题', (
            <Input
              value={editedMetadata.topic}
              onChange={(e) => setEditedMetadata(prev => ({ ...prev, topic: e.target.value }))}
              placeholder="会议/通话主题"
            />
          ))}
          {fieldRow('公司', (
            <Input
              value={editedMetadata.organization}
              onChange={(e) => setEditedMetadata(prev => ({ ...prev, organization: e.target.value }))}
              placeholder="主要涉及的公司"
            />
          ))}
          {fieldRow('演讲人', (
            <Input
              value={editedMetadata.speaker}
              onChange={(e) => setEditedMetadata(prev => ({ ...prev, speaker: e.target.value }))}
              placeholder="演讲人/嘉宾姓名"
            />
          ))}
          {fieldRow('中介', (
            <Input
              value={editedMetadata.intermediary}
              onChange={(e) => setEditedMetadata(prev => ({ ...prev, intermediary: e.target.value }))}
              placeholder="中介机构"
            />
          ))}
          {fieldRow('行业', (
            <Select
              value={editedMetadata.industry || undefined}
              onChange={(value) => setEditedMetadata(prev => ({ ...prev, industry: value }))}
              placeholder="选择行业"
              style={{ width: '100%' }}
              showSearch
              allowClear
            >
              {industries.map(ind => (
                <Select.Option key={ind} value={ind}>{ind}</Select.Option>
              ))}
            </Select>
          ))}
          {fieldRow('国家', (
            <Select
              value={editedMetadata.country || undefined}
              onChange={(value) => setEditedMetadata(prev => ({ ...prev, country: value }))}
              placeholder="选择国家/地区"
              style={{ width: '100%' }}
              allowClear
            >
              <Select.Option value="中国">中国</Select.Option>
              <Select.Option value="美国">美国</Select.Option>
              <Select.Option value="日本">日本</Select.Option>
              <Select.Option value="韩国">韩国</Select.Option>
              <Select.Option value="欧洲">欧洲</Select.Option>
              <Select.Option value="印度">印度</Select.Option>
              <Select.Option value="其他">其他</Select.Option>
            </Select>
          ))}
          {fieldRow('参与人', (
            <Select
              value={editedMetadata.participants || undefined}
              onChange={(value) => setEditedMetadata(prev => ({ ...prev, participants: value }))}
              placeholder="参与人类型"
              style={{ width: '100%' }}
              allowClear
            >
              <Select.Option value="management">Management</Select.Option>
              <Select.Option value="expert">Expert</Select.Option>
              <Select.Option value="sellside">Sellside</Select.Option>
            </Select>
          ))}
          {fieldRow('时间', (
            <Input
              value={editedMetadata.eventDate}
              onChange={(e) => setEditedMetadata(prev => ({ ...prev, eventDate: e.target.value }))}
              placeholder="如 2024/3/15"
            />
          ))}
        </div>
      </Modal>
    );
  };

  return (
    <>
      <div className={styles.summaryHeader}>
        <div style={{ flex: 1 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {editingFileName ? (
              <>
                <Input
                  value={editedFileName}
                  onChange={(e) => setEditedFileName(e.target.value)}
                  onPressEnter={handleSaveFileName}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Button type="primary" size="small" onClick={handleSaveFileName}>保存</Button>
                <Button size="small" onClick={handleCancelEditFileName}>取消</Button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '16px', fontWeight: 600, color: '#222', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {transcription.fileName}
                </span>
                {!isReadOnly && (
                  <Button type="text" icon={<EditOutlined />} size="small" onClick={handleStartEditFileName} title="编辑标题" />
                )}
                {renderStatusBadge()}
                {!isReadOnly && onReprocess && (
                  <Tooltip title="强制重新处理">
                    <Button type="text" icon={<ReloadOutlined />} size="small" onClick={onReprocess} style={{ color: '#999' }} />
                  </Tooltip>
                )}
                {tagsNode && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{tagsNode}</div>}
              </>
            )}
          </div>
          {/* Metadata info strip */}
          <div className={styles.metaInfo}>
            <div className={styles.metaInfoContent}>
              {!isReadOnly && (
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  size="small"
                  onClick={handleOpenMetadataModal}
                  style={{ marginRight: 4, color: '#1890ff', padding: '0 4px' }}
                  title="编辑元数据"
                />
              )}
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('topic')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                主题: {transcription.topic || '未提取'}
              </span>
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('organization')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                公司: {transcription.organization || '未知'}
              </span>
              {transcription.speaker && (
                <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('speaker')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                  演讲人: {transcription.speaker}
                </span>
              )}
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('intermediary')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                中介: {transcription.intermediary || '未知'}
              </span>
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('industry')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                行业: {transcription.industry || '未分类'}
              </span>
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('country')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                国家: {transcription.country || '未知'}
              </span>
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('participants')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                参与人: {formatParticipants(transcription.participants)}
              </span>
              <span className={styles.metaInfoItem} onDoubleClick={() => !isReadOnly && handleStartEditMetadata('eventDate')} style={{ cursor: isReadOnly ? 'default' : 'pointer' }} title={isReadOnly ? '' : '双击编辑'}>
                发生时间: {(() => {
                  if (transcription.eventDate && transcription.eventDate !== '未提及') {
                    return transcription.eventDate;
                  }
                  return new Date(transcription.createdAt).toLocaleDateString('zh-CN');
                })()}
              </span>
              <span className={`${styles.metaInfoItem} ${styles.metaInfoItemLast}`}>创建时间: {new Date(transcription.createdAt).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Single-field edit modal (double-click) */}
      {renderSingleFieldModal()}

      {/* Full metadata editing modal */}
      {renderMetadataModal()}
    </>
  );
};

export default MetadataHeader;
