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
  private isSpeech: boolean;
  private silenceTimer: ReturnType<typeof setTimeout> | null;
  private speechStartCallbacks: (() => void)[];
  private speechEndCallbacks: (() => void)[];
  readonly THRESHOLD: number;
  private readonly isRecognitionVolumeGateDisabled: boolean;
  readonly SPEECH_BOUNDARY_THRESHOLD: number;
  readonly RECOGNITION_TARGET_DURATION_MS: number;
  private readonly recognitionVolumeGate: RecognitionVolumeGate;
  readonly SPEECH_END_GRACE_MS: number;
  readonly FRAME_SIZE: number;

  constructor({
    recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
    recognitionTargetDurationMs = DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  }: VadOptions = {}) {
    this.isSpeech = false;
    this.silenceTimer = null;
    this.speechStartCallbacks = [];
    this.speechEndCallbacks = [];
    this.THRESHOLD = normalizeRecognitionVolumeThreshold(recognitionVolumeThreshold);
    this.isRecognitionVolumeGateDisabled = isRecognitionVolumeGateDisabled(this.THRESHOLD);
    this.SPEECH_BOUNDARY_THRESHOLD = this.isRecognitionVolumeGateDisabled
      ? MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD
      : this.THRESHOLD;
    this.RECOGNITION_TARGET_DURATION_MS = recognitionTargetDurationMs;
    this.recognitionVolumeGate = new RecognitionVolumeGate({
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
    this.speechStartCallbacks.push(callback);
  }

  onSpeechEnd(callback: () => void): void {
    this.speechEndCallbacks.push(callback);
  }

  processFrame(pcmData: ArrayLike<number>): void {
    const rms = calculateRms(pcmData);
    const isRecognitionTarget = this.isRecognitionVolumeGateDisabled
      ? rms >= this.SPEECH_BOUNDARY_THRESHOLD
      : this.recognitionVolumeGate.processFrame(pcmData);
    this.updateState(rms, isRecognitionTarget);
  }

  private updateState(energy: number, isRecognitionTarget: boolean): void {
    if (isRecognitionTarget && !this.isSpeech) {
      this.isSpeech = true;
      if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
      for (const cb of this.speechStartCallbacks) cb();
    } else if (energy >= this.SPEECH_BOUNDARY_THRESHOLD && this.isSpeech) {
      if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    } else if (energy < this.SPEECH_BOUNDARY_THRESHOLD && this.isSpeech) {
      this.silenceTimer ??= setTimeout(() => {
        this.isSpeech = false;
        this.silenceTimer = null;
        for (const cb of this.speechEndCallbacks) cb();
      }, this.SPEECH_END_GRACE_MS);
    }
  }

  destroy(): void {
    if (this.silenceTimer !== null) clearTimeout(this.silenceTimer);
    this.isSpeech = false;
    this.recognitionVolumeGate.reset();
    this.speechStartCallbacks = [];
    this.speechEndCallbacks = [];
  }
}
