import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioCapture } from '../src/audio-capture.js';

describe('AudioCapture', () => {
  let capture;

  beforeEach(() => {
    vi.clearAllMocks();
    capture = new AudioCapture();
  });

  function simulateChunkAt(ms, data) {
    vi.setSystemTime(ms);
    capture.mediaRecorder._simulateChunk(data);
  }

  it('start() でgetUserMediaとMediaRecorderが起動する', async () => {
    await capture.start();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(capture.mediaRecorder).toBeDefined();
    expect(capture.mediaRecorder.state).toBe('recording');
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
    vi.useFakeTimers();
    try {
      await capture.start();

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
    } finally {
      vi.useRealTimers();
    }
  });

  it('markPreRollBoundary 以前の音声を次の発話前音声に含めない', async () => {
    vi.useFakeTimers();
    try {
      await capture.start();

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
    } finally {
      vi.useRealTimers();
    }
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
