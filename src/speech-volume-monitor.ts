/* eslint-disable @typescript-eslint/no-deprecated -- Chrome向け既存録音処理はScriptProcessorNodeを使用する。 */

import { RecognitionVolumeGate } from "./recognition-volume-gate.js";

type SpeechVolumeMonitorOptions = {
  recognitionVolumeThreshold?: number;
  recognitionTargetDurationMs?: number;
  resultWindowMs?: number;
};

export class SpeechVolumeMonitor {
  private readonly gate: RecognitionVolumeGate;
  private readonly resultWindowMs: number | undefined;
  private stream: MediaStream | null;
  private currentAudioContext: AudioContext | null;
  private scriptProcessor: ScriptProcessorNode | null;
  private source: MediaStreamAudioSourceNode | null;
  private silentGain: GainNode | null;

  constructor({
    recognitionVolumeThreshold,
    recognitionTargetDurationMs,
    resultWindowMs,
  }: SpeechVolumeMonitorOptions = {}) {
    this.gate = new RecognitionVolumeGate({
      ...(recognitionVolumeThreshold === undefined ? {} : { recognitionVolumeThreshold }),
      ...(recognitionTargetDurationMs === undefined ? {} : { recognitionTargetDurationMs }),
    });
    this.resultWindowMs = resultWindowMs;
    this.stream = null;
    this.currentAudioContext = null;
    this.scriptProcessor = null;
    this.source = null;
    this.silentGain = null;
  }

  async start(): Promise<void> {
    await this.stop();

    if (this.gate.isDisabled) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    try {
      const audioContext = new AudioContext();
      this.currentAudioContext = audioContext;
      this.source = audioContext.createMediaStreamSource(this.stream);
      this.scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (event) => {
        const pcmData = event.inputBuffer.getChannelData(0);
        this.gate.processFrame(pcmData, {
          sampleRate: audioContext.sampleRate,
        });
      };

      this.source.connect(this.scriptProcessor);
      this.silentGain = audioContext.createGain();
      this.silentGain.gain.value = 0;
      this.scriptProcessor.connect(this.silentGain);
      this.silentGain.connect(audioContext.destination);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  hasRecentTargetSpeech(): boolean {
    return this.gate.hasRecentTargetSpeech(this.resultWindowMs);
  }

  consumeRecentTargetSpeech(): boolean {
    return this.gate.consumeRecentTargetSpeech(this.resultWindowMs);
  }

  async stop(): Promise<void> {
    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this.scriptProcessor = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this.source = null;
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch {
        // Cleanup remains best-effort.
      }
      this.silentGain = null;
    }
    if (this.currentAudioContext && this.currentAudioContext.state !== "closed") {
      try {
        await this.currentAudioContext.close();
      } catch {
        // Cleanup remains best-effort.
      }
    }
    this.currentAudioContext = null;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }
    this.gate.reset();
  }
}
