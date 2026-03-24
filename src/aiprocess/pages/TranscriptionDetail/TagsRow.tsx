import React from 'react';
import {
  Button,
  Space,
  Tag,
  Input,
} from 'antd';
import {
  CloseOutlined,
} from '@ant-design/icons';
import type { Transcription } from '../../types';
import { useReadOnly } from '../../contexts/ReadOnlyContext';
import styles from '../TranscriptionDetailPage.module.css';

interface TagsRowProps {
  transcription: Transcription;
  editingTags: boolean;
  setEditingTags: (v: boolean) => void;
  tagInput: string;
  setTagInput: (v: string) => void;
  handleAddTag: () => void;
  handleRemoveTag: (tag: string) => void;
  handleKeyPressTag: (e: React.KeyboardEvent) => void;
}

const TagsRow: React.FC<TagsRowProps> = ({
  transcription,
  editingTags,
  setEditingTags,
  tagInput,
  setTagInput,
  handleAddTag,
  handleRemoveTag,
  handleKeyPressTag,
}) => {
  const { isReadOnly } = useReadOnly();

  return (
    <div
      className={styles.tagsRow}
      style={{
        cursor: editingTags ? 'default' : 'pointer'
      }}
      onDoubleClick={() => !isReadOnly && !editingTags && setEditingTags(true)}
      title={isReadOnly ? '' : (editingTags ? '' : '双击编辑标签')}
    >
      {editingTags ? (
        <Space size="small" wrap>
          {(transcription.tags || []).map((tag, index) => (
            <Tag
              key={index}
              closable
              onClose={(e) => { e.preventDefault(); handleRemoveTag(tag); }}
              style={{ margin: 0 }}
            >
              {tag}
            </Tag>
          ))}
          {(transcription.tags || []).length < 5 && (
            <Input
              size="small"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onPressEnter={handleKeyPressTag}
              onBlur={() => {
                if (tagInput.trim()) {
                  handleAddTag();
                } else {
                  // 延迟关闭，避免点击删除按钮时被中断
                  setTimeout(() => setEditingTags(false), 150);
                }
              }}
              placeholder="添加标签"
              style={{ width: 80 }}
              autoFocus
            />
          )}
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => {
              setEditingTags(false);
              setTagInput('');
            }}
            title="完成"
          />
        </Space>
      ) : (
        <Space size="small" wrap>
          {(transcription.tags || []).length > 0 ? (
            (transcription.tags || []).map((tag, index) => (
              <Tag key={index} style={{ margin: 0 }}>{tag}</Tag>
            ))
          ) : (
            <span style={{ color: '#999', fontSize: '12px' }}>暂无标签</span>
          )}
        </Space>
      )}
    </div>
  );
};

export default TagsRow;
