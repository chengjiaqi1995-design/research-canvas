import React from 'react';
import type { SourceItem } from '../types';
import { FileTextIcon } from './Icons';
import RichTextEditor from '../../../components/RichTextEditor';
import { Button } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

interface SourceCardProps {
  source: SourceItem;
  index: number;
  onUpdate: (id: string, field: 'title' | 'content', value: string) => void;
  onRemove: (id: string) => void;
  placeholder: string;
}

export const SourceCard: React.FC<SourceCardProps> = ({
  source,
  index,
  onUpdate,
  onRemove,
  placeholder,
}) => {
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e8e8e8',
        borderRadius: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '320px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#fafafa',
          borderBottom: '1px solid #e8e8e8',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          <span style={{ color: '#666' }}><FileTextIcon className="w-3 h-3" /></span>
          <input
            type="text"
            value={source.title}
            onChange={(e) => onUpdate(source.id, 'title', e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '11px',
              fontWeight: 500,
              color: '#333',
              outline: 'none',
              width: '100%',
            }}
            placeholder={`源 ${index + 1} 标题（可选）`}
          />
        </div>
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => onRemove(source.id)}
          title="删除源"
          style={{ color: '#999', fontSize: '12px', padding: '2px 4px', height: 'auto' }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#ff4d4f'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
        />
      </div>

      <div
        style={{
          flex: 1,
          padding: 0,
          overflow: 'auto',
          position: 'relative',
          background: '#ffffff',
          minHeight: 0,
        }}
      >
        <RichTextEditor
          content={source.content}
          onChange={(newContent) => onUpdate(source.id, 'content', newContent)}
          placeholder={placeholder}
          hideToolbar
          className="w-full h-full"
        />
      </div>
    </div>
  );
};

