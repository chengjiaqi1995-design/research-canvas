import React from 'react';
import type { SourceItem } from '../types';
import { FileTextIcon } from './Icons';
import BlockNoteTextEditor from '../../../components/BlockNoteTextEditor';
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
    <div className="flex flex-col h-[320px] rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100 shrink-0">
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

      <div className="flex-1 relative overflow-hidden bg-white min-h-0">
        <BlockNoteTextEditor
          content={source.content}
          editable={true}
          onChange={(newContent) => onUpdate(source.id, 'content', newContent)}
          placeholder={placeholder}
          hideToolbar
          className="w-full h-full"
        />
      </div>
    </div>
  );
};

