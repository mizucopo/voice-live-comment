import { describe, it, expect, vi } from 'vitest';
import { createExternalPipeline } from '../src/external-pipeline.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('createExternalPipeline', () => {
  it('停止中に speechEnd が発火しても音声を送信しない', async () => {
    const stopCapture = createDeferred();
    const provider = { sendAudio: vi.fn() };
    let vad;

    class FakeAudioCapture {
      onPcmData(callback) {
        this.onPcmDataCallback = callback;
      }

      startRecording() {}

      stopRecording() {
        return new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
      }

      async start() {}

      stop() {
        return stopCapture.promise;
      }
    }

    class FakeVad {
      constructor() {
        vad = this;
        this.destroy = vi.fn();
      }

      async init() {}

      onSpeechStart(callback) {
        this.onSpeechStartCallback = callback;
      }

      onSpeechEnd(callback) {
        this.onSpeechEndCallback = callback;
      }
    }

    const pipeline = await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad
    });

    const stopPromise = pipeline.stop();

    expect(vad.destroy).toHaveBeenCalledTimes(1);
    vad.onSpeechEndCallback();

    expect(provider.sendAudio).not.toHaveBeenCalled();

    stopCapture.resolve();
    await stopPromise;
  });
});
