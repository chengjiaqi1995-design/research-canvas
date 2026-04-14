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

  const translatedText = await translateToChinese(text, apiKey, translationModel);

  res.json({
    success: true,
    data: {
      originalText: text,
      translatedText,
    },
  });
}


