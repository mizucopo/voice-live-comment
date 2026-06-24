import { AudioCapture } from './audio-capture.js';
import { Vad } from './vad.js';
import {
  DEFAULT_RECOGNITION_TARGET_DURATION_MS,
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD
} from './recognition-volume-gate.js';

export async function createExternalPipeline(provider, {
  AudioCaptureClass = AudioCapture,
  VadClass = Vad,
  recognitionVolumeThreshold = DEFAULT_RECOGNITION_VOLUME_THRESHOLD
} = {}) {
  const audioCapture = new AudioCaptureClass({
    recordingFormat: provider.recordingFormat || 'webm'
  });
  const vad = new VadClass({ recognitionVolumeThreshold });
  const recognitionTargetDurationMs =
    vad.RECOGNITION_TARGET_DURATION_MS ?? DEFAULT_RECOGNITION_TARGET_DURATION_MS;
  let isStopped = false;

  try {
    await vad.init();

    audioCapture.onPcmData((frame) => vad.processFrame(frame));
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
        provider.sendAudio(blob);
      }
    });

    await audioCapture.start();
  } catch (error) {
    isStopped = true;
    vad.destroy();
    try { await audioCapture.stop(); } catch (_) {}
    throw error;
  }

  return {
    async stop() {
      isStopped = true;
      vad.destroy();
      try { await audioCapture.stop(); } catch (_) {}
    }
  };
}
