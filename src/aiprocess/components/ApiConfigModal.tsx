import { useState, useEffect } from 'react';
import { Modal, Form, Input, Space, Tabs, Select, message } from 'antd';
import { ApiOutlined } from '@ant-design/icons';

export interface ApiConfig {
  googleSpeechApiKey: string;
  geminiApiKey: string;
  qwenApiKey: string;
  // 模型配置
  transcriptionModel: string;
  summaryModel: string;
  metadataModel: string;
  weeklySummaryModel: string;
  translationModel: string;
}

export const DEFAULT_MODELS: Record<string, string> = {
  transcriptionModel: 'gemini-2.5-flash',
  summaryModel: 'gemini-2.5-pro',
  metadataModel: 'gemini-2.5-flash',
  weeklySummaryModel: 'gemini-3-flash-preview',
  translationModel: 'qwen-plus',
};

const GEMINI_MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
];

const QWEN_MODEL_OPTIONS = [
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'qwen-turbo', label: 'Qwen Turbo' },
  { value: 'qwen-max', label: 'Qwen Max' },
];

interface ApiConfigModalProps {
  open: boolean;
  onClose: () => void;
}

/** 从 localStorage 读取 apiConfig（供其他组件使用） */
export function getApiConfig(): ApiConfig {
  const saved = localStorage.getItem('apiConfig');
  if (saved) {
    try {
      const config = JSON.parse(saved);
      return {
        googleSpeechApiKey: config.googleSpeechApiKey || '',
        geminiApiKey: config.geminiApiKey || '',
        qwenApiKey: config.qwenApiKey || '',
        transcriptionModel: config.transcriptionModel || DEFAULT_MODELS.transcriptionModel,
        summaryModel: config.summaryModel || DEFAULT_MODELS.summaryModel,
        metadataModel: config.metadataModel || DEFAULT_MODELS.metadataModel,
        weeklySummaryModel: config.weeklySummaryModel || DEFAULT_MODELS.weeklySummaryModel,
        translationModel: config.translationModel || DEFAULT_MODELS.translationModel,
      };
    } catch {
      // fall through
    }
  }
  return {
    googleSpeechApiKey: '',
    geminiApiKey: '',
    qwenApiKey: '',
    ...DEFAULT_MODELS,
  } as ApiConfig;
}

const ApiConfigModal: React.FC<ApiConfigModalProps> = ({ open, onClose }) => {
  const [apiConfig, setApiConfig] = useState<ApiConfig>(getApiConfig());

  // 从本地存储加载配置
  useEffect(() => {
    if (open) {
      setApiConfig(getApiConfig());
    }
  }, [open]);

  const handleSave = () => {
    localStorage.setItem('apiConfig', JSON.stringify(apiConfig));
    window.dispatchEvent(new Event('apiConfigUpdated'));
    message.success('API配置已保存');
    onClose();
  };

  const tabItems = [
    {
      key: 'file',
      label: '文件转录',
      children: (
        <Form layout="vertical">
          <Form.Item
            label={
              <Space>
                <span>Google Gemini API Key</span>
                <a
                  href="https://makersuite.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (获取密钥)
                </a>
              </Space>
            }
          >
            <Input.Password
              placeholder="请输入 Gemini API Key"
              value={apiConfig.geminiApiKey}
              onChange={(e) =>
                setApiConfig({ ...apiConfig, geminiApiKey: e.target.value })
              }
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#f5222d' }}>
              <strong>必填</strong>：用于转录、总结和元数据提取（即使使用Qwen转录也需要）
            </div>
          </Form.Item>
          <Form.Item
            label={
              <Space>
                <span>通义千问 (Qwen) API Key</span>
                <a
                  href="https://dashscope.console.aliyun.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (获取密钥)
                </a>
              </Space>
            }
          >
            <Input.Password
              placeholder="请输入通义千问 API Key"
              value={apiConfig.qwenApiKey}
              onChange={(e) =>
                setApiConfig({ ...apiConfig, qwenApiKey: e.target.value })
              }
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于文件音频转录服务
            </div>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'realtime',
      label: '实时转录',
      children: (
        <Form layout="vertical">
          <Form.Item
            label={
              <Space>
                <span>通义千问 (Qwen) API Key</span>
                <a
                  href="https://dashscope.console.aliyun.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (获取密钥)
                </a>
              </Space>
            }
          >
            <Input.Password
              placeholder="请输入通义千问 API Key"
              value={apiConfig.qwenApiKey}
              onChange={(e) =>
                setApiConfig({ ...apiConfig, qwenApiKey: e.target.value })
              }
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于实时语音识别服务（推荐）
            </div>
          </Form.Item>
          <Form.Item
            label={
              <Space>
                <span>Google Speech-to-Text API Key</span>
                <a
                  href="https://cloud.google.com/speech-to-text"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  (获取密钥)
                </a>
              </Space>
            }
          >
            <Input.Password
              placeholder="请输入 Google Speech API Key"
              value={apiConfig.googleSpeechApiKey}
              onChange={(e) =>
                setApiConfig({ ...apiConfig, googleSpeechApiKey: e.target.value })
              }
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于实时语音识别服务
            </div>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'models',
      label: '模型配置',
      children: (
        <Form layout="vertical">
          <Form.Item label="笔记总结模型">
            <Select
              value={apiConfig.summaryModel}
              onChange={(v) => setApiConfig({ ...apiConfig, summaryModel: v })}
              options={GEMINI_MODEL_OPTIONS}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于生成 Notes 总结和提取相关主题
            </div>
          </Form.Item>
          <Form.Item label="元数据提取模型">
            <Select
              value={apiConfig.metadataModel}
              onChange={(v) => setApiConfig({ ...apiConfig, metadataModel: v })}
              options={GEMINI_MODEL_OPTIONS}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于提取主题、公司、行业等元数据
            </div>
          </Form.Item>
          <Form.Item label="周报生成模型">
            <Select
              value={apiConfig.weeklySummaryModel}
              onChange={(v) => setApiConfig({ ...apiConfig, weeklySummaryModel: v })}
              options={GEMINI_MODEL_OPTIONS}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于生成周度总结报告
            </div>
          </Form.Item>
          <Form.Item label="翻译模型">
            <Select
              value={apiConfig.translationModel}
              onChange={(v) => setApiConfig({ ...apiConfig, translationModel: v })}
              options={QWEN_MODEL_OPTIONS}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于中英文翻译（Qwen）
            </div>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <ApiOutlined />
          <span>API 密钥配置</span>
        </Space>
      }
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      width={700}
    >
      <Tabs items={tabItems} defaultActiveKey="file" />
    </Modal>
  );
};

export default ApiConfigModal;
