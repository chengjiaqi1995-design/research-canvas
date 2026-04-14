import client from './client';

export async function translateToChinese(text: string, apiKey?: string, translationModel?: string) {
  return client.post('/translation/translate', { text, apiKey, translationModel });
}


