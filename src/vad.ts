import {
  DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD,
  RecognitionVolumeGate,
  calculateRms,
  isRecognitionVolumeGateDisabled,
  normalizeRecognitionVolumeThreshold,
} from "./recognition-volume-gate.js";

type VadOptions = {
  recognitionVolumeThreshold?: number;
  recognitionTargetDurationMs?: number;
};

export class Vad {
  private _isSpeech: boolean;
  private _silenceTimer: ReturnType<typeof setTimeout> | null;
  private _speechStartCallbacks: (() => void)[];
  private _speechEndCallbacks: (() => void)[];
  readonly THRESHOLD: number;
  private readonly _isRecognitionVolumeGateDisabled: boolean;
  readonly SPEECH_BOUNDARY_THRESHOLD: number;
  readonly RECOGNITION_TARGET_DURATION_MS: number;
  private readonly _recognitionVolumeGate: RecognitionVolumeGate;
  readonly SPEECH_END_GRACE_MS: number;
  readonly FRAME_SIZE: number;

  constructor({
    recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
    recognitionTargetDurationMs = DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  }: VadOptions = {}) {
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
      recognitionTargetDurationMs,
    });
    this.SPEECH_END_GRACE_MS = 3000;
    this.FRAME_SIZE = 480; // 30ms at 16kHz
  }

  async init(): Promise<void> {
    // エネルギーベースVADは初期化不要
  }

  onSpeechStart(callback: () => void): void {
    this._speechStartCallbacks.push(callback);
  }

  onSpeechEnd(callback: () => void): void {
    this._speechEndCallbacks.push(callback);
  }

  processFrame(pcmData: ArrayLike<number>): void {
    const rms = calculateRms(pcmData);
    const isRecognitionTarget = this._isRecognitionVolumeGateDisabled
      ? rms >= this.SPEECH_BOUNDARY_THRESHOLD
      : this._recognitionVolumeGate.processFrame(pcmData);
    this._updateState(rms, isRecognitionTarget);
  }

  private _updateState(energy: number, isRecognitionTarget: boolean): void {
    if (isRecognitionTarget && !this._isSpeech) {
      this._isSpeech = true;
      if (this._silenceTimer !== null) clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
      for (const cb of this._speechStartCallbacks) cb();
    } else if (energy >= this.SPEECH_BOUNDARY_THRESHOLD && this._isSpeech) {
      if (this._silenceTimer !== null) clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    } else if (energy < this.SPEECH_BOUNDARY_THRESHOLD && this._isSpeech) {
      this._silenceTimer ??= setTimeout(() => {
        this._isSpeech = false;
        this._silenceTimer = null;
        for (const cb of this._speechEndCallbacks) cb();
      }, this.SPEECH_END_GRACE_MS);
    }
  }

  destroy(): void {
    if (this._silenceTimer !== null) clearTimeout(this._silenceTimer);
    this._isSpeech = false;
    this._recognitionVolumeGate.reset();
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
  }
}
