import React from 'react';
import { MASTER_GOAL_PROMPT } from '../constants';

export const PromptInspector: React.FC = () => {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: '10px',
            color: '#999',
            background: '#f5f5f5',
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #e8e8e8',
          }}
        >
          统一模式
        </span>
      </div>
      <div
        style={{
          padding: '12px',
          background: '#fafafa',
          border: '1px solid #e8e8e8',
          borderRadius: 4,
          fontSize: '12px',
          color: '#666',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          maxHeight: '400px',
          overflowY: 'auto',
        }}
      >
        <span style={{ color: '#333', fontWeight: 500 }}>&gt; SYSTEM_INSTRUCTION:</span>
        <br />
        {MASTER_GOAL_PROMPT.trim()}
      </div>
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid #e8e8e8',
          fontSize: '11px',
          color: '#999',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span>中文输出 (简体中文)</span>
        <span>智能去重</span>
        <span>业务表格</span>
      </div>
    </div>
  );
};

