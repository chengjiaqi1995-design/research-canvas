import axios from 'axios';

// API 密钥不再从环境变量回退，必须由客户端提供
const QWEN_API_KEY = '';

/**
 * 翻译文本到中文
 */
export async function translateToChinese(text: string, providedApiKey?: string, translationModel?: string): Promise<string> {
  const apiKey = providedApiKey || QWEN_API_KEY;

  if (!apiKey) {
    throw new Error('Qwen API密钥未配置');
  }
  if (!translationModel) {
    throw new Error('未指定翻译模型，请在前端设置中选择模型');
  }

  try {
    // 使用 OpenAI 兼容 API（DashScope 旧 URL 已不支持新模型）
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: translationModel,
        messages: [
          {
            role: 'system',
            content: '你是翻译助手。将用户输入翻译为简体中文。保持 Markdown 格式。删除原文中嵌入的中文注释词。只输出翻译结果。'
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.1,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 50000 // 50秒超时（Cloud Run 网关 60 秒限制）
      }
    );

    if (response.data.choices && response.data.choices.length > 0) {
      const translatedText = response.data.choices[0].message.content;

      if (!translatedText || translatedText.trim().length === 0) {
        throw new Error('翻译结果为空');
      }

      return translatedText;
    } else {
      throw new Error('Qwen API返回格式不正确');
    }
  } catch (error: any) {
    const respData = error.response?.data;
    console.error('翻译失败:', {
      status: error.response?.status,
      data: JSON.stringify(respData),
      message: error.message,
      model: translationModel,
    });
    const detail = respData?.message || respData?.error?.message || error.message;
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

  // 简单的语言检测：统计中文字符和英文字符的比例
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
 * - 精简 prompt，15s 超时
 */
export async function translateSegmentRealtime(text: string, apiKey: string, model: string): Promise<string | null> {
  if (!text || !text.trim()) return null;

  // 如果已经是中文为主，直接跳过
  const lang = detectLanguage(text);
  if (lang === 'zh') return null; // null = 不需要翻译

  try {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model,
        messages: [
          { role: 'system', content: '你是翻译助手。将用户输入翻译为简体中文，只输出翻译结果，不要解释。' },
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
    return translated;
  } catch (error: any) {
    const detail = error.response?.data?.message || error.response?.data?.error?.message || error.message;
    console.error('[translateSegmentRealtime] Failed:', detail);
    throw new Error(`翻译失败: ${detail}`);
  }
}
