import axios from 'axios';
import dns from 'dns';

const DASHSCOPE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini');
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
  lightPrompt = false
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  console.log(`[翻译-service] Gemini: model=${model}, textLength=${text.length}, timeout=${timeoutMs}ms`);

  const promptText = lightPrompt
    ? `翻译为简体中文，只输出翻译结果：\n${text}`
    : `你是翻译助手。将以下内容翻译为简体中文。保持 Markdown 格式。删除原文中嵌入的中文注释词。只输出翻译结果。\n\n${text}`;

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
async function translateViaDashScope(text: string, apiKey: string, model: string): Promise<string> {
  console.log(`[翻译-service] DashScope: model=${model}, textLength=${text.length}, URL=${DASHSCOPE_URL}`);

  const response = await axios.post(
    DASHSCOPE_URL,
    {
      model,
      messages: [
        {
          role: 'system',
          content: '你是翻译助手。将用户输入翻译为简体中文。保持 Markdown 格式。删除原文中嵌入的中文注释词。只输出翻译结果。'
        },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 100000
    }
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
    const respData = error.response?.data;
    const detail = respData?.error?.message || respData?.message || error.message;
    throw new Error(`翻译失败: ${detail}`);
  }
}

/**
 * 检测文本语言
 */
export function detectLanguage(text: string): 'zh' | 'en' | 'other' {
  if (!text || text.trim().length === 0) {
    return 'other';
  }

  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const englishChars = text.match(/[a-zA-Z]/g) || [];

  const chineseRatio = chineseChars.length / text.length;
  const englishRatio = englishChars.length / text.length;

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
export async function translateSegmentRealtime(text: string, apiKey: string, model: string): Promise<string | null> {
  if (!text || !text.trim()) return null;

  // 太短的文本跳过（语气词、填充词）
  if (text.trim().length < 3) return null;

  const lang = detectLanguage(text);
  if (lang === 'zh') return null;

  const startTime = Date.now();
  try {
    if (isGeminiModel(model)) {
      // 实时场景 Gemini 也用 15s 超时 + 轻量 prompt
      const result = await translateViaGemini(text, apiKey, model, 15000, true);
      console.log(`[translateSegmentRealtime] Gemini ✅ ${Date.now() - startTime}ms, len=${text.length}→${result.length}`);
      return result;
    }

    const response = await axios.post(
      DASHSCOPE_URL,
      {
        model,
        messages: [
          { role: 'system', content: '将用户输入翻译为简体中文，只输出翻译结果，不要解释。' },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const translated = response.data?.choices?.[0]?.message?.content?.trim();
    if (!translated) return null;
    console.log(`[translateSegmentRealtime] DashScope ✅ ${Date.now() - startTime}ms, len=${text.length}→${translated.length}`);
    return translated;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const detail = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    console.error(`[translateSegmentRealtime] ❌ ${duration}ms, model=${model}: ${detail}`);
    throw new Error(`翻译失败: ${detail}`);
  }
}
