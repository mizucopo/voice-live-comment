/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-this-alias, @typescript-eslint/no-unused-vars -- ポートごとの差分だけを表すテストダブル。 */

import { describe, it, expect, vi } from "vitest";
import {
  createExternalPipeline,
  type AudioCapturePort,
  type VadPort,
} from "../src/external-pipeline.js";
import { type RecordingFormat } from "../src/audio-capture.js";
import { SttProvider } from "../src/stt/stt-provider.js";
import { MockAudioContext } from "./setup.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = () => {
      promiseResolve();
    };
  });
  return { promise, resolve };
}

class FakeProvider extends SttProvider {
  override recordingFormat: RecordingFormat;
  override readonly sendAudio = vi.fn().mockResolvedValue(undefined);

  constructor(recordingFormat: RecordingFormat = "webm") {
    super();
    this.recordingFormat = recordingFormat;
  }
}

describe("createExternalPipeline", () => {
  it.each([
    { frequency: 1000, sendsAudio: true },
    { frequency: 12000, sendsAudio: false },
  ])(
    "$frequency Hzの入力を変換したPCMで認識音量ゲートを判定する",
    async ({ frequency, sendsAudio }) => {
      vi.useFakeTimers();
      const createProcessor = vi.spyOn(MockAudioContext.prototype, "createScriptProcessor");
      const provider = new FakeProvider("pcm16");
      const pipeline = await createExternalPipeline(provider);

      try {
        const created = createProcessor.mock.results[0];
        if (created?.type !== "return") throw new Error("音声入力が初期化されていません");
        const processor = created.value;
        const input = Float32Array.from(
          { length: 48000 },
          (_, i) => 0.1 * Math.sin((2 * Math.PI * frequency * i) / 48000),
        );
        for (let offset = 0; offset < input.length; offset += 4096) {
          const frame = input.subarray(offset, offset + 4096);
          processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } });
          vi.advanceTimersByTime((frame.length / 48000) * 1000);
        }
        processor.onaudioprocess?.({
          inputBuffer: { getChannelData: () => new Float32Array(4096) },
        });
        vi.advanceTimersByTime(3000);

        expect(provider.sendAudio).toHaveBeenCalledTimes(sendsAudio ? 1 : 0);
      } finally {
        await pipeline.stop();
        createProcessor.mockRestore();
        vi.useRealTimers();
      }
    },
  );

  it("providerの録音形式をAudioCaptureに渡す", async () => {
    const provider = new FakeProvider("pcm16");
    let audioCaptureOptions: { recordingFormat: RecordingFormat } | undefined;
    let vadOptions: { recognitionVolumeThreshold: number } | undefined;

    class FakeAudioCapture implements AudioCapturePort {
      constructor(options: { recordingFormat: RecordingFormat }) {
        audioCaptureOptions = options;
      }

      onPcmData(_callback: (frame: Float32Array<ArrayBuffer>) => void): void {}

      startRecording(): void {}

      stopRecording(): Blob {
        return new Blob([], { type: "audio/l16;rate=16000" });
      }

      start(): Promise<void> {
        return Promise.resolve();
      }

      stop(): Promise<void> {
        return Promise.resolve();
      }
    }

    class FakeVad implements VadPort {
      constructor(options: { recognitionVolumeThreshold: number }) {
        vadOptions = options;
      }

      init(): Promise<void> {
        return Promise.resolve();
      }

      onSpeechStart(_callback: () => void): void {}

      onSpeechEnd(_callback: () => void): void {}

      processFrame(_frame: Float32Array<ArrayBuffer>): void {}

      destroy(): void {}
    }

    await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad,
      recognitionVolumeThreshold: 0.12,
    });

    expect(audioCaptureOptions).toEqual({ recordingFormat: "pcm16" });
    expect(vadOptions).toEqual({ recognitionVolumeThreshold: 0.12 });
  });

  it("speechEnd 後に発話前音声の境界を更新する", async () => {
    const provider = new FakeProvider();
    let audioCapture: FakeAudioCapture | undefined;
    let vad: FakeVad | undefined;

    class FakeAudioCapture implements AudioCapturePort {
      readonly markPreRollBoundary = vi.fn();

      constructor() {
        audioCapture = this;
      }

      onPcmData(_callback: (frame: Float32Array<ArrayBuffer>) => void): void {}

      startRecording(): void {}

      stopRecording(): Blob {
        return new Blob([], { type: "audio/webm;codecs=opus" });
      }

      start(): Promise<void> {
        return Promise.resolve();
      }

      stop(): Promise<void> {
        return Promise.resolve();
      }
    }

    class FakeVad implements VadPort {
      onSpeechEndCallback: () => void = () => undefined;

      constructor() {
        vad = this;
      }

      init(): Promise<void> {
        return Promise.resolve();
      }

      onSpeechStart(_callback: () => void): void {}

      onSpeechEnd(callback: () => void): void {
        this.onSpeechEndCallback = callback;
      }

      processFrame(_frame: Float32Array<ArrayBuffer>): void {}

      destroy(): void {}
    }

    await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad,
    });

    if (!vad || !audioCapture) throw new Error("テスト用パイプラインが初期化されていません");
    vad.onSpeechEndCallback();

    expect(audioCapture.markPreRollBoundary).toHaveBeenCalledTimes(1);
    expect(provider.sendAudio).not.toHaveBeenCalled();
  });

  it("speechStart 時に認識対象継続時間だけを発話前音声として含める", async () => {
    const provider = new FakeProvider();
    let audioCapture: FakeAudioCapture | undefined;
    let vad: FakeVad | undefined;

    class FakeAudioCapture implements AudioCapturePort {
      readonly startRecording = vi.fn();

      constructor() {
        audioCapture = this;
      }

      onPcmData(_callback: (frame: Float32Array<ArrayBuffer>) => void): void {}

      stopRecording(): Blob {
        return new Blob([], { type: "audio/webm;codecs=opus" });
      }

      start(): Promise<void> {
        return Promise.resolve();
      }

      stop(): Promise<void> {
        return Promise.resolve();
      }
    }

    class FakeVad implements VadPort {
      readonly RECOGNITION_TARGET_DURATION_MS = 200;
      onSpeechStartCallback: () => void = () => undefined;

      constructor() {
        vad = this;
      }

      init(): Promise<void> {
        return Promise.resolve();
      }

      onSpeechStart(callback: () => void): void {
        this.onSpeechStartCallback = callback;
      }

      onSpeechEnd(_callback: () => void): void {}

      processFrame(_frame: Float32Array<ArrayBuffer>): void {}

      destroy(): void {}
    }

    await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad,
    });

    if (!vad || !audioCapture) throw new Error("テスト用パイプラインが初期化されていません");
    vad.onSpeechStartCallback();

    expect(audioCapture.startRecording).toHaveBeenCalledWith({ preRollMs: 200 });
  });

  it("停止中に speechEnd が発火しても音声を送信しない", async () => {
    const stopCapture = createDeferred();
    const provider = new FakeProvider();
    let vad: FakeVad | undefined;

    class FakeAudioCapture implements AudioCapturePort {
      onPcmData(_callback: (frame: Float32Array<ArrayBuffer>) => void): void {}

      startRecording(): void {}

      stopRecording(): Blob {
        return new Blob(["audio"], { type: "audio/webm;codecs=opus" });
      }

      start(): Promise<void> {
        return Promise.resolve();
      }

      stop(): Promise<void> {
        return stopCapture.promise;
      }
    }

    class FakeVad implements VadPort {
      readonly destroy = vi.fn();
      onSpeechEndCallback: () => void = () => undefined;

      constructor() {
        vad = this;
      }

      init(): Promise<void> {
        return Promise.resolve();
      }

      onSpeechStart(_callback: () => void): void {}

      onSpeechEnd(callback: () => void): void {
        this.onSpeechEndCallback = callback;
      }

      processFrame(_frame: Float32Array<ArrayBuffer>): void {}
    }

    const pipeline = await createExternalPipeline(provider, {
      AudioCaptureClass: FakeAudioCapture,
      VadClass: FakeVad,
    });

    const stopPromise = pipeline.stop();

    if (!vad) throw new Error("テスト用VADが初期化されていません");
    expect(vad.destroy).toHaveBeenCalledTimes(1);
    vad.onSpeechEndCallback();

    expect(provider.sendAudio).not.toHaveBeenCalled();

    stopCapture.resolve();
    await stopPromise;
  });
});
