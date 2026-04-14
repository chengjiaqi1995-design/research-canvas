import { Request, Response } from 'express';
import { translateToChinese } from '../services/translationService';

export async function translate(req: Request, res: Response) {
  const { text, apiKey, translationModel } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      success: false,
      error: '文本不能为空',
    });
  }

  if (!apiKey) {
    return res.status(400).json({
      success: false,
      error: '请在设置中配置 Qwen API 密钥',
    });
  }

  if (!translationModel) {
    return res.status(400).json({
      success: false,
      error: '请在设置中选择翻译模型',
    });
  }

  try {
    const translatedText = await translateToChinese(text, apiKey, translationModel);

    res.json({
      success: true,
      data: {
        originalText: text,
        translatedText,
      },
    });
  } catch (err: any) {
    console.error('翻译失败:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || '翻译失败',
    });
  }
}


