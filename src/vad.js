export class Vad {
  constructor() {
    this._isSpeech = false;
    this._silenceTimer = null;
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
    this.THRESHOLD = 0.05;
    this.SILENCE_TIMEOUT_MS = 1000;
    this.FRAME_SIZE = 480; // 30ms at 16kHz
  }

  async init() {
    // エネルギーベースVADは初期化不要
  }

  onSpeechStart(callback) {
    this._speechStartCallbacks.push(callback);
  }

  onSpeechEnd(callback) {
    this._speechEndCallbacks.push(callback);
  }

  processFrame(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
      sum += pcmData[i] * pcmData[i];
    }
    const rms = Math.sqrt(sum / pcmData.length);
    this._updateState(rms);
  }

  _updateState(energy) {
    if (energy >= this.THRESHOLD && !this._isSpeech) {
      this._isSpeech = true;
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
      for (const cb of this._speechStartCallbacks) cb();
    } else if (energy >= this.THRESHOLD && this._isSpeech) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    } else if (energy < this.THRESHOLD && this._isSpeech) {
      if (!this._silenceTimer) {
        this._silenceTimer = setTimeout(() => {
          this._isSpeech = false;
          this._silenceTimer = null;
          for (const cb of this._speechEndCallbacks) cb();
        }, this.SILENCE_TIMEOUT_MS);
      }
    }
  }

  destroy() {
    clearTimeout(this._silenceTimer);
    this._isSpeech = false;
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
  }
}
