import axios from 'axios';
import dns from 'dns';

const DEFAULT_DASHSCOPE_URLS = [
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
];
type TranslationTarget = 'zh' | 'en';

export class TranslationProviderError extends Error {
  status?: number;
  provider?: string;
  providerCode?: string;

  constructor(message: string, options: { status?: number; provider?: string; providerCode?: string } = {}) {
    super(message);
    this.name = 'TranslationProviderError';
    this.status = options.status;
    this.provider = options.provider;
    this.providerCode = options.providerCode;
  }
}

function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini');
}

function normalizeTranslationTarget(target?: string): TranslationTarget {
  return target === 'en' ? 'en' : 'zh';
}

function targetLanguageName(target: TranslationTarget): string {
  return target === 'en' ? 'English' : '简体中文';
}

function buildTranslationInstruction(target: TranslationTarget, lightPrompt = false): string {
  if (target === 'en') {
    return lightPrompt
      ? 'Translate the user input into concise, natural English. Output only the translation.'
      : 'You are a translation assistant. Translate the following content into concise, natural English. Preserve Markdown structure when present. Output only the translation.';
  }
  return lightPrompt
    ? '翻译为简体中文，只输出翻译结果。'
    : '你是翻译助手。将以下内容翻译为简体中文。保持 Markdown 格式。删除原文中嵌入的中文注释词。只输出翻译结果。';
}

function normalizeDashScopeUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function getDashScopeUrls(): string[] {
  const configured = [
    process.env.DASHSCOPE_CHAT_COMPLETIONS_URL,
    process.env.DASHSCOPE_API_URL,
    process.env.DASHSCOPE_URL,
  ]
    .filter((url): url is string => Boolean(url && url.trim()))
    .map(normalizeDashScopeUrl);

  return Array.from(new Set([...configured, ...DEFAULT_DASHSCOPE_URLS]));
}

function extractProviderError(error: any) {
  const respData = error.response?.data;
  return {
    status: typeof error.response?.status === 'number' ? error.response.status : undefined,
    code: respData?.error?.code || respData?.code,
    message: respData?.error?.message || respData?.message || error.message || '未知错误',
  };
}

function isInvalidApiKeyError(error: any): boolean {
  const providerError = extractProviderError(error);
  const text = `${providerError.code || ''} ${providerError.message || ''}`.toLowerCase();
  return providerError.status === 401 && (
    text.includes('invalid_api_key') ||
    text.includes('incorrect api key') ||
    text.includes('api key')
  );
}

async function postDashScopeChatCompletion(
  payload: Record<string, unknown>,
  apiKey: string,
  timeout: number,
  logContext: string,
) {
  const urls = getDashScopeUrls();
  let lastError: any;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      console.log(`[翻译-service] DashScope request: ${logContext}, URL=${url}`);
      return await axios.post(
        url,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout,
        }
      );
    } catch (error: any) {
      lastError = error;
      const providerError = extractProviderError(error);
      const canRetryNextEndpoint = isInvalidApiKeyError(error) && index < urls.length - 1;
      console.error(
        `[翻译-service] DashScope endpoint failed: ${logContext}, URL=${url}, status=${providerError.status || 'n/a'}, code=${providerError.code || 'n/a'}, message=${providerError.message}`
      );
      if (canRetryNextEndpoint) {
        console.warn('[翻译-service] DashScope key was rejected by this endpoint; retrying the next DashScope endpoint');
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * 通过 Gemini API 翻译
 * @param timeoutMs 超时毫秒数，默认 30s。实时翻译应传 12-15s。
 * @param lightPrompt 实时场景用极简 prompt 减少输出延迟
 */
async function translateViaGemini(
  text: string,
  apiKey: string,
  model: string,
  timeoutMs = 30000,
  lightPrompt = false,
  target: TranslationTarget = 'zh'
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`[翻译-service] Gemini: model=${model}, target=${target}, textLength=${text.length}, timeout=${timeoutMs}ms`);

  const promptText = `${buildTranslationInstruction(target, lightPrompt)}\n\n${text}`;

  const response = await axios.post(url, {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.1 },
  }, { timeout: timeoutMs });

  const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!result) {
    console.error('[翻译-service] Gemini: 翻译结果为空, response:', JSON.stringify(response.data).slice(0, 500));
    throw new Error('翻译结果为空');
  }
  return result;
}

/**
 * 通过 DashScope API 翻译
 */
async function translateViaDashScope(text: string, apiKey: string, model: string, target: TranslationTarget = 'zh'): Promise<string> {
  console.log(`[翻译-service] DashScope: model=${model}, target=${target}, textLength=${text.length}`);

  const response = await postDashScopeChatCompletion(
    {
      model,
      messages: [
        {
          role: 'system',
          content: buildTranslationInstruction(target, false)
        },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
    },
    apiKey,
    100000,
    `model=${model}, target=${target}, textLength=${text.length}`,
  );

  const result = response.data?.choices?.[0]?.message?.content?.trim();
  if (!result) {
    console.error('[翻译-service] DashScope: 翻译结果为空, response:', JSON.stringify(response.data).slice(0, 500));
    throw new Error('翻译结果为空');
  }
  return result;
}

/**
 * 翻译文本到中文 - 根据模型自动路由到 Gemini 或 DashScope
 */
export async function translateToChinese(text: string, providedApiKey?: string, translationModel?: string): Promise<string> {
  if (!providedApiKey) {
    throw new Error('API密钥未配置');
  }
  if (!translationModel) {
    throw new Error('未指定翻译模型，请在前端设置中选择模型');
  }

  const startTime = Date.now();
  try {
    let result: string;
    if (isGeminiModel(translationModel)) {
      result = await translateViaGemini(text, providedApiKey, translationModel);
    } else {
      result = await translateViaDashScope(text, providedApiKey, translationModel);
    }
    console.log(`[翻译-service] ✅ 成功, ${Date.now() - startTime}ms, 结果长度=${result.length}`);
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    if (error.response) {
      console.error(`[翻译-service] ❌ API错误, ${duration}ms, status=${error.response.status}, body:`, JSON.stringify(error.response.data).slice(0, 500));
    } else {
      console.error(`[翻译-service] ❌ 错误, ${duration}ms, code=${error.code}, message=${error.message}`);
    }
    const providerError = extractProviderError(error);
    throw new TranslationProviderError(`翻译失败: ${providerError.message}`, {
      status: providerError.status,
      provider: isGeminiModel(translationModel) ? 'gemini' : 'dashscope',
      providerCode: providerError.code,
    });
  }
}

/**
 * 检测文本语言
 */
export function detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'other' {
  if (!text || text.trim().length === 0) {
    return 'other';
  }

  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const japaneseKana = text.match(/[\u3040-\u30ff]/g) || [];
  const englishChars = text.match(/[a-zA-Z]/g) || [];

  const chineseRatio = chineseChars.length / text.length;
  const englishRatio = englishChars.length / text.length;

  if (japaneseKana.length / text.length > 0.12) {
    return 'ja';
  }

  if (chineseRatio > 0.3) {
    return 'zh';
  } else if (englishRatio > 0.3) {
    return 'en';
  }

  return 'other';
}

/**
 * 实时翻译单段文本（轻量级，低延迟）
 * - 自动跳过中文文本
 * - 根据模型路由到 Gemini 或 DashScope
 */
export async function translateSegmentRealtime(text: string, apiKey: string, model: string, targetLanguage: string = 'zh'): Promise<string | null> {
  if (!text || !text.trim()) return null;
  const target = normalizeTranslationTarget(targetLanguage);

  // 太短的文本跳过（语气词、填充词）
  if (text.trim().length < 3) return null;

  const lang = detectLanguage(text);
  if (lang === target) return null;

  const startTime = Date.now();
  try {
    if (isGeminiModel(model)) {
      // 实时场景 Gemini 也用 15s 超时 + 轻量 prompt
      const result = await translateViaGemini(text, apiKey, model, 15000, true, target);
      console.log(`[translateSegmentRealtime] Gemini ✅ target=${target}, ${Date.now() - startTime}ms, len=${text.length}→${result.length}`);
      return result;
    }

    const response = await postDashScopeChatCompletion(
      {
        model,
        messages: [
          { role: 'system', content: `Translate the user input into ${targetLanguageName(target)}. Output only the translation, no explanations.` },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
      },
      apiKey,
      15000,
      `realtime model=${model}, target=${target}, textLength=${text.length}`,
    );

    const translated = response.data?.choices?.[0]?.message?.content?.trim();
    if (!translated) return null;
    console.log(`[translateSegmentRealtime] DashScope ✅ target=${target}, ${Date.now() - startTime}ms, len=${text.length}→${translated.length}`);
    return translated;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const providerError = extractProviderError(error);
    const detail = providerError.message;
    console.error(`[translateSegmentRealtime] ❌ ${duration}ms, model=${model}: ${detail}`);
    throw new TranslationProviderError(`翻译失败: ${detail}`, {
      status: providerError.status,
      provider: isGeminiModel(model) ? 'gemini' : 'dashscope',
      providerCode: providerError.code,
    });
  }
}
