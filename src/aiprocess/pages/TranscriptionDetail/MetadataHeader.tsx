import React from 'react';
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
} from '@ant-design/icons';
import type { Transcription } from '../../types';
import type { MetadataField } from '../../hooks/useMetadataEditor';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
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
  // Metadata editing
  editingMetadata: MetadataField | null;
  editedMetadata: {
    topic: string;
    organization: string;
    intermediary: string;
    industry: string;
    country: string;
    participants: string;
    eventDate: string;
  };
  setEditedMetadata: React.Dispatch<React.SetStateAction<{
    topic: string;
    organization: string;
    intermediary: string;
    industry: string;
    country: string;
    participants: string;
    eventDate: string;
  }>>;
  industries: string[];
  handleStartEditMetadata: (field: MetadataField) => void;
  handleSaveMetadata: () => void;
  handleCancelEditMetadata: () => void;
  formatParticipants: (participants: string | undefined | null) => string;
  // Tags (inline in title row)
  tagsNode?: React.ReactNode;
  // Processing status (compact indicator)
  onReprocess?: () => void;
}

const MetadataHeader: React.FC<MetadataHeaderProps> = ({
  transcription,
  editingFileName,
  editedFileName,
  setEditedFileName,
  handleSaveFileName,
  handleStartEditFileName,
  handleCancelEditFileName,
  editingMetadata,
  editedMetadata,
  setEditedMetadata,
  industries,
  handleStartEditMetadata,
  handleSaveMetadata,
  handleCancelEditMetadata,
  formatParticipants,
  tagsNode,
  onReprocess,
}) => {
  const { isReadOnly } = useReadOnly();

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

  return (
    <>
      <div className={styles.summaryHeader}>
        <div style={{ flex: 1 }}>
          {/* 原标题（可编辑） */}
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
                {/* 处理状态小标签 */}
                {renderStatusBadge()}
                {/* 强制重新处理按钮 */}
                {!isReadOnly && onReprocess && (
                  <Tooltip title="强制重新处理">
                    <Button
                      type="text"
                      icon={<ReloadOutlined />}
                      size="small"
                      onClick={onReprocess}
                      style={{ color: '#999' }}
                    />
                  </Tooltip>
                )}
                {/* 标签靠右 */}
                {tagsNode && <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{tagsNode}</div>}
              </>
            )}
          </div>
          <div className={styles.metaInfo}>
            <div className={styles.metaInfoContent}>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('topic')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                主题: {transcription.topic || '未提取'}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('organization')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                公司: {transcription.organization || '未知'}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('intermediary')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                中介: {transcription.intermediary || '未知'}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('industry')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                行业: {transcription.industry || '未分类'}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('country')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                国家: {transcription.country || '未知'}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('participants')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
                参与人: {formatParticipants(transcription.participants)}
              </span>
              <span
                className={styles.metaInfoItem}
                onDoubleClick={() => !isReadOnly && handleStartEditMetadata('eventDate')}
                style={{ cursor: isReadOnly ? 'default' : 'pointer' }}
                title={isReadOnly ? '' : '双击编辑'}
              >
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

      {/* 元数据编辑弹窗 */}
      {editingMetadata && (
        <Modal
          title={`编辑${editingMetadata === 'topic' ? '主题' :
            editingMetadata === 'organization' ? '公司' :
              editingMetadata === 'intermediary' ? '中介' :
                editingMetadata === 'industry' ? '行业' :
                  editingMetadata === 'country' ? '国家' :
                    editingMetadata === 'participants' ? '参与人' : '发生时间'
            }`}
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
              placeholder={`请输入${editingMetadata === 'topic' ? '主题' :
                editingMetadata === 'organization' ? '公司名称' :
                  editingMetadata === 'intermediary' ? '中介机构名称' :
                    editingMetadata === 'eventDate' ? '发生时间' : ''
                }`}
            />
          )}
        </Modal>
      )}
    </>
  );
};

export default MetadataHeader;
