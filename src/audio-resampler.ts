const OUTPUT_SAMPLE_RATE = 16000;
// Hamming窓の127tap FIR。48kHz入力で群遅延は63サンプル（約1.3ms）。
const FILTER_TAPS = 127;

export class AudioResampler {
  private readonly coefficients: Float64Array;
  private history = new Float64Array(FILTER_TAPS - 1);
  private previousFilteredSample = 0;
  private inputSamples = 0;
  private outputSamples = 0;

  // inputRateにはAudioContext.sampleRateを渡し、録音開始ごとに新しく生成する。
  constructor(readonly inputRate: number) {
    // 通常の44.1/48kHz入力では7kHzを遮断周波数にし、16kHzのNyquist周波数8kHzまで余裕を取る。
    const cutoff = Math.min(inputRate, OUTPUT_SAMPLE_RATE) * 0.4375;
    const center = (FILTER_TAPS - 1) / 2;
    this.coefficients = Float64Array.from({ length: FILTER_TAPS }, (_, i) => {
      const offset = i - center;
      const sinc =
        offset === 0
          ? (2 * cutoff) / inputRate
          : Math.sin((2 * Math.PI * cutoff * offset) / inputRate) / (Math.PI * offset);
      const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FILTER_TAPS - 1));
      return sinc * window;
    });
    const gain = this.coefficients.reduce((sum, coefficient) => sum + coefficient, 0);
    this.coefficients = this.coefficients.map((coefficient) => coefficient / gain);
  }

  process(data: Float32Array): Float32Array<ArrayBuffer> {
    if (this.inputRate === OUTPUT_SAMPLE_RATE) return new Float32Array(data);
    if (data.length === 0) return new Float32Array();

    const padded = new Float64Array(FILTER_TAPS - 1 + data.length);
    padded.set(this.history);
    padded.set(data, FILTER_TAPS - 1);
    const filtered = Float64Array.from({ length: data.length }, (_, i) => {
      let sample = 0;
      for (let tap = 0; tap < FILTER_TAPS; tap++) {
        sample += (padded[i + tap] ?? 0) * (this.coefficients[tap] ?? 0);
      }
      return sample;
    });
    const totalInputSamples = this.inputSamples + data.length;
    const totalOutputSamples = Math.floor(
      (totalInputSamples * OUTPUT_SAMPLE_RATE) / this.inputRate,
    );
    const result = Float32Array.from(
      { length: totalOutputSamples - this.outputSamples },
      (_, i) => {
        // 完了したサンプル区間から出力し、フレームごとの端数丸めを避ける。
        const position = ((this.outputSamples + i + 1) * this.inputRate) / OUTPUT_SAMPLE_RATE - 1;
        const start = Math.floor(position);
        const fraction = position - start;
        const relativeStart = start - this.inputSamples;
        const first =
          relativeStart < 0 ? this.previousFilteredSample : (filtered[relativeStart] ?? 0);
        return first * (1 - fraction) + (filtered[relativeStart + 1] ?? first) * fraction;
      },
    );
    this.history = padded.slice(-(FILTER_TAPS - 1));
    this.previousFilteredSample = filtered[filtered.length - 1] ?? this.previousFilteredSample;
    this.inputSamples = totalInputSamples;
    this.outputSamples = totalOutputSamples;
    return result;
  }
}
