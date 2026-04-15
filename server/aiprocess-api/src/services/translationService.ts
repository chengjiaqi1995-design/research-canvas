import axios from 'axios';
import dns from 'dns';

// API 密钥不再从环境变量回退，必须由客户端提供
const QWEN_API_KEY = '';

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

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

  // Step 1: DNS 解析检查
  console.log(`[翻译-service] Step1: DNS解析 dashscope.aliyuncs.com ...`);
  const dnsStart = Date.now();
  try {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve4('dashscope.aliyuncs.com', (err, addrs) => {
        if (err) reject(err);
        else resolve(addrs);
      });
    });
    console.log(`[翻译-service] Step1: DNS解析成功, ${Date.now() - dnsStart}ms, IP: ${addresses.join(', ')}`);
  } catch (dnsErr: any) {
    console.error(`[翻译-service] Step1: DNS解析失败, ${Date.now() - dnsStart}ms:`, dnsErr.message);
    // DNS 失败不阻断，axios 会自己解析
  }

  // Step 2: 构造请求
  const requestBody = {
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
  };
  console.log(`[翻译-service] Step2: 请求构造完成, model=${translationModel}, textLength=${text.length}, URL=${DASHSCOPE_URL}`);

  // Step 3: 发送请求
  console.log(`[翻译-service] Step3: 发送 HTTP POST...`);
  const httpStart = Date.now();

  try {
    const response = await axios.post(
      DASHSCOPE_URL,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 100000 // 100秒超时
      }
    );

    const httpDuration = Date.now() - httpStart;
    console.log(`[翻译-service] Step3: HTTP 响应收到, ${httpDuration}ms, status=${response.status}`);

    // Step 4: 解析响应
    if (response.data.choices && response.data.choices.length > 0) {
      const translatedText = response.data.choices[0].message.content;

      if (!translatedText || translatedText.trim().length === 0) {
        console.error('[翻译-service] Step4: 翻译结果为空, response.data:', JSON.stringify(response.data).slice(0, 500));
        throw new Error('翻译结果为空');
      }

      console.log(`[翻译-service] Step4: 解析成功, 翻译结果长度=${translatedText.length}`);
      return translatedText;
    } else {
      console.error('[翻译-service] Step4: 返回格式不正确, response.data:', JSON.stringify(response.data).slice(0, 500));
      throw new Error('Qwen API返回格式不正确');
    }
  } catch (error: any) {
    const httpDuration = Date.now() - httpStart;

    // 区分不同类型的错误
    if (error.code === 'ECONNABORTED') {
      console.error(`[翻译-service] Step3: ❌ 请求超时 (${httpDuration}ms), code=${error.code}`);
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error(`[翻译-service] Step3: ❌ DNS解析失败, code=${error.code}`);
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`[翻译-service] Step3: ❌ 连接被拒绝, code=${error.code}`);
    } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      console.error(`[翻译-service] Step3: ❌ 连接重置/超时, code=${error.code}, ${httpDuration}ms`);
    } else if (error.response) {
      console.error(`[翻译-service] Step3: ❌ API返回错误, ${httpDuration}ms, status=${error.response.status}, body:`, JSON.stringify(error.response.data).slice(0, 500));
    } else {
      console.error(`[翻译-service] Step3: ❌ 未知错误, ${httpDuration}ms, code=${error.code}, message=${error.message}`);
    }

    const respData = error.response?.data;
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
      DASHSCOPE_URL,
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
