import { describe, expect, it } from "vitest";
import { AudioResampler } from "../src/audio-resampler.js";

function tone(inputRate: number, frequency: number, durationSeconds = 1): Float32Array {
  return Float32Array.from(
    { length: inputRate * durationSeconds },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * frequency * i) / inputRate),
  );
}

function rms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

describe("AudioResampler", () => {
  it.each([44100, 48000])("%iHzの分割入力でも同じ16kHz音声とサンプル数を保つ", (inputRate) => {
    const input = tone(inputRate, 1000);
    const expected = new AudioResampler(inputRate).process(input);
    const resampler = new AudioResampler(inputRate);
    const actual: number[] = [];
    const chunkSizes = [1, 4096, 17, 2048, 8191];
    let offset = 0;
    let chunkIndex = 0;
    while (offset < input.length) {
      const length = chunkSizes[chunkIndex % chunkSizes.length] ?? 1;
      actual.push(...resampler.process(input.subarray(offset, offset + length)));
      offset += length;
      chunkIndex++;
    }

    expect(actual).toHaveLength(16000);
    expect(Float32Array.from(actual)).toEqual(expected);
  });

  it.each([44100, 48000])("%iHzから変換しても音声帯域の音量を保つ", (inputRate) => {
    for (const frequency of [1000, 3000, 6000]) {
      const output = new AudioResampler(inputRate).process(tone(inputRate, frequency, 0.1));
      // 振幅0.1の正弦波のRMSは約0.07071。初期過渡応答を除き10%以内を維持する。
      expect(rms(output.subarray(160))).toBeGreaterThan(0.0636);
      expect(rms(output.subarray(160))).toBeLessThan(0.0778);
    }
  });

  it.each([44100, 48000])("%iHzから変換する際に8kHzを超える成分を抑える", (inputRate) => {
    for (const frequency of [8200, 12000]) {
      const output = new AudioResampler(inputRate).process(tone(inputRate, frequency, 0.1));

      expect(rms(output.subarray(160))).toBeLessThan(0.001);
    }
  });

  it("16kHz入力は値を変えず独立したPCMフレームとして渡す", () => {
    const input = Float32Array.from([0.5, -0.5, 0, 1, -1]);
    const output = new AudioResampler(16000).process(input);

    expect(output).toEqual(input);
    expect(output.buffer).not.toBe(input.buffer);
  });

  it("空フレームを挟んでも音声とサンプル位置を保つ", () => {
    const input = tone(44100, 1000, 0.1);
    const resampler = new AudioResampler(44100);
    const first = resampler.process(input.subarray(0, 17));
    const empty = resampler.process(new Float32Array());
    const second = resampler.process(input.subarray(17));

    expect(empty).toHaveLength(0);
    expect(Float32Array.from([...first, ...second])).toEqual(
      new AudioResampler(44100).process(input),
    );
  });
});
