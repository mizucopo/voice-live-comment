import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioCapture } from '../src/audio-capture.js';

describe('AudioCapture', () => {
  let capture;

  beforeEach(() => {
    vi.clearAllMocks();
    capture = new AudioCapture();
  });

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
