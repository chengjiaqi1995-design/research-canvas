import React from 'react';
import {
  Modal,
  Input,
} from 'antd';

interface PromptConfigModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  customPrompt: string;
  setCustomPrompt: (v: string) => void;
  metadataPrompt: string;
  setMetadataPrompt: (v: string) => void;
}

const PromptConfigModal: React.FC<PromptConfigModalProps> = ({
  open,
  onOk,
  onCancel,
  customPrompt,
  setCustomPrompt,
  metadataPrompt,
  setMetadataPrompt,
}) => {
  return (
    <Modal
      title="Prompt 设置"
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={800}
    >
      {/* 📝 总结生成 Prompt（可编辑） */}
      <div style={{ marginBottom: 24 }}>
        <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
          📝 总结生成 Prompt（可编辑）
        </h4>
        <p style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
          使用 <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 3 }}>{'{text}'}</code> 作为原始转录文本的占位符。
        </p>
        <Input.TextArea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={8}
          placeholder="请输入自定义 Prompt..."
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>

      {/* 🔍 元数据提取 Prompt（可编辑） */}
      <div style={{ marginBottom: 0 }}>
        <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
          🔍 元数据提取 Prompt（可编辑）
        </h4>
        <p style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
          用于提取主题、公司、中介、行业、国家、参与人类型、发生时间等信息。使用 <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 3 }}>{'{text}'}</code> 作为转录文本的占位符。
        </p>
        <Input.TextArea
          value={metadataPrompt}
          onChange={(e) => setMetadataPrompt(e.target.value)}
          rows={12}
          placeholder="请输入元数据提取 Prompt..."
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
      </div>
    </Modal>
  );
};

export default PromptConfigModal;
