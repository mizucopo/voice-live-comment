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
  it('speechEnd 後に発話前音声の境界を更新する', async () => {
    const provider = { sendAudio: vi.fn() };
    let audioCapture;
    let vad;

    class FakeAudioCapture {
      constructor() {
        audioCapture = this;
        this.markPreRollBoundary = vi.fn();
      }

      onPcmData(_callback) {}

      startRecording() {}

      stopRecording() {
        return new Blob([], { type: 'audio/webm;codecs=opus' });
      }

      async start() {}

      async stop() {}
    }

    class FakeVad {
      constructor() {
        vad = this;
      }

      async init() {}

      onSpeechStart(_callback) {}

      onSpeechEnd(callback) {
        this.onSpeechEndCallback = callback;
      }

      destroy() {}
    }

    await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad
    });

    vad.onSpeechEndCallback();

    expect(audioCapture.markPreRollBoundary).toHaveBeenCalledTimes(1);
    expect(provider.sendAudio).not.toHaveBeenCalled();
  });

  it('停止中に speechEnd が発火しても音声を送信しない', async () => {
    const stopCapture = createDeferred();
    const provider = { sendAudio: vi.fn() };
    let vad;

    class FakeAudioCapture {
      onPcmData(_callback) {}

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

      onSpeechStart(_callback) {}

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
