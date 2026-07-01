import {
  DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD,
  RecognitionVolumeGate,
  calculateRms,
  isRecognitionVolumeGateDisabled,
  normalizeRecognitionVolumeThreshold
} from './recognition-volume-gate.js';

export class Vad {
  constructor({
    recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
    recognitionTargetDurationMs = DEFAULT_RECOGNITION_TARGET_DURATION_MS
  } = {}) {
    this._isSpeech = false;
    this._silenceTimer = null;
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
    this.THRESHOLD = normalizeRecognitionVolumeThreshold(recognitionVolumeThreshold);
    this._isRecognitionVolumeGateDisabled = isRecognitionVolumeGateDisabled(this.THRESHOLD);
    this.SPEECH_BOUNDARY_THRESHOLD = this._isRecognitionVolumeGateDisabled
      ? MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD
      : this.THRESHOLD;
    this.RECOGNITION_TARGET_DURATION_MS = recognitionTargetDurationMs;
    this._recognitionVolumeGate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: this.THRESHOLD,
      recognitionTargetDurationMs
    });
    this.SPEECH_END_GRACE_MS = 3000;
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
    const rms = calculateRms(pcmData);
    const isRecognitionTarget = this._isRecognitionVolumeGateDisabled
      ? rms >= this.SPEECH_BOUNDARY_THRESHOLD
      : this._recognitionVolumeGate.processFrame(pcmData);
    this._updateState(rms, isRecognitionTarget);
  }

  _updateState(energy, isRecognitionTarget) {
    if (isRecognitionTarget && !this._isSpeech) {
      this._isSpeech = true;
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
      for (const cb of this._speechStartCallbacks) cb();
    } else if (energy >= this.SPEECH_BOUNDARY_THRESHOLD && this._isSpeech) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    } else if (energy < this.SPEECH_BOUNDARY_THRESHOLD && this._isSpeech) {
      if (!this._silenceTimer) {
        this._silenceTimer = setTimeout(() => {
          this._isSpeech = false;
          this._silenceTimer = null;
          for (const cb of this._speechEndCallbacks) cb();
        }, this.SPEECH_END_GRACE_MS);
      }
    }
  }

  destroy() {
    clearTimeout(this._silenceTimer);
    this._isSpeech = false;
    this._recognitionVolumeGate.reset();
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
  }
}
