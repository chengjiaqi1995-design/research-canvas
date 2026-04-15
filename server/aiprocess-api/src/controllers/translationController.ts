import { Request, Response } from 'express';
import { translateToChinese } from '../services/translationService';

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
    res.status(500).json({ success: false, error: err.message || '翻译失败' });
  }
}
