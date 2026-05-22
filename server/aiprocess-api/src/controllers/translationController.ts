import { Request, Response } from 'express';
import { translateToChinese } from '../services/translationService';

function getTranslationErrorStatus(err: any): number {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status && [400, 401, 403, 404, 429].includes(status)) return status;
  if (status && status >= 500 && status < 600) return 502;

  const message = String(err?.message || '').toLowerCase();
  if (message.includes('incorrect api key') || message.includes('invalid_api_key') || message.includes('api密钥')) {
    return 401;
  }
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('quota')) {
    return 429;
  }
  return 500;
}

export async function translate(req: Request, res: Response) {
  const { text, apiKey, translationModel } = req.body;

  console.log('[翻译] 收到请求:', {
    textLength: text?.length || 0,
    hasApiKey: !!apiKey,
    translationModel,
  });

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, error: '文本不能为空' });
  }
  if (!apiKey) {
    return res.status(400).json({ success: false, error: '请在设置中配置 API 密钥' });
  }
  if (!translationModel) {
    return res.status(400).json({ success: false, error: '请在设置中选择翻译模型' });
  }

  const startTime = Date.now();
  try {
    const translatedText = await translateToChinese(text, apiKey, translationModel);
    console.log(`[翻译] ✅ 成功, ${Date.now() - startTime}ms`);
    res.json({
      success: true,
      data: { originalText: text, translatedText },
    });
  } catch (err: any) {
    console.error(`[翻译] ❌ 失败, ${Date.now() - startTime}ms:`, err.message);
    res.status(getTranslationErrorStatus(err)).json({
      success: false,
      error: err.message || '翻译失败',
      provider: err.provider,
      code: err.providerCode,
    });
  }
}
