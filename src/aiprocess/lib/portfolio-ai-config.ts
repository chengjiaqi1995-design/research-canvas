// Client-safe AI configuration types and constants
// This file can be safely imported in both client and server components

export interface AIProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModel: string;
}

export interface AIProvidersSettings {
  providers: AIProviderConfig[];
  selectedProviderId: string;
  selectedModel: string;
}

export const PROVIDER_DEFINITIONS: {
  id: string;
  name: string;
  defaultModel: string;
  models: string[];
  needsBaseUrl?: boolean;
  defaultBaseUrl?: string;
}[] = [
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    defaultModel: "claude-sonnet-4-6-20260217",
    models: [
      "claude-sonnet-4-6-20260217",
      "claude-opus-4-6-20260205",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5-20251001",
    ],
  },
  {
    id: "google",
    name: "Gemini (Google)",
    defaultModel: "gemini-2.5-flash",
    models: [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-5.4",
    models: [
      "gpt-5.4",
      "gpt-5-mini",
      "o3",
      "o4-mini",
      "gpt-4.1",
      "gpt-4o",
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "qwen",
    name: "通义千问 (Qwen)",
    defaultModel: "qwen3.5-plus",
    models: [
      "qwen3.5-plus",
      "qwen3-max",
      "qwen-plus",
      "qwen-turbo",
      "qwen-long",
      "qwen3-coder-plus",
    ],
    needsBaseUrl: true,
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
];
