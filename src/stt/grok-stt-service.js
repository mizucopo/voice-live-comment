const GROK_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const GROK_STT_MAX_RETRIES = 2;
const SUPPORTED_FORMAT_LANGUAGES = new Set([
  'ar', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fil', 'fr', 'hi',
  'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro',
  'ru', 'sv', 'th', 'tr', 'vi'
]);

function normalizeGrokLanguage(language) {
  const code = String(language || '').split('-')[0].toLowerCase();
  return SUPPORTED_FORMAT_LANGUAGES.has(code) ? code : '';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

function createGrokSttRequestBody({ audioBase64, language, boostPhrases = [] }) {
  const formData = new FormData();
  const normalizedLanguage = normalizeGrokLanguage(language);

  if (normalizedLanguage) {
    formData.append('format', 'true');
    formData.append('language', normalizedLanguage);
  }

  formData.append('audio_format', 'pcm');
  formData.append('sample_rate', '16000');

  for (const phrase of boostPhrases) {
    formData.append('keyterm', phrase);
  }

  formData.append('file', base64ToBlob(audioBase64, 'audio/l16;rate=16000'), 'audio.pcm');
  return formData;
}

export async function recognizeGrokSpeech(message) {
  if (!message.apiKey) {
    throw new Error('xAI APIキーが設定されていません。設定画面で入力してください。');
  }

  let lastError;

  for (let attempt = 0; attempt <= GROK_STT_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(GROK_STT_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${message.apiKey}` },
        body: createGrokSttRequestBody(message)
      });

      if (!response.ok) {
        if (response.status === 429 && attempt < GROK_STT_MAX_RETRIES) {
          await delay(Math.pow(2, attempt) * 1000);
          continue;
        }
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Grok STT API error ${response.status}: ${errorBody || response.statusText}`);
      }

      const data = await response.json();
      return data.text || '';
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt < GROK_STT_MAX_RETRIES) {
        await delay(Math.pow(2, attempt) * 1000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}
