import { Request, Response } from 'express';
import { translateToChinese } from '../services/translationService';

export async function translate(req: Request, res: Response) {
  const { text, apiKey, translationModel } = req.body;

  console.log('[翻译] ===== 收到翻译请求 =====');
  console.log('[翻译] 1. 参数检查:', {
    textLength: text?.length || 0,
    textPreview: text ? text.slice(0, 100) + '...' : '(empty)',
    hasApiKey: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) + '...' : '(none)',
    translationModel,
  });

  if (!text || typeof text !== 'string') {
    console.log('[翻译] ❌ 失败: 文本为空');
    return res.status(400).json({
      success: false,
      error: '文本不能为空',
    });
  }

  if (!apiKey) {
    console.log('[翻译] ❌ 失败: API密钥为空');
    return res.status(400).json({
      success: false,
      error: '请在设置中配置 Qwen API 密钥',
    });
  }

  if (!translationModel) {
    console.log('[翻译] ❌ 失败: 翻译模型为空');
    return res.status(400).json({
      success: false,
      error: '请在设置中选择翻译模型',
    });
  }

  console.log('[翻译] 2. 参数校验通过, 开始调用 DashScope API...');
  const startTime = Date.now();

  try {
    const translatedText = await translateToChinese(text, apiKey, translationModel);
    const duration = Date.now() - startTime;
    console.log(`[翻译] ✅ 翻译成功, 耗时 ${duration}ms, 结果长度: ${translatedText.length}`);

    res.json({
      success: true,
      data: {
        originalText: text,
        translatedText,
      },
    });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`[翻译] ❌ 翻译失败, 耗时 ${duration}ms:`, err.message);
    res.status(500).json({
      success: false,
      error: err.message || '翻译失败',
    });
  }
}
