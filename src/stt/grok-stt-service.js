const GROK_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const GROK_STT_MAX_RETRIES = 2;
const SUPPORTED_FORMAT_LANGUAGES = new Set([
  'ar', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fil', 'fr', 'hi',
  'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro',
  'ru', 'sv', 'th', 'tr', 'vi'
]);
const DETECTED_LANGUAGE_CODES = new Map([
  ['arabic', 'ar'],
  ['czech', 'cs'],
  ['danish', 'da'],
  ['dutch', 'nl'],
  ['english', 'en'],
  ['farsi', 'fa'],
  ['filipino', 'fil'],
  ['french', 'fr'],
  ['german', 'de'],
  ['hindi', 'hi'],
  ['indonesian', 'id'],
  ['italian', 'it'],
  ['japanese', 'ja'],
  ['korean', 'ko'],
  ['macedonian', 'mk'],
  ['malay', 'ms'],
  ['mandarin', 'zh'],
  ['mandarin chinese', 'zh'],
  ['chinese', 'zh'],
  ['persian', 'fa'],
  ['polish', 'pl'],
  ['portuguese', 'pt'],
  ['romanian', 'ro'],
  ['russian', 'ru'],
  ['spanish', 'es'],
  ['swedish', 'sv'],
  ['thai', 'th'],
  ['turkish', 'tr'],
  ['vietnamese', 'vi']
]);
const EMPTY_LANGUAGE_FOREIGN_TRANSCRIPT_PATTERNS = new Map([
  ['ja', [
    /^[啊呀哦呃嗯哎诶唉喂嘛]+[!?.。、，,\s]*$/u,
    /^(?:你好|您好|谢谢|謝謝|谢谢你|謝謝你|再见|再見)[!?.。、，,\s]*$/u
  ]],
  ['zh', [
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  ]]
]);

function normalizeLanguageCode(language) {
  return String(language || '').trim().split('-')[0].toLowerCase();
}

function normalizeGrokLanguage(language) {
  const code = normalizeLanguageCode(language);
  return SUPPORTED_FORMAT_LANGUAGES.has(code) ? code : '';
}

function normalizeDetectedLanguage(language) {
  const normalized = String(language || '').trim().toLowerCase();
  if (!normalized) return '';
  const code = normalized.split('-')[0];
  if (/^[a-z]{2,3}$/.test(code)) return code;
  return DETECTED_LANGUAGE_CODES.get(normalized) || '';
}

function isShortTranscript(text, words = []) {
  const tokens = String(text || '').normalize('NFKC').match(/[\p{Letter}\p{Number}]+/gu) || [];
  const lexicalLength = tokens.join('').length;
  if (lexicalLength <= 4) return true;
  if (tokens.length <= 1 && lexicalLength <= 12) return true;
  return Array.isArray(words) && words.length > 0 && words.length <= 1 && lexicalLength <= 12;
}

function shouldSuppressShortForeignTranscript({ text, requestedLanguage, detectedLanguage, words }) {
  const requested = normalizeLanguageCode(requestedLanguage);
  const detected = normalizeDetectedLanguage(detectedLanguage);
  if (!text || !requested) return false;
  if (!isShortTranscript(text, words)) return false;

  if (detected) {
    return requested !== detected;
  }

  const patterns = EMPTY_LANGUAGE_FOREIGN_TRANSCRIPT_PATTERNS.get(requested) || [];
  const normalizedText = String(text).normalize('NFKC');
  return patterns.some((pattern) => pattern.test(normalizedText));
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
      const text = data.text || '';
      if (shouldSuppressShortForeignTranscript({
        text,
        requestedLanguage: message.language,
        detectedLanguage: data.language,
        words: data.words
      })) {
        return '';
      }
      return text;
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
