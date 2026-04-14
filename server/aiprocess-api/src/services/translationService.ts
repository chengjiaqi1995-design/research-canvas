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

  const prompt = `请将以下文本翻译成中文（简体）。保持原文的格式、段落结构和标记语法。如果文本已经是中文，直接返回原文。

重要要求：
1. 如果原文中包含中文注释单词（例如：英文句子后面跟着的中文单词），请在翻译时删除这些中文注释
2. 只保留翻译后的中文内容，不要保留原文中的中文注释
3. 保持原文的格式、段落结构和标记语法（如 Markdown 格式）

文本：
${text}

翻译：`;

  try {
    // 使用 OpenAI 兼容 API（DashScope 旧 URL 已不支持新模型）
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: translationModel,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 600000 // 10分钟超时
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


