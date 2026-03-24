import React from 'react';
import type { HistoryItem } from '../types';
import { TrashIcon, XIcon, FileTextIcon, ClockIcon } from './Icons';
import { Button, Empty } from 'antd';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onLoad: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  history,
  onLoad,
  onDelete,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: '#ffffff',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease-in-out',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid #e8e8e8',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #e8e8e8',
          background: '#fafafa',
        }}
      >
        <h3
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#333',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
              <span style={{ color: '#666' }}><ClockIcon className="w-4 h-4" /></span>
          历史记录
        </h3>
        <Button
          type="text"
          size="small"
          icon={<XIcon className="w-4 h-4" />}
          onClick={onClose}
        />
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {history.length === 0 ? (
          <Empty description="暂无保存的合并记录" />
        ) : (
          history.map((item) => (
            <div
              key={item.id}
              style={{
                background: '#ffffff',
                border: '1px solid #e8e8e8',
                borderRadius: 0,
                padding: 12,
                cursor: 'pointer',
                position: 'relative',
              }}
              onClick={() => {
                onLoad(item);
                onClose();
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#666';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 500,
                    color: '#666',
                    background: '#f0f0f0',
                    padding: '2px 8px',
                    borderRadius: 0,
                  }}
                >
                  {new Date(item.timestamp).toLocaleDateString('zh-CN')}
                </span>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<TrashIcon className="w-3 h-3" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  style={{ opacity: 0.6 }}
                />
              </div>
              <h4
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#333',
                  margin: '0 0 4px 0',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.title || '未命名合并'}
              </h4>
              <p
                style={{
                  fontSize: '11px',
                  color: '#666',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {item.result.slice(0, 100)}...
              </p>
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '10px',
                  color: '#999',
                }}
              >
                <FileTextIcon className="w-3 h-3" />
                {item.sources.length} 个源
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

