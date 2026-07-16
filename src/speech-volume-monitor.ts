/* eslint-disable @typescript-eslint/no-deprecated -- Chrome向け既存録音処理はScriptProcessorNodeを使用する。 */

import { RecognitionVolumeGate } from "./recognition-volume-gate.js";

type SpeechVolumeMonitorOptions = {
  recognitionVolumeThreshold?: number;
  recognitionTargetDurationMs?: number;
  resultWindowMs?: number;
};

export class SpeechVolumeMonitor {
  private readonly _gate: RecognitionVolumeGate;
  private readonly _resultWindowMs: number | undefined;
  private _stream: MediaStream | null;
  private _audioContext: AudioContext | null;
  private _scriptProcessor: ScriptProcessorNode | null;
  private _source: MediaStreamAudioSourceNode | null;
  private _silentGain: GainNode | null;

  constructor({
    recognitionVolumeThreshold,
    recognitionTargetDurationMs,
    resultWindowMs,
  }: SpeechVolumeMonitorOptions = {}) {
    this._gate = new RecognitionVolumeGate({
      ...(recognitionVolumeThreshold === undefined ? {} : { recognitionVolumeThreshold }),
      ...(recognitionTargetDurationMs === undefined ? {} : { recognitionTargetDurationMs }),
    });
    this._resultWindowMs = resultWindowMs;
    this._stream = null;
    this._audioContext = null;
    this._scriptProcessor = null;
    this._source = null;
    this._silentGain = null;
  }

  async start(): Promise<void> {
    await this.stop();

    if (this._gate.isDisabled) {
      return;
    }

    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    try {
      const audioContext = new AudioContext();
      this._audioContext = audioContext;
      this._source = audioContext.createMediaStreamSource(this._stream);
      this._scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      this._scriptProcessor.onaudioprocess = (event) => {
        const pcmData = event.inputBuffer.getChannelData(0);
        this._gate.processFrame(pcmData, {
          sampleRate: audioContext.sampleRate,
        });
      };

      this._source.connect(this._scriptProcessor);
      this._silentGain = audioContext.createGain();
      this._silentGain.gain.value = 0;
      this._scriptProcessor.connect(this._silentGain);
      this._silentGain.connect(audioContext.destination);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  hasRecentTargetSpeech(): boolean {
    return this._gate.hasRecentTargetSpeech(this._resultWindowMs);
  }

  consumeRecentTargetSpeech(): boolean {
    return this._gate.consumeRecentTargetSpeech(this._resultWindowMs);
  }

  async stop(): Promise<void> {
    if (this._scriptProcessor) {
      try {
        this._scriptProcessor.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this._scriptProcessor = null;
    }
    if (this._source) {
      try {
        this._source.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this._source = null;
    }
    if (this._silentGain) {
      try {
        this._silentGain.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this._silentGain = null;
    }
    if (this._audioContext && this._audioContext.state !== "closed") {
      try {
        await this._audioContext.close();
      } catch {
        // Cleanup remains best-effort.
      }
    }
    this._audioContext = null;
    if (this._stream) {
      this._stream.getTracks().forEach((track) => {
        track.stop();
      });
      this._stream = null;
    }
    this._gate.reset();
  }
}
