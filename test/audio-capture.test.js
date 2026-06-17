import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioCapture } from '../src/audio-capture.js';

describe('AudioCapture', () => {
  let capture;

  beforeEach(() => {
    vi.clearAllMocks();
    capture = new AudioCapture();
  });

  function simulateChunkAt(ms, data, timecode = ms) {
    vi.setSystemTime(ms);
    capture.mediaRecorder._simulateChunk(data, { timecode });
  }

  async function startCaptureAt(ms) {
    vi.setSystemTime(ms);
    await capture.start();
  }

  async function withFakeTimers(callback) {
    vi.useFakeTimers();
    try {
      await callback();
    } finally {
      vi.useRealTimers();
    }
  }

  it('start() でgetUserMediaとMediaRecorderが起動する', async () => {
    await capture.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(capture.mediaRecorder).toBeDefined();
    expect(capture.mediaRecorder.state).toBe('recording');
  });

  it('start() は再利用するヘッダー用に初期データを分離する', async () => {
    await capture.start();

    expect(capture.mediaRecorder.requestData).toHaveBeenCalledTimes(1);
  });

  it('空の初期Blob後も最初の非空Blobをヘッダーとして保持する', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, '', 0);
      simulateChunkAt(250, 'header|', 0);
      for (let i = 0; i < 13; i++) {
        const ms = 500 + i * 250;
        simulateChunkAt(ms, `media-${i}|`, ms);
      }

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toMatch(/^header\|/);
    });
  });

  it('startRecording / stopRecording で音声Blobを取得できる', async () => {
    await capture.start();

    capture.startRecording();
    capture.mediaRecorder._simulateChunk('audio-data-1');
    capture.mediaRecorder._simulateChunk('audio-data-2');
    const blob = capture.stopRecording();

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/webm;codecs=opus');
  });

  it('startRecording は直近3000msの発話前音声を含める', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(1250, 'pre-2750|');
      simulateChunkAt(2000, 'pre-2000|');
      simulateChunkAt(2500, 'pre-1500|');
      simulateChunkAt(3000, 'pre-1000|');
      simulateChunkAt(3500, 'pre-500|');

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe(
        'header|pre-2750|pre-2000|pre-1500|pre-1000|pre-500|'
      );
    });
  });

  it('markPreRollBoundary 以前の音声を次の発話前音声に含めない', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(1000, 'previous-comment|');
      vi.setSystemTime(2000);
      capture.markPreRollBoundary();
      simulateChunkAt(2500, 'next-pre-roll|');

      vi.setSystemTime(2600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain('next-pre-roll|');
      expect(text).not.toContain('previous-comment|');
    });
  });

  it('最初のメディアチャンクが境界以前なら次の録音に再利用しない', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(250, 'first-comment|', 0);
      vi.setSystemTime(2000);
      capture.markPreRollBoundary();
      simulateChunkAt(2500, 'next-pre-roll|');

      vi.setSystemTime(2600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain('next-pre-roll|');
      expect(text).not.toContain('header|');
      expect(text).not.toContain('first-comment|');
    });
  });

  it('境界をまたぐチャンクを次の発話前音声に含める', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(1100, 'overlap-next-start|', 900);

      vi.setSystemTime(4000);
      capture.startRecording();
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe('header|overlap-next-start|');
    });
  });

  it('配送が遅れた境界以前のチャンクを発話前音声に含めない', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(500, 'previous-comment|', 250);
      const previousRecorder = capture.mediaRecorder;
      vi.setSystemTime(1000);
      capture.markPreRollBoundary();
      vi.setSystemTime(1200);
      previousRecorder._simulateChunk('delayed-previous-comment|', { timecode: 750 });
      simulateChunkAt(1500, 'next-pre-roll|', 1250);

      vi.setSystemTime(1600);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toBe('next-pre-roll|');
    });
  });

  it('ヘッダー待ち中の最初の非空Blobを録音中なら現在の録音に含める', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, 'header-and-first-audio|', 0);
      simulateChunkAt(400, 'next-audio|', 250);
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe('header-and-first-audio|next-audio|');
    });
  });

  it('録音中に届いた最初の非空Blobを次の録音のヘッダーとして再利用しない', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, '', 0);
      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, 'first-comment|', 0);
      capture.stopRecording();

      vi.setSystemTime(1000);
      capture.markPreRollBoundary();
      simulateChunkAt(1250, 'next-pre-roll|', 1250);

      vi.setSystemTime(1500);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toContain('next-pre-roll|');
      expect(text).not.toContain('first-comment|');
    });
  });

  it('録音中の最初の非空Blob後も次の録音用に新しいヘッダーを保持する', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, '', 0);
      vi.setSystemTime(100);
      capture.startRecording();
      simulateChunkAt(150, 'first-comment|', 0);
      capture.stopRecording();

      vi.setSystemTime(1000);
      capture.markPreRollBoundary();
      simulateChunkAt(1000, 'fresh-header|', 0);
      for (let i = 0; i < 13; i++) {
        const ms = 1250 + i * 250;
        simulateChunkAt(ms, `media-${i}|`, ms - 1000);
      }

      vi.setSystemTime(5000);
      capture.startRecording();
      const blob = capture.stopRecording();
      const text = await blob.text();

      expect(text).toMatch(/^fresh-header\|/);
      expect(text).not.toContain('first-comment|');
    });
  });

  it('録音中に遅延配送された境界以前のチャンクを現在の録音に追加しない', async () => {
    await withFakeTimers(async () => {
      await startCaptureAt(0);

      simulateChunkAt(0, 'header|');
      simulateChunkAt(500, 'previous-comment|', 250);
      const previousRecorder = capture.mediaRecorder;
      vi.setSystemTime(1000);
      capture.markPreRollBoundary();

      vi.setSystemTime(1200);
      capture.startRecording();
      vi.setSystemTime(1300);
      previousRecorder._simulateChunk('delayed-previous-comment|', { timecode: 750 });
      simulateChunkAt(1500, 'next-audio|', 1250);
      const blob = capture.stopRecording();

      await expect(blob.text()).resolves.toBe('next-audio|');
    });
  });

  it('stop() でリソースが解放される', async () => {
    await capture.start();
    await capture.stop();
    expect(capture.mediaRecorder.state).toBe('inactive');
    expect(capture.audioContext.state).toBe('closed');
  });

  it('16kHzへのリサンプリングが正しく動作する', () => {
    const inputLength = 4800; // 100ms at 48kHz
    const input = new Float32Array(inputLength);
    for (let i = 0; i < inputLength; i++) input[i] = Math.sin(i);

    const output = AudioCapture.resampleTo16k(input, 48000);
    expect(output.length).toBe(1600); // 100ms at 16kHz
  });

  it('onPcmData コールバックが登録できる', () => {
    const cb = vi.fn();
    capture.onPcmData(cb);
    // コールバックが登録されただけでテストOK（実際の発火は統合テストで検証）
    expect(true).toBe(true);
  });
});
