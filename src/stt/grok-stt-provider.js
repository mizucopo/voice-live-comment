import { SttProvider } from './stt-provider.js';

const GROK_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const SUPPORTED_FORMAT_LANGUAGES = new Set([
  'ar', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fil', 'fr', 'hi',
  'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro',
  'ru', 'sv', 'th', 'tr', 'vi'
]);

function normalizeLanguage(language) {
  const code = String(language || '').split('-')[0].toLowerCase();
  return SUPPORTED_FORMAT_LANGUAGES.has(code) ? code : '';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class GrokSttProvider extends SttProvider {
  constructor(apiKey, language, boostPhrases = []) {
    super();
    this.apiKey = apiKey;
    this.language = language;
    this.boostPhrases = boostPhrases;
    this.recordingFormat = 'pcm16';
  }

  async start() {
    this._emitStart();
  }

  async stop() {
    // no-op
  }

  async sendAudio(audioBlob) {
    if (!this.apiKey) {
      this._emitError(new Error('xAI APIキーが設定されていません。設定画面で入力してください。'));
      return;
    }

    const maxRetries = 2;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(GROK_STT_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: this._createRequestBody(audioBlob)
        });

        if (!response.ok) {
          if (response.status === 429 && attempt < maxRetries) {
            await delay(Math.pow(2, attempt) * 1000);
            continue;
          }
          const errorBody = await response.text().catch(() => '');
          throw new Error(`Grok STT API error ${response.status}: ${errorBody || response.statusText}`);
        }

        const data = await response.json();
        if (data.text) {
          this._emitResult(data.text);
        }
        return;
      } catch (error) {
        lastError = error;
        if (error.message.includes('429') && attempt < maxRetries) {
          await delay(Math.pow(2, attempt) * 1000);
          continue;
        }
        break;
      }
    }

    this._emitError(lastError);
  }

  _createRequestBody(audioBlob) {
    const formData = new FormData();
    const language = normalizeLanguage(this.language);

    if (language) {
      formData.append('format', 'true');
      formData.append('language', language);
    }

    formData.append('audio_format', 'pcm');
    formData.append('sample_rate', '16000');

    for (const phrase of this.boostPhrases) {
      formData.append('keyterm', phrase);
    }

    formData.append('file', audioBlob, 'audio.pcm');
    return formData;
  }
}
