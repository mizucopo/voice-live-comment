import { SttProvider } from './stt-provider.js';

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GROK_STT_RECOGNIZE',
        apiKey: this.apiKey,
        audioBase64: await blobToBase64(audioBlob),
        language: this.language,
        boostPhrases: this.boostPhrases
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || 'Grok STTの変換に失敗しました');
      }

      if (response.text) {
        this._emitResult(response.text);
      }
    } catch (error) {
      this._emitError(error);
    }
  }
}
