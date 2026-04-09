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
  namingModel: string;
  metadataFillModel: string;
  excelParsingModel: string;
  wikiModel: string;
  wikiIngestPrompt: string;
  autoTrackerSniffing?: boolean;
}

export const DEFAULT_WIKI_PROMPT = `You are a highly capable analytical AI maintaining a comprehensive Industry Wiki for the category: "{{industryCategory}}".
Your task is to integrate newly discovered intelligence (sources) into the existing Wiki.

CURRENT DATE: {{currentDate}}

CURRENT WIKI STATE (JSON array of articles):
{{serializedWiki}}

NEW SOURCE MATERIAL:
{{sourceMaterial}}

INSTRUCTIONS:
1. Analyze the NEW SOURCE MATERIAL.
2. Determine if it contains new facts, trends, or contradictions regarding "{{industryCategory}}".
3. CRITICAL: Pay attention to the DATE and METADATA of the sources. Always prioritize the newest information. If newer facts contradict older ones, update the wiki to reflect the latest state.
4. Output your decision strictly using XML tags for articles instead of JSON. You can write as much detailed Markdown content inside the tags as needed without worrying about JSON formatting errors.

<article action="create" title="Title of new article" description="Brief 1-sentence log of why you created this">
# Your deep, comprehensive markdown content goes here...
</article>

<article action="update" id="id-of-existing-article-if-update" title="Title of updated article" description="Brief 1-sentence log of changes">
# Your merged, comprehensive markdown content goes here...
</article>

5. VISUAL CITATIONS (CRITICAL REQUIREMENT):
Whenever you assert a fact or write a paragraph based on the Source Material, you MUST append an inline HTML visual citation capsule at the end of the sentence or block. Match the color scheme to the source type from its Metadata (Expert / Management / Sellside / News, etc.):

- For "Management" or "管理层": <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For "Expert" or "专家": <span class="bg-sky-100 text-sky-700 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For "Sellside" or "卖方研报": <span class="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>
- For Unknown/News/Other: <span class="bg-slate-100 text-slate-600 px-1 py-0.5 rounded text-[10px] font-medium ml-1">'YY/MM</span>

Example of generating a bullet point:
- 预计2024下半年产能利用率将从70%提升至85% <span class="bg-slate-800 text-white px-1 py-0.5 rounded text-[10px] font-medium ml-1">'24/07</span>。

Always retain existing valuable information when updating an article. Only output the <article> XML tags. Do not output anything outside of the XML tags.`;

export const DEFAULT_MODELS: Record<string, string> = {
  transcriptionModel: 'gemini-2.5-flash',
  summaryModel: 'gemini-2.5-pro',
  metadataModel: 'gemini-2.5-flash',
  weeklySummaryModel: 'gemini-3-flash-preview',
  translationModel: 'qwen-plus',
  namingModel: 'gemini-3-flash-preview',
  metadataFillModel: 'gemini-3-flash-preview',
  excelParsingModel: 'gemini-3-flash-preview',
  wikiModel: 'gemini-3-flash-preview',
  wikiIngestPrompt: DEFAULT_WIKI_PROMPT,
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
        namingModel: config.namingModel || DEFAULT_MODELS.namingModel,
        metadataFillModel: config.metadataFillModel || DEFAULT_MODELS.metadataFillModel,
        excelParsingModel: config.excelParsingModel || DEFAULT_MODELS.excelParsingModel,
        wikiModel: config.wikiModel || DEFAULT_MODELS.wikiModel,
        wikiIngestPrompt: config.wikiIngestPrompt || DEFAULT_MODELS.wikiIngestPrompt,
        autoTrackerSniffing: config.autoTrackerSniffing ?? false,
      };
    } catch {
      // fall through
    }
  }
  return {
    googleSpeechApiKey: '',
    geminiApiKey: '',
    qwenApiKey: '',
    autoTrackerSniffing: false,
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
          <Form.Item label="行业百科Wiki大模型">
            <Select
              value={apiConfig.wikiModel}
              onChange={(v) => setApiConfig({ ...apiConfig, wikiModel: v })}
              options={GEMINI_MODEL_OPTIONS}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
              用于自动化生成、提问和审查行业 Wiki
            </div>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'advanced',
      label: '高级配置',
      children: (
        <Form layout="vertical">
          <Form.Item label="行业Wiki合并规则 (System Prompt)">
            <Input.TextArea
              value={apiConfig.wikiIngestPrompt}
              onChange={(e) => setApiConfig({ ...apiConfig, wikiIngestPrompt: e.target.value })}
              autoSize={{ minRows: 6, maxRows: 12 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
               定义大模型在整合碎片知识时的系统指令。可用的变量: <code>{`{{industryCategory}}`}</code>, <code>{`{{currentDate}}`}</code>, <code>{`{{serializedWiki}}`}</code>, <code>{`{{sourceMaterial}}`}</code>。
            </div>
            <button
               type="button"
               onClick={() => setApiConfig({ ...apiConfig, wikiIngestPrompt: DEFAULT_WIKI_PROMPT })}
               className="mt-2 text-xs text-blue-600 hover:text-blue-800"
            >
               恢复默认规则
            </button>
          </Form.Item>
        </Form>
      )
    }
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
