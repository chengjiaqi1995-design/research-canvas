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

// Re-export from wikiAiService — single source of truth for prompts
export { DEFAULT_WIKI_USER_PROMPT, WIKI_SYSTEM_RULES } from '../../services/wikiAiService.ts';
import { DEFAULT_WIKI_USER_PROMPT } from '../../services/wikiAiService.ts';

/** @deprecated Use DEFAULT_WIKI_USER_PROMPT instead. Kept for backward compatibility. */
export const DEFAULT_WIKI_PROMPT = DEFAULT_WIKI_USER_PROMPT;

export const DEFAULT_WIKI_PAGE_TYPES = `当 Wiki scope 是行业级别时（industryCategory 不含 "::"），使用以下页面类型：
- [趋势] 行业性的趋势和主题：技术路线演进、政策变化、供需格局变动、价格走势等跨公司的共性话题。
- [对比] 多个实体之间的横向比较：竞争格局、市场份额、产品对比、估值对比等需要并排分析的内容。
- [拆分] 行业细分环节的深度拆解：价值链不同环节的分析、不同参与者角色的视角与决策逻辑、细分市场的结构性差异。

当 Wiki scope 是公司级别时（industryCategory 含 "::"，如 "算电协同::三一重工"），使用以下页面类型：
- [经营] 公司经营数据：营收、利润、产能利用率、订单、出货量等量化指标和变化趋势。
- [战略] 公司战略与规划：管理层表态、业务方向调整、并购、扩产计划、研发投入。
- [市场] 公司的市场地位与竞争：市场份额、客户结构、竞品对比、定价策略。
- [拆分] 公司各业务条线的拆解：不同业务板块的营收构成、增长驱动、利润率差异、战略侧重。`;

// ── Multi-scope routing rules (editable in Wiki settings) ──
export const DEFAULT_MULTI_SCOPE_RULES = `ROUTING RULES (严格遵守，避免重复):

1. 内容去向判断：
   - 某个已知公司（有专属 scope）的具体信息（财务数据、经营指标、战略规划、管理层表态、市场份额等）→ 只放到该公司的 scope
   - 行业级宏观趋势、政策变化、技术路线、不涉及特定公司的分析 → 行业 scope 的 [趋势] 页面
   - 多公司横向对比（市场份额排名、估值对比表等）→ 行业 scope 的 [对比] 页面
   - 行业价值链细分环节分析、不同参与者角色视角 → 行业 scope 的 [拆分] 页面
   - 公司各业务条线拆解 → 该公司 scope 的 [拆分] 页面

2. ⚠️ 绝对不能重复：如果某公司有专属 scope，该公司的具体数据只写入公司 scope，绝不在行业 scope 中重复。

3. ⚠️ 行业 scope 不为单个公司建立专属页面：没有专属 scope 的公司，相关信息融入 [趋势]/[对比] 页面中提及即可，不要创建 [公司] 类型的页面。

4. 页面类型限制：严格使用"页面类型定义"中定义的类型，绝不混用。

5. 一条笔记可以同时产出多个 scope 的文章，但每条具体信息只出现在一个地方。`;

// ── Lint dimensions (editable in Wiki settings) ──
export const DEFAULT_LINT_DIMENSIONS = `1. **矛盾检测 (Contradictions)**: Conflicting facts, numbers, or statements across articles. Flag the specific articles and data points that conflict.
2. **过时内容 (Stale Claims)**: Data or conclusions that may have been superseded by newer sources. Check dates — older claims that conflict with newer data should be flagged.
3. **孤立内容 (Orphans/Gaps)**: Vague paragraphs, missing context, or topics mentioned without explanation. Articles that are too thin to be useful.
4. **缺失交叉引用 (Missing Cross-References)**: Articles that discuss overlapping topics but don't reference each other. Suggest specific links to add.
5. **缺失主题页面 (Missing Topic Pages)**: Important concepts, companies, or trends mentioned across multiple articles that deserve their own dedicated page but don't have one yet.
6. **数据缺口 (Data Gaps)**: Areas where the wiki would benefit from additional research or more recent data. Suggest what kind of sources to look for.`;

export const DEFAULT_MODELS: Record<string, string> = {
  transcriptionModel: 'gemini-3-flash-preview',
  summaryModel: 'gemini-3.1-pro-preview',
  metadataModel: 'gemini-3-flash-preview',
  weeklySummaryModel: 'gemini-3-flash-preview',
  translationModel: 'qwen-plus',
  namingModel: 'gemini-3-flash-preview',
  metadataFillModel: 'gemini-3-flash-preview',
  excelParsingModel: 'gemini-3.1-pro-preview',
  wikiModel: 'gemini-3-flash-preview',
  wikiIngestPrompt: DEFAULT_WIKI_USER_PROMPT,
};

const GEMINI_MODEL_OPTIONS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)' },
];

const QWEN_MODEL_OPTIONS = [
  { value: 'qwen3.5-plus', label: 'Qwen 3.5 Plus' },
  { value: 'qwen3-max', label: 'Qwen 3 Max' },
  { value: 'qwen-max', label: 'Qwen Max' },
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'qwen-turbo', label: 'Qwen Turbo' },
];

interface ApiConfigModalProps {
  open: boolean;
  onClose: () => void;
}

// 一次性迁移：把已淘汰的旧模型 ID 自动升级到最新版
const MODEL_UPGRADES: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  'gemini-2.0-flash': 'gemini-3-flash-preview',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'deepseek-v4': 'deepseek-chat',
  'deepseek-r1': 'deepseek-reasoner',
  'claude-sonnet-4.5': 'claude-sonnet-4.6',
  'gpt-5.1': 'gpt-5.4',
  'milm': 'mimo-v2-pro',
  'qwen3-max-thinking': 'qwen3-max',
};
function migrateModelId(id: string): string {
  return MODEL_UPGRADES[id] || id;
}

/** 从 localStorage 读取 apiConfig（供其他组件使用） */
export function getApiConfig(): ApiConfig {
  const saved = localStorage.getItem('apiConfig');
  if (saved) {
    try {
      const config = JSON.parse(saved);
      const result: ApiConfig = {
        googleSpeechApiKey: config.googleSpeechApiKey || '',
        geminiApiKey: config.geminiApiKey || '',
        qwenApiKey: config.qwenApiKey || '',
        transcriptionModel: migrateModelId(config.transcriptionModel || DEFAULT_MODELS.transcriptionModel),
        summaryModel: migrateModelId(config.summaryModel || DEFAULT_MODELS.summaryModel),
        metadataModel: migrateModelId(config.metadataModel || DEFAULT_MODELS.metadataModel),
        weeklySummaryModel: migrateModelId(config.weeklySummaryModel || DEFAULT_MODELS.weeklySummaryModel),
        translationModel: migrateModelId(config.translationModel || DEFAULT_MODELS.translationModel),
        namingModel: migrateModelId(config.namingModel || DEFAULT_MODELS.namingModel),
        metadataFillModel: migrateModelId(config.metadataFillModel || DEFAULT_MODELS.metadataFillModel),
        excelParsingModel: migrateModelId(config.excelParsingModel || DEFAULT_MODELS.excelParsingModel),
        wikiModel: migrateModelId(config.wikiModel || DEFAULT_MODELS.wikiModel),
        wikiIngestPrompt: config.wikiIngestPrompt || DEFAULT_MODELS.wikiIngestPrompt,
        autoTrackerSniffing: config.autoTrackerSniffing ?? false,
      };
      // 如果有任何模型被迁移了，立即写回 localStorage
      const migrated = JSON.stringify(result) !== JSON.stringify(config);
      if (migrated) {
        localStorage.setItem('apiConfig', JSON.stringify(result));
        console.log('✅ 模型设置已自动升级到最新版本');
      }
      return result;
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
