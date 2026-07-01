export const DEFAULT_RECOGNITION_VOLUME_THRESHOLD = 0.05;
export const DISABLED_RECOGNITION_VOLUME_THRESHOLD = 0;
export const MIN_RECOGNITION_VOLUME_THRESHOLD = 0;
export const MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD = 0.01;
export const MAX_RECOGNITION_VOLUME_THRESHOLD = 0.20;
export const RECOGNITION_VOLUME_THRESHOLD_STEP = 0.01;
export const DEFAULT_RECOGNITION_TARGET_DURATION_MS = 200;
export const DEFAULT_RECOGNITION_RESULT_WINDOW_MS = 3000;
export const DEFAULT_PCM_SAMPLE_RATE = 16000;

export function normalizeRecognitionVolumeThreshold(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_RECOGNITION_VOLUME_THRESHOLD;
  }

  if (numberValue <= DISABLED_RECOGNITION_VOLUME_THRESHOLD) {
    return DISABLED_RECOGNITION_VOLUME_THRESHOLD;
  }

  const clamped = Math.min(
    MAX_RECOGNITION_VOLUME_THRESHOLD,
    Math.max(MIN_ACTIVE_RECOGNITION_VOLUME_THRESHOLD, numberValue)
  );

  return Math.round((clamped + Number.EPSILON) * 100) / 100;
}

export function isRecognitionVolumeGateDisabled(value) {
  return normalizeRecognitionVolumeThreshold(value) === DISABLED_RECOGNITION_VOLUME_THRESHOLD;
}

export function formatRecognitionVolumeThreshold(value) {
  return normalizeRecognitionVolumeThreshold(value).toFixed(2);
}

export function calculateRms(pcmData) {
  if (!pcmData || pcmData.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < pcmData.length; i++) {
    sum += pcmData[i] * pcmData[i];
  }
  return Math.sqrt(sum / pcmData.length);
}

export function calculateFrameDurationMs(pcmData, sampleRate = DEFAULT_PCM_SAMPLE_RATE) {
  if (!pcmData || pcmData.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return 0;
  }

  return (pcmData.length / sampleRate) * 1000;
}

export class RecognitionVolumeGate {
  constructor({
    recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
    recognitionTargetDurationMs = DEFAULT_RECOGNITION_TARGET_DURATION_MS,
    now = () => Date.now()
  } = {}) {
    this.threshold = normalizeRecognitionVolumeThreshold(recognitionVolumeThreshold);
    this.isDisabled = this.threshold === DISABLED_RECOGNITION_VOLUME_THRESHOLD;
    this.targetDurationMs = recognitionTargetDurationMs;
    this._now = now;
    this._aboveThresholdMs = 0;
    this._lastTargetSpeechAtMs = null;
  }

  processFrame(pcmData, { sampleRate = DEFAULT_PCM_SAMPLE_RATE, now = this._now() } = {}) {
    return this.processRms(
      calculateRms(pcmData),
      calculateFrameDurationMs(pcmData, sampleRate),
      now
    );
  }

  processRms(rms, durationMs, now = this._now()) {
    if (this.isDisabled) {
      this._lastTargetSpeechAtMs = now;
      return true;
    }

    if (rms >= this.threshold) {
      this._aboveThresholdMs += Math.max(0, durationMs);
      if (this._aboveThresholdMs >= this.targetDurationMs) {
        this._lastTargetSpeechAtMs = now;
        return true;
      }
      return false;
    }

    this._aboveThresholdMs = 0;
    return false;
  }

  hasRecentTargetSpeech(windowMs = DEFAULT_RECOGNITION_RESULT_WINDOW_MS, now = this._now()) {
    if (this.isDisabled) {
      return true;
    }

    return this._lastTargetSpeechAtMs !== null && now - this._lastTargetSpeechAtMs <= windowMs;
  }

  consumeRecentTargetSpeech(windowMs = DEFAULT_RECOGNITION_RESULT_WINDOW_MS, now = this._now()) {
    if (this.isDisabled) {
      return true;
    }

    const hasRecentTargetSpeech = this.hasRecentTargetSpeech(windowMs, now);
    this.reset();
    return hasRecentTargetSpeech;
  }

  reset() {
    this._aboveThresholdMs = 0;
    this._lastTargetSpeechAtMs = null;
  }
}
