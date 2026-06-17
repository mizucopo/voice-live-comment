import { AudioCapture } from './audio-capture.js';
import { Vad } from './vad.js';

export async function createExternalPipeline(provider, {
  AudioCaptureClass = AudioCapture,
  VadClass = Vad
} = {}) {
  const audioCapture = new AudioCaptureClass();
  const vad = new VadClass();
  let isStopped = false;

  try {
    await vad.init();

    audioCapture.onPcmData((frame) => vad.processFrame(frame));
    vad.onSpeechStart(() => {
      if (!isStopped) {
        audioCapture.startRecording();
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
