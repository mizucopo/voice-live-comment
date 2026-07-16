import { AudioCapture } from "./audio-capture.js";
import { Vad } from "./vad.js";
import {
  DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
} from "./recognition-volume-gate.js";
import type { RecordingFormat } from "./audio-capture.js";
import type { SttProvider } from "./stt/stt-provider.js";

export type AudioCapturePort = {
  onPcmData: (callback: (frame: Float32Array<ArrayBuffer>) => void) => void;
  startRecording: (options?: { preRollMs?: number }) => void;
  stopRecording: () => Blob;
  markPreRollBoundary?: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export type VadPort = {
  RECOGNITION_TARGET_DURATION_MS?: number;
  init: () => Promise<void>;
  onSpeechStart: (callback: () => void) => void;
  onSpeechEnd: (callback: () => void) => void;
  processFrame: (frame: Float32Array<ArrayBuffer>) => void;
  destroy: () => void;
};

export type ExternalPipelineOptions = {
  AudioCaptureClass?: new (options: { recordingFormat: RecordingFormat }) => AudioCapturePort;
  VadClass?: new (options: { recognitionVolumeThreshold: number }) => VadPort;
  recognitionVolumeThreshold?: number;
};

export async function createExternalPipeline(
  provider: SttProvider,
  {
    AudioCaptureClass = AudioCapture,
    VadClass = Vad,
    recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  }: ExternalPipelineOptions = {},
): Promise<{ stop: () => Promise<void> }> {
  const audioCapture = new AudioCaptureClass({
    recordingFormat: provider.recordingFormat,
  });
  const vad = new VadClass({ recognitionVolumeThreshold });
  const recognitionTargetDurationMs =
    vad.RECOGNITION_TARGET_DURATION_MS ?? DEFAULT_RECOGNITION_TARGET_DURATION_MS;
  let isStopped = false;

  try {
    await vad.init();

    audioCapture.onPcmData((frame) => {
      vad.processFrame(frame);
    });
    vad.onSpeechStart(() => {
      if (!isStopped) {
        audioCapture.startRecording({ preRollMs: recognitionTargetDurationMs });
      }
    });
    vad.onSpeechEnd(() => {
      if (isStopped) return;

      const blob = audioCapture.stopRecording();
      audioCapture.markPreRollBoundary?.();
      if (blob.size > 0) {
        void provider.sendAudio(blob);
      }
    });

    await audioCapture.start();
  } catch (error) {
    isStopped = true;
    vad.destroy();
    try {
      await audioCapture.stop();
    } catch {
      // Cleanup remains best-effort.
    }
    throw error;
  }

  return {
    async stop() {
      isStopped = true;
      vad.destroy();
      try {
        await audioCapture.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    },
  };
}
