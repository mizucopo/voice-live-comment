import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOGNITION_VOLUME_THRESHOLD,
  RecognitionVolumeGate,
  calculateRms,
  formatRecognitionVolumeThreshold,
  normalizeRecognitionVolumeThreshold
} from '../src/recognition-volume-gate.js';

describe('recognition-volume-gate', () => {
  it('RMSを計算する', () => {
    expect(calculateRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('認識音量しきい値を範囲内に正規化する', () => {
    expect(normalizeRecognitionVolumeThreshold(undefined)).toBe(DEFAULT_RECOGNITION_VOLUME_THRESHOLD);
    expect(normalizeRecognitionVolumeThreshold(0.001)).toBe(0.01);
    expect(normalizeRecognitionVolumeThreshold(0.205)).toBe(0.2);
    expect(formatRecognitionVolumeThreshold(0.1)).toBe('0.10');
  });

  it('しきい値以上の音量が200ms続くまで認識対象発話にしない', () => {
    let now = 1000;
    const gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: 0.08,
      recognitionTargetDurationMs: 200,
      now: () => now
    });

    expect(gate.processFrame(new Float32Array(480).fill(0.1), { now })).toBe(false);
    now += 30;
    expect(gate.processFrame(new Float32Array(480).fill(0.1), { now })).toBe(false);
    now += 30;
    expect(gate.hasRecentTargetSpeech(3000, now)).toBe(false);

    for (let i = 0; i < 5; i++) {
      now += 30;
      gate.processFrame(new Float32Array(480).fill(0.1), { now });
    }

    expect(gate.hasRecentTargetSpeech(3000, now)).toBe(true);
  });

  it('短い非コメント音は認識対象発話にしない', () => {
    const gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: 0.08,
      recognitionTargetDurationMs: 200
    });
    const nonCommentSoundFrame = new Float32Array(480).fill(0.5);

    for (let i = 0; i < 6; i++) {
      expect(gate.processFrame(nonCommentSoundFrame)).toBe(false);
    }

    expect(gate.hasRecentTargetSpeech()).toBe(false);
  });

  it('短文コメントは認識対象継続時間を満たせば認識対象発話にする', () => {
    const gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: 0.08,
      recognitionTargetDurationMs: 200
    });
    const shortCommentFrame = new Float32Array(480).fill(0.5);
    let isRecognitionTarget = false;

    for (let i = 0; i < 7; i++) {
      isRecognitionTarget = gate.processFrame(shortCommentFrame) || isRecognitionTarget;
    }

    expect(isRecognitionTarget).toBe(true);
    expect(gate.hasRecentTargetSpeech()).toBe(true);
  });

  it('しきい値未満を挟むと継続時間をリセットする', () => {
    const gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: 0.08,
      recognitionTargetDurationMs: 200
    });

    for (let i = 0; i < 6; i++) {
      gate.processFrame(new Float32Array(480).fill(0.1));
    }
    gate.processFrame(new Float32Array(480).fill(0.01));
    gate.processFrame(new Float32Array(480).fill(0.1));

    expect(gate.hasRecentTargetSpeech()).toBe(false);
  });

  it('直近の認識対象発話を消費できる', () => {
    let now = 1000;
    const gate = new RecognitionVolumeGate({
      recognitionVolumeThreshold: 0.08,
      recognitionTargetDurationMs: 60,
      now: () => now
    });

    for (let i = 0; i < 2; i++) {
      now += 30;
      gate.processFrame(new Float32Array(480).fill(0.1), { now });
    }

    expect(gate.consumeRecentTargetSpeech(3000, now)).toBe(true);
    expect(gate.hasRecentTargetSpeech(3000, now)).toBe(false);
    expect(gate.consumeRecentTargetSpeech(3000, now)).toBe(false);
  });
});
