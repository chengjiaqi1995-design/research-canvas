import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, message } from 'antd';
import { CopyIcon, CheckIcon, RefreshIcon, SaveIcon, AlertTriangleIcon } from './Icons';

interface ResultViewProps {
  content: string;
  isTruncated?: boolean;
  onReset: () => void;
  onSave: () => void;
}

export const ResultView: React.FC<ResultViewProps> = ({
  content,
  isTruncated,
  onReset,
  onSave,
}) => {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      message.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
      message.error('复制失败');
    }
  };

  const handleSave = () => {
    onSave();
    setSaved(true);
    message.success('已保存到历史记录');
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid #e8e8e8',
        borderRadius: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: '#fafafa',
          borderBottom: '1px solid #e8e8e8',
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: '#333',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ width: 2, height: 16, background: '#333', display: 'block' }}></span>
          合并结果
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            size="small"
            icon={<RefreshIcon className="w-4 h-4" />}
            onClick={onReset}
          >
            新建
          </Button>
          <Button
            size="small"
            icon={saved ? <CheckIcon className="w-4 h-4" /> : <SaveIcon className="w-4 h-4" />}
            onClick={handleSave}
            disabled={saved}
          >
            {saved ? '已保存' : '保存'}
          </Button>
          <Button
            type="primary"
            size="small"
            icon={copied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
            onClick={handleCopy}
          >
            {copied ? '已复制' : '复制文本'}
          </Button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          background: '#ffffff',
          minHeight: 0,
        }}
      >
        <div
          style={{
            maxWidth: 'none',
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#333',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>

        {isTruncated && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: 0,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <span style={{ color: '#d46b08', flexShrink: 0 }}><AlertTriangleIcon className="w-5 h-5" /></span>
            <div>
              <h4 style={{ fontSize: '12px', fontWeight: 500, color: '#d46b08', margin: '0 0 4px 0' }}>
                内容被截断
              </h4>
              <p style={{ fontSize: '12px', color: '#d46b08', margin: 0 }}>
                合并结果达到了最大输出限制（8192 tokens）并被截断。末尾可能缺少一些信息。
              </p>
            </div>
          </div>
        )}

        <div style={{ height: 40 }}></div>
      </div>

      <div
        style={{
          background: '#fafafa',
          padding: '8px 16px',
          borderTop: '1px solid #e8e8e8',
          fontSize: '11px',
          color: '#999',
          display: 'flex',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span>由 Gemini AI 生成</span>
        <span>{content.length} 字符</span>
      </div>
    </div>
  );
};

