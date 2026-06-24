import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vad } from '../src/vad.js';

describe('Vad', () => {
  let vad;
  const speechFrame = new Float32Array(480).fill(0.5);
  const silenceFrame = new Float32Array(480).fill(0.001);

  function processSustainedSpeech(vad, frame = speechFrame) {
    for (let i = 0; i < 7; i++) {
      vad.processFrame(frame);
    }
  }

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

    // 30ms * 6 = 180ms ではまだ開始しない
    for (let i = 0; i < 6; i++) {
      vad.processFrame(speechFrame);
    }
    expect(onSpeechStart).not.toHaveBeenCalled();

    // 30ms * 7 = 210ms で認識対象発話として扱う
    vad.processFrame(speechFrame);

    expect(onSpeechStart).toHaveBeenCalled();
  });

  it('短い非コメント音ではspeechStartが発火しない', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    const nonCommentSoundFrame = new Float32Array(480).fill(0.5);

    for (let i = 0; i < 6; i++) {
      vad.processFrame(nonCommentSoundFrame);
    }

    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it('短文コメントは認識対象継続時間を満たせばspeechStartが発火する', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

    processSustainedSpeech(vad);

    expect(onSpeechStart).toHaveBeenCalled();
  });

  it('デフォルトの認識音量しきい値未満ではspeechStartが発火しない', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

    processSustainedSpeech(vad, new Float32Array(480).fill(0.05));

    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it('認識音量しきい値を指定できる', async () => {
    vad = new Vad({ recognitionVolumeThreshold: 0.04 });
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

    processSustainedSpeech(vad, new Float32Array(480).fill(0.05));

    expect(onSpeechStart).toHaveBeenCalled();
  });

  it('閾値以下が3000ms続くとspeechEndイベントが発火する', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    vad.onSpeechEnd(onSpeechEnd);

    // 音声フレーム（閾値以上が200ms以上継続）
    processSustainedSpeech(vad);
    expect(onSpeechStart).toHaveBeenCalled();

    // 無音フレーム（閾値以下）→ 3000ms後にspeechEnd
    vi.useFakeTimers();
    vad.processFrame(silenceFrame);
    vi.advanceTimersByTime(2999);
    expect(onSpeechEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSpeechEnd).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('無音フレームのみではspeechStartが発火しない', async () => {
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    vad.onSpeechStart(onSpeechStart);

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
    processSustainedSpeech(vad);
    expect(onSpeechStart).toHaveBeenCalled();

    // 無音 → destroy（タイマーキャンセル）
    vi.useFakeTimers();
    vad.processFrame(silenceFrame);
    vad.destroy();
    vi.advanceTimersByTime(3000);
    expect(onSpeechEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
