import { SttProvider } from './stt-provider.js';

export class GoogleSttProvider extends SttProvider {
  constructor(apiKey, language) {
    super();
    this.apiKey = apiKey;
    this.language = language;
  }

  async start() {
    this._emitStart();
  }

  async stop() {
    // no-op
  }

  async sendAudio(audioBlob) {
    if (!this.apiKey) {
      this._emitError(new Error('Google Cloud APIキーが設定されていません。設定画面で入力してください。'));
      return;
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Audio = btoa(binary);

    const maxRetries = 2;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio: { content: base64Audio },
              config: {
                encoding: 'WEBM_OPUS',
                sampleRateHertz: 48000,
                languageCode: this.language
              }
            })
          }
        );

        if (!response.ok) {
          if (response.status === 429 && attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
          const errorBody = await response.text().catch(() => '');
          throw new Error(`Google STT API error ${response.status}: ${errorBody || response.statusText}`);
        }

        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const text = data.results
            .map(r => r.alternatives && r.alternatives[0] ? r.alternatives[0].transcript : '')
            .filter(t => t)
            .join('');
          if (text) {
            this._emitResult(text);
          }
        }
        return;
      } catch (error) {
        lastError = error;
        if (error.message.includes('429') && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
        break;
      }
    }

    this._emitError(lastError);
  }
}
