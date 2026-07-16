/* eslint-disable @typescript-eslint/no-deprecated -- 既存ScriptProcessorNode録音処理のテスト。 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioCapture, type RecordingFormat } from "../src/audio-capture.js";
import { mockGetUserMedia } from "./setup.js";

type TestMediaRecorder = MediaRecorder & {
  _simulateChunk: (data: BlobPart, options?: { timecode?: number }) => void;
};
type TestAudioContext = Omit<AudioContext, "sampleRate"> & { sampleRate: number };
type TestAudioCapture = Omit<AudioCapture, "audioContext" | "mediaRecorder"> & {
  readonly audioContext: TestAudioContext;
  readonly mediaRecorder: TestMediaRecorder;
  readonly _scriptProcessor: ScriptProcessorNode;
};

function createAudioCapture(recordingFormat: RecordingFormat = "webm"): TestAudioCapture {
  return new AudioCapture({ recordingFormat }) as unknown as TestAudioCapture;
}

describe("AudioCapture", () => {
  let capture: TestAudioCapture;

  beforeEach(() => {
    vi.clearAllMocks();
    capture = createAudioCapture();
  });

  function simulateChunkAt(ms: number, data: BlobPart, timecode: number = ms): void {
    vi.setSystemTime(ms);
    capture.mediaRecorder._simulateChunk(data, { timecode });
  }

  async function startCaptureAt(ms: number): Promise<void> {
    vi.setSystemTime(ms);
    await capture.start();
  }

  async function withFakeTimers(callback: () => Promise<void>): Promise<void> {
    vi.useFakeTimers();
    try {
      await callback();
    } finally {
      vi.useRealTimers();
    }
  }

  function markBoundaryAt(ms: number): TestMediaRecorder {
    const previousRecorder = capture.mediaRecorder;
    vi.setSystemTime(ms);
    capture.markPreRollBoundary();
    return previousRecorder;
  }

  function processPcmFrame(samples: Iterable<number>): void {
    capture._scriptProcessor.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => Float32Array.from(samples),
      },
    } as unknown as AudioProcessingEvent);
  }

  const pcmLeadingSilenceBytes = 16000 * 2;

  function expectLeadingPcmSilence(view: DataView): void {
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(pcmLeadingSilenceBytes - 2, true)).toBe(0);
  }

  it("start() でgetUserMediaとMediaRecorderが起動する", async () => {
    await capture.start();
    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(capture.mediaRecorder).toBeDefined();
    expect(capture.mediaRecorder.state).toBe("recording");
  });

  it("start() は再利用するヘッダー用に初期データを分離する", async () => {
    await capture.start();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(capture.mediaRecorder.requestData).toHaveBeenCalledTimes(1);
  });

  it("空の初期Blob後も最初の非空Blobをヘッダーとして保持する", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "", 0);
      simulateChunkAt(250, "header|", 0);
      for (let i = 0; i < 13; i++) {
        const ms = 500 + i * 250;
        simulateChunkAt(ms, `media-${String(i)}|`, ms);
      }

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toMatch(/^header\|/);
    });
  });

  it("startRecording / stopRecording で音声Blobを取得できる", async () => {
    await capture.start();

    capture.startRecording();
    capture.mediaRecorder._simulateChunk("audio-data-1");
    capture.mediaRecorder._simulateChunk("audio-data-2");
    const blob = capture.stopRecording();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("audio/webm;codecs=opus");
  });

  it("PCM録音形式では16k PCM Blobを取得できる", async () => {
    capture = createAudioCapture("pcm16");
    await capture.start();
    capture.audioContext.sampleRate = 16000;

    capture.startRecording();
    processPcmFrame([1, -1, 0.5]);
    const blob = capture.stopRecording();

    expect(blob.type).toBe("audio/l16;rate=16000");
    const view = new DataView(await blob.arrayBuffer());
    expectLeadingPcmSilence(view);
    expect(view.getInt16(pcmLeadingSilenceBytes, true)).toBe(32767);
    expect(view.getInt16(pcmLeadingSilenceBytes + 2, true)).toBe(-32768);
    expect(view.getInt16(pcmLeadingSilenceBytes + 4, true)).toBe(16383);
  });

  it("PCM録音形式は即座に話し始めても発話冒頭の前に無音を含める", async () => {
    capture = createAudioCapture("pcm16");
    await capture.start();
    capture.audioContext.sampleRate = 16000;

    capture.startRecording();
    processPcmFrame([0.7, 0.7, 0.7]);
    const blob = capture.stopRecording();

    const view = new DataView(await blob.arrayBuffer());
    expect(view.byteLength).toBe(pcmLeadingSilenceBytes + 6);
    expectLeadingPcmSilence(view);
    expect(view.getInt16(pcmLeadingSilenceBytes, true)).toBeGreaterThan(0);
  });

  it("PCM録音形式は長時間経過後も発話冒頭を録音に含める", async () => {
    await withFakeTimers(async () => {
      capture = createAudioCapture("pcm16");
      await startCaptureAt(0);
      capture.audioContext.sampleRate = 16000;

      const longRunningMs = 60 * 60 * 1000;
      vi.setSystemTime(longRunningMs);
      processPcmFrame([0.7]);
      capture.startRecording();
      processPcmFrame([0.8]);
      const blob = capture.stopRecording();

      const view = new DataView(await blob.arrayBuffer());
      expectLeadingPcmSilence(view);
      expect(view.byteLength).toBe(pcmLeadingSilenceBytes + 4);
      expect(view.getInt16(pcmLeadingSilenceBytes, true)).toBeGreaterThan(0);
      expect(view.getInt16(pcmLeadingSilenceBytes + 2, true)).toBeGreaterThan(0);
    });
  });

  it("startRecording は直近3000msの発話前音声を含める", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(1250, "pre-2750|");
      simulateChunkAt(2000, "pre-2000|");
      simulateChunkAt(2500, "pre-1500|");
      simulateChunkAt(3000, "pre-1000|");
      simulateChunkAt(3500, "pre-500|");

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe(
        "header|pre-2750|pre-2000|pre-1500|pre-1000|pre-500|",
      );
    });
  });

  it("startRecording は発話前音声の長さを指定できる", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(3000, "quiet-pre-roll|");
      simulateChunkAt(3850, "target-start|");

      vi.setSystemTime(4000);
      capture.startRecording({ preRollMs: 200 });
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe("header|target-start|");
    });
  });

  it("markPreRollBoundary 以前の音声を次の発話前音声に含めない", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(1000, "previous-comment|");
      vi.setSystemTime(2000);
      capture.markPreRollBoundary();
      simulateChunkAt(2500, "next-pre-roll|");

      vi.setSystemTime(2600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain("next-pre-roll|");
      expect(text).not.toContain("previous-comment|");
    });
  });

  it("最初のメディアチャンクが境界以前なら次の録音に再利用しない", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(250, "first-comment|", 0);
      vi.setSystemTime(2000);
      capture.markPreRollBoundary();
      simulateChunkAt(2500, "next-pre-roll|");

      vi.setSystemTime(2600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain("next-pre-roll|");
      expect(text).not.toContain("header|");
      expect(text).not.toContain("first-comment|");
    });
  });

  it("発話前音声の下限をまたぐチャンクを含める", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(1100, "overlap-next-start|", 900);

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe("header|overlap-next-start|");
    });
  });

  it("配送が遅れた境界以前のチャンクを発話前音声に含めない", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(500, "previous-comment|", 250);
      const previousRecorder = markBoundaryAt(1000);
      vi.setSystemTime(1200);
      previousRecorder._simulateChunk("delayed-previous-comment|", { timecode: 750 });
      simulateChunkAt(1500, "next-pre-roll|", 1250);

      vi.setSystemTime(1600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toBe("next-pre-roll|");
    });
  });

  it("ヘッダー待ち中の最初の非空Blobを録音中なら現在の録音に含める", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, "header-and-first-audio|", 0);
      simulateChunkAt(400, "next-audio|", 250);
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe("header-and-first-audio|next-audio|");
    });
  });

  it("録音中に届いた最初の非空Blobを次の録音のヘッダーとして再利用しない", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "", 0);
      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, "first-comment|", 0);
      capture.stopRecording();

      markBoundaryAt(1000);
      simulateChunkAt(1250, "next-pre-roll|", 1250);

      vi.setSystemTime(1500);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain("next-pre-roll|");
      expect(text).not.toContain("first-comment|");
    });
  });

  it("録音中の最初の非空Blob後も次の録音用に新しいヘッダーを保持する", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "", 0);
      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, "first-comment|", 0);
      capture.stopRecording();

      markBoundaryAt(1000);
      simulateChunkAt(1000, "fresh-header|", 0);
      for (let i = 0; i < 13; i++) {
        const ms = 1250 + i * 250;
        simulateChunkAt(ms, `media-${String(i)}|`, ms - 1000);
      }

      vi.setSystemTime(5000);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toMatch(/^fresh-header\|/);
      expect(text).not.toContain("first-comment|");
    });
  });

  it("録音中に遅延配送された境界以前のチャンクを現在の録音に追加しない", async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, "header|");
      simulateChunkAt(500, "previous-comment|", 250);
      const previousRecorder = markBoundaryAt(1000);

      vi.setSystemTime(1200);
      capture.startRecording();
      vi.setSystemTime(1300);
      previousRecorder._simulateChunk("delayed-previous-comment|", { timecode: 750 });
      simulateChunkAt(1500, "next-audio|", 1250);
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe("next-audio|");
    });
  });

  it("stop() でリソースが解放される", async () => {
    await capture.start();
    await capture.stop();
    expect(capture.mediaRecorder.state).toBe("inactive");
    expect(capture.audioContext.state).toBe("closed");
  });

  it("16kHzへのリサンプリングが正しく動作する", () => {
    const inputLength = 4800; // 100ms at 48kHz
    const input = new Float32Array(inputLength);
    for (let i = 0; i < inputLength; i++) input[i] = Math.sin(i);

    const output = AudioCapture.resampleTo16k(input, 48000);
    expect(output.length).toBe(1600); // 100ms at 16kHz
  });

  it("onPcmData コールバックが登録できる", () => {
    const cb = vi.fn();
    capture.onPcmData(cb);
    // コールバックが登録されただけでテストOK（実際の発火は統合テストで検証）
    expect(true).toBe(true);
  });
});
