import { SttProvider } from './stt-provider.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export class BrowserSttProvider extends SttProvider {
  constructor(settings) {
    super();
    this.settings = settings;
    this.recognitions = [null, null];
    this.activeIndex = 0;
    this.nextPreStarted = false;
    this.isActive = false;
    this.hasFallbackFromLocal = false;
    this.isInitialStart = true;
    this.startTimeoutId = null;
  }

  async start() {
    if (!SpeechRecognition) {
      this._emitError(new Error('このブラウザは音声認識に対応していません'));
      return;
    }

    this.isInitialStart = true;
    this.isActive = true;
    this.activeIndex = 0;
    this.nextPreStarted = false;
    this.hasFallbackFromLocal = false;

    if (this.settings.useLocalModel) {
      const ready = await this.ensureOnDeviceModel();
      if (!ready) {
        this.settings = { ...this.settings, useLocalModel: false };
        this._emitError(new Error('オンデバイスモデルが利用できないため、クラウド認識を使用します'));
      }
    }

    this.startInstance(0);
  }

  async stop() {
    this.isActive = false;
    this.isInitialStart = true;
    this.nextPreStarted = false;
    this.hasFallbackFromLocal = false;
    clearTimeout(this.startTimeoutId);

    for (let i = 0; i < 2; i++) {
      if (this.recognitions[i]) {
        try { this.recognitions[i].stop(); } catch (e) {}
        this.recognitions[i] = null;
      }
    }

    this._emitStop();
  }

  setupRecognitionInstance(index) {
    const rec = new SpeechRecognition();
    rec.lang = this.settings.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    if (this.settings.useLocalModel && 'processLocally' in rec) {
      rec.processLocally = true;
    }

    if (this.settings.useLocalModel && typeof SpeechRecognitionPhrase !== 'undefined' && this.settings.boostPhrases.length > 0) {
      rec.phrases = this.settings.boostPhrases.map(p => new SpeechRecognitionPhrase(p, 10.0));
    }

    rec.onstart = () => {
      clearTimeout(this.startTimeoutId);
      if (this.isInitialStart) {
        this._emitStart();
        this.isInitialStart = false;
      }
    };

    rec.onresult = (event) => {
      let finalText = '';
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
          hasFinal = true;
        }
      }
      if (finalText) {
        this._emitResult(finalText);
      }
      if (hasFinal && index === this.activeIndex) {
        this.preStartNextInstance();
      }
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
        if (this.settings.useLocalModel) {
          this.fallbackToCloud(index, event.error);
          return;
        }
        this._emitError(new Error('マイクへのアクセスが拒否されました'));
        this.stop();
        return;
      }
      this._emitError(new Error(event.error));
      console.warn('[BrowserSttProvider] 認識エラー:', event.error);
    };

    rec.onend = () => {
      if (!this.isActive) return;
      if (this.recognitions[index] !== rec) return;

      this.recognitions[index] = null;

      if (index === this.activeIndex) {
        this.activeIndex = (index + 1) % 2;
        this.nextPreStarted = false;
        if (!this.recognitions[this.activeIndex]) {
          this.startInstance(this.activeIndex);
        }
      } else {
        this.startInstance(index);
      }
    };

    this.recognitions[index] = rec;
    return rec;
  }

  startInstance(index) {
    if (this.recognitions[index]) {
      try { this.recognitions[index].stop(); } catch (e) {}
      this.recognitions[index] = null;
    }
    const rec = this.setupRecognitionInstance(index);
    try {
      rec.start();
      clearTimeout(this.startTimeoutId);
      this.startTimeoutId = setTimeout(() => {
        if (this.settings.useLocalModel) {
          this.fallbackToCloud(index, 'timeout');
        }
      }, 3000);
    } catch (e) {
      if (this.settings.useLocalModel) {
        this.fallbackToCloud(index, e.message);
      }
    }
  }

  preStartNextInstance() {
    if (this.nextPreStarted) return;
    this.nextPreStarted = true;
    const nextIndex = (this.activeIndex + 1) % 2;
    this.startInstance(nextIndex);
  }

  fallbackToCloud(index, reason) {
    if (this.hasFallbackFromLocal) return;
    this.hasFallbackFromLocal = true;

    this.settings = { ...this.settings, useLocalModel: false };
    this.activeIndex = 0;
    this.nextPreStarted = false;
    this.startInstance(0);

    this._emitError(new Error('オンデバイス認識が利用できないため、クラウド認識に切り替えました'));
  }

  async ensureOnDeviceModel() {
    if (typeof SpeechRecognition.available !== 'function') return true;

    try {
      const status = await SpeechRecognition.available({
        langs: [this.settings.language],
        processLocally: true
      });

      if (status === 'available') return true;

      if ((status === 'downloadable' || status === 'downloading') && typeof SpeechRecognition.install === 'function') {
        await SpeechRecognition.install({
          langs: [this.settings.language],
          processLocally: true
        });
        const newStatus = await SpeechRecognition.available({
          langs: [this.settings.language],
          processLocally: true
        });
        return newStatus === 'available';
      }

      return false;
    } catch (e) {
      return false;
    }
  }
}
