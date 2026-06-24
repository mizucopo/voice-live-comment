import { RecognitionVolumeGate } from './recognition-volume-gate.js';

export class SpeechVolumeMonitor {
  constructor({
    recognitionVolumeThreshold,
    recognitionTargetDurationMs,
    resultWindowMs
  } = {}) {
    this._gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold,
      recognitionTargetDurationMs
    });
    this._resultWindowMs = resultWindowMs;
    this._stream = null;
    this._audioContext = null;
    this._scriptProcessor = null;
    this._source = null;
    this._silentGain = null;
  }

  async start() {
    await this.stop();

    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    try {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContextが利用できません');
      }

      this._audioContext = new AudioContextClass();
      this._source = this._audioContext.createMediaStreamSource(this._stream);
      this._scriptProcessor = this._audioContext.createScriptProcessor(4096, 1, 1);

      this._scriptProcessor.onaudioprocess = (event) => {
        const pcmData = event.inputBuffer.getChannelData(0);
        this._gate.processFrame(pcmData, {
          sampleRate: this._audioContext.sampleRate
        });
      };

      this._source.connect(this._scriptProcessor);
      this._silentGain = this._audioContext.createGain();
      this._silentGain.gain.value = 0;
      this._scriptProcessor.connect(this._silentGain);
      this._silentGain.connect(this._audioContext.destination);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  hasRecentTargetSpeech() {
    return this._gate.hasRecentTargetSpeech(this._resultWindowMs);
  }

  async stop() {
    if (this._scriptProcessor) {
      try { this._scriptProcessor.disconnect(); } catch (_) {}
      this._scriptProcessor = null;
    }
    if (this._source) {
      try { this._source.disconnect(); } catch (_) {}
      this._source = null;
    }
    if (this._silentGain) {
      try { this._silentGain.disconnect(); } catch (_) {}
      this._silentGain = null;
    }
    if (this._audioContext && this._audioContext.state !== 'closed') {
      try { await this._audioContext.close(); } catch (_) {}
    }
    this._audioContext = null;
    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }
    this._gate.reset();
  }
}
