import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vad } from '../src/vad.js';

describe('Vad', () => {
  let vad;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('init() が正常に完了する', async () => {
    vad = new Vad();
    await expect(vad.init()).resolves.toBeUndefined();
  });

  it('processFrame で音声区間を検出する', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

    // 閾値以上のエネルギー（振幅 0.5 の信号）
    const speechFrame = new Float32Array(480).fill(0.5);
    vad.processFrame(speechFrame);

    expect(onSpeechStart).toHaveBeenCalled();
  });

  it('閾値以下でspeechEndイベントが発火する', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    vad.onSpeechEnd(onSpeechEnd);

    // 音声フレーム（閾値以上）
    const speechFrame = new Float32Array(480).fill(0.5);
    vad.processFrame(speechFrame);
    expect(onSpeechStart).toHaveBeenCalled();

    // 無音フレーム（閾値以下）→ 1000ms後にspeechEnd
    vi.useFakeTimers();
    const silenceFrame = new Float32Array(480).fill(0.001);
    vad.processFrame(silenceFrame);
    vi.advanceTimersByTime(1000);
    expect(onSpeechEnd).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('無音フレームのみではspeechStartが発火しない', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

    const silenceFrame = new Float32Array(480).fill(0.001);
    vad.processFrame(silenceFrame);

    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it('destroy() でタイマーがクリアされる', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    vad.onSpeechEnd(onSpeechEnd);

    // 音声開始
    const speechFrame = new Float32Array(480).fill(0.5);
    vad.processFrame(speechFrame);
    expect(onSpeechStart).toHaveBeenCalled();

    // 無音 → destroy（タイマーキャンセル）
    vi.useFakeTimers();
    const silenceFrame = new Float32Array(480).fill(0.001);
    vad.processFrame(silenceFrame);
    vad.destroy();
    vi.advanceTimersByTime(1000);
    expect(onSpeechEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
