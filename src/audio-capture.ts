/* eslint-disable @typescript-eslint/no-deprecated -- Chrome向け既存録音処理はScriptProcessorNodeを使用する。 */

const MEDIA_RECORDER_TIMESLICE_MS = 250;
const PRE_ROLL_MS = 3000;
const MAX_PRE_ROLL_CHUNKS = Math.ceil(PRE_ROLL_MS / MEDIA_RECORDER_TIMESLICE_MS);
const PCM_SAMPLE_RATE = 16000;
// Grokに送るraw PCMが最初の発話サンプルから始まらないようにする。
const PCM_LEADING_SILENCE_MS = 1000;
const PCM_LEADING_SILENCE_SAMPLES = Math.round((PCM_SAMPLE_RATE * PCM_LEADING_SILENCE_MS) / 1000);

export type RecordingFormat = "pcm16" | "webm";

type TimedChunk<T> = {
  data: T;
  capturedFromMs: number;
  capturedToMs: number;
};

export class AudioCapture {
  private readonly recordingFormat: RecordingFormat;
  private stream: MediaStream | null;
  private currentAudioContext: AudioContext | null;
  private currentMediaRecorder: MediaRecorder | null;
  private scriptProcessor: ScriptProcessorNode | null;
  private readonly pcmCallbacks: ((frame: Float32Array<ArrayBuffer>) => void)[];
  private isRecording = false;
  private recordingChunks: Blob[] = [];
  private recordingPcmChunks: Float32Array<ArrayBuffer>[] = [];
  private allChunks: TimedChunk<Blob>[] = [];
  private allPcmChunks: TimedChunk<Float32Array<ArrayBuffer>>[] = [];
  private headerChunk: Blob | null = null;
  private preRollBoundaryMs = 0;
  private mediaRecorderStartedAtMs = 0;
  private firstChunkTimecode: number | null = null;
  private lastChunkCapturedToMs = 0;
  private expectingHeaderChunk = false;
  private recordingPreRollStartMs = 0;
  private segmentId = 0;
  private lastPcmCapturedToMs = 0;

  constructor({ recordingFormat = "webm" }: { recordingFormat?: RecordingFormat } = {}) {
    this.recordingFormat = recordingFormat;
    this.stream = null;
    this.currentAudioContext = null;
    this.currentMediaRecorder = null;
    this.scriptProcessor = null;
    this.pcmCallbacks = [];
    this.resetChunkState();
  }

  onPcmData(callback: (frame: Float32Array<ArrayBuffer>) => void): void {
    this.pcmCallbacks.push(callback);
  }

  get mediaRecorder(): MediaRecorder | null {
    return this.currentMediaRecorder;
  }

  get audioContext(): AudioContext | null {
    return this.currentAudioContext;
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;

    try {
      const audioContext = new AudioContext();
      this.currentAudioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      this.scriptProcessor = scriptProcessor;

      scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        const pcmData = e.inputBuffer.getChannelData(0);
        const resampled = AudioCapture.resampleTo16k(pcmData, audioContext.sampleRate);
        if (this.recordingFormat === "pcm16") {
          this.handlePcmData(resampled);
        }
        for (const cb of this.pcmCallbacks) {
          cb(resampled);
        }
      };

      source.connect(scriptProcessor);
      // ScriptProcessorはdestinationに接続しないとonaudioprocessが発火しないため、
      // GainNode(無音)を経由してフィードバックループを防止する
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      scriptProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      const startedAtMs = Date.now();
      this.resetChunkState(startedAtMs);
      if (this.recordingFormat === "webm") {
        this.startMediaRecorderSegment(startedAtMs);
      }
    } catch (e) {
      // 部分初期化済みリソースの解放
      try {
        if (this.scriptProcessor) {
          try {
            this.scriptProcessor.disconnect();
          } catch {
            // Cleanup remains best-effort.
          }
        }
        if (this.currentAudioContext && this.currentAudioContext.state !== "closed") {
          try {
            await this.currentAudioContext.close();
          } catch {
            // Cleanup remains best-effort.
          }
        }
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      } catch {
        // Cleanup remains best-effort.
      }
      this.stream = null;
      throw e;
    }
  }

  startRecording({ preRollMs = PRE_ROLL_MS }: { preRollMs?: number } = {}): void {
    const chunks: Blob[] = [];
    if (this.headerChunk) {
      chunks.push(this.headerChunk);
    }
    const startedAtMs = Date.now();
    const boundedPreRollMs = Math.max(0, Math.min(PRE_ROLL_MS, preRollMs));
    const preRollStartMs = Math.max(startedAtMs - boundedPreRollMs, this.preRollBoundaryMs);
    this.recordingPreRollStartMs = preRollStartMs;
    const preChunks = this.allChunks.filter(
      (chunk) => this.chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs,
    );
    for (const { data } of preChunks) {
      if (!chunks.includes(data)) {
        chunks.push(data);
      }
    }
    const prePcmChunks =
      this.recordingFormat === "pcm16"
        ? this.allPcmChunks
            .filter(
              (chunk) =>
                this.chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs,
            )
            .map(({ data }) => data)
        : [];
    this.recordingChunks = chunks;
    this.recordingPcmChunks =
      this.recordingFormat === "pcm16"
        ? [new Float32Array(PCM_LEADING_SILENCE_SAMPLES), ...prePcmChunks]
        : [];
    this.isRecording = true;
  }

  markPreRollBoundary(): void {
    const boundaryMs = Date.now();
    this.preRollBoundaryMs = boundaryMs;
    this.allChunks = this.allChunks.filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    this.allPcmChunks = this.allPcmChunks.filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    if (this.currentMediaRecorder && this.currentMediaRecorder.state !== "inactive") {
      this.startMediaRecorderSegment(boundaryMs);
    }
  }

  stopRecording(): Blob {
    this.isRecording = false;
    if (this.recordingFormat === "pcm16") {
      const blob = AudioCapture.float32FramesToPcm16Blob(this.recordingPcmChunks);
      this.recordingPcmChunks = [];
      this.recordingChunks = [];
      return blob;
    }

    const blob = new Blob(this.recordingChunks, { type: "audio/webm;codecs=opus" });
    this.recordingChunks = [];
    this.recordingPcmChunks = [];
    return blob;
  }

  private resetChunkState(startedAtMs = 0): void {
    this.isRecording = false;
    this.recordingChunks = [];
    this.recordingPcmChunks = [];
    this.allChunks = [];
    this.allPcmChunks = [];
    this.headerChunk = null;
    this.preRollBoundaryMs = 0;
    this.mediaRecorderStartedAtMs = startedAtMs;
    this.firstChunkTimecode = null;
    this.lastChunkCapturedToMs = startedAtMs;
    this.expectingHeaderChunk = false;
    this.recordingPreRollStartMs = 0;
    this.segmentId = 0;
    this.lastPcmCapturedToMs = startedAtMs;
  }

  private handlePcmData(frame: Float32Array): void {
    const data = new Float32Array(frame);
    const durationMs = (data.length / PCM_SAMPLE_RATE) * 1000;
    const capturedToMs = Math.max(this.lastPcmCapturedToMs + durationMs, Date.now());
    const capturedFromMs = capturedToMs - durationMs;
    const chunk = { data, capturedFromMs, capturedToMs };

    this.lastPcmCapturedToMs = capturedToMs;
    this.allPcmChunks.push(chunk);
    this.trimBufferedPcmChunks();

    if (this.isRecording && this.chunkOverlapsRecordingStart(chunk)) {
      this.recordingPcmChunks.push(data);
    }
  }

  private handleDataAvailable(e: BlobEvent, segmentId = this.segmentId): void {
    if (segmentId !== this.segmentId) {
      return;
    }

    const data = e.data;
    if (data.size <= 0) {
      return;
    }

    const deliveredAtMs = Date.now();
    const capturedFromMs = this.resolveChunkStartMs(e, deliveredAtMs);
    const capturedToMs = this.resolveChunkEndMs(capturedFromMs);
    const chunk = {
      data,
      capturedFromMs,
      capturedToMs,
    };

    this.lastChunkCapturedToMs = capturedToMs;

    if (this.expectingHeaderChunk) {
      this.expectingHeaderChunk = false;
      if (this.isRecording) {
        this.appendRecordingChunk(chunk);
      } else {
        this.headerChunk = data;
      }
      return;
    }

    this.allChunks.push(chunk);
    this.trimBufferedChunks();
    this.appendRecordingChunk(chunk);
  }

  private appendRecordingChunk(chunk: TimedChunk<Blob>): void {
    if (!this.isRecording) {
      return;
    }
    if (!this.chunkOverlapsRecordingStart(chunk)) {
      return;
    }
    this.recordingChunks.push(chunk.data);
  }

  private chunkOverlapsRecordingStart(chunk: TimedChunk<unknown>): boolean {
    return chunk.capturedToMs > this.recordingPreRollStartMs;
  }

  private startMediaRecorderSegment(startedAtMs: number): void {
    const previousRecorder = this.currentMediaRecorder;
    this.segmentId += 1;

    this.headerChunk = null;
    this.expectingHeaderChunk = false;
    this.mediaRecorderStartedAtMs = startedAtMs;
    this.firstChunkTimecode = null;
    this.lastChunkCapturedToMs = startedAtMs;

    if (previousRecorder && previousRecorder.state !== "inactive") {
      previousRecorder.stop();
    }

    if (!this.stream) throw new Error("Audio stream is not initialized");
    const mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    this.currentMediaRecorder = mediaRecorder;
    const segmentId = this.segmentId;
    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      this.handleDataAvailable(e, segmentId);
    };
    mediaRecorder.start(MEDIA_RECORDER_TIMESLICE_MS);
    this.requestHeaderChunk();
  }

  private requestHeaderChunk(): void {
    const mediaRecorder = this.currentMediaRecorder;
    if (!mediaRecorder || typeof mediaRecorder.requestData !== "function") return;

    // 最初のBlobがヘッダーと音声を併せ持つ前に、再利用するヘッダーだけを分離する。
    this.expectingHeaderChunk = true;
    try {
      mediaRecorder.requestData();
    } catch {
      this.expectingHeaderChunk = false;
    }
  }

  private resolveChunkStartMs(e: BlobEvent, deliveredAtMs: number): number {
    if (Number.isFinite(e.timecode)) {
      this.firstChunkTimecode ??= e.timecode;
      return this.mediaRecorderStartedAtMs + Math.max(0, e.timecode - this.firstChunkTimecode);
    }

    return this.lastChunkCapturedToMs || deliveredAtMs;
  }

  private resolveChunkEndMs(capturedFromMs: number): number {
    return capturedFromMs + MEDIA_RECORDER_TIMESLICE_MS;
  }

  private trimBufferedChunks(): void {
    this.allChunks = this.allChunks.slice(-MAX_PRE_ROLL_CHUNKS);
  }

  private trimBufferedPcmChunks(): void {
    const lowerBoundMs = Math.max(this.preRollBoundaryMs, this.lastPcmCapturedToMs - PRE_ROLL_MS);
    this.allPcmChunks = this.allPcmChunks.filter(({ capturedToMs }) => capturedToMs > lowerBoundMs);
  }

  async stop(): Promise<void> {
    if (this.currentMediaRecorder && this.currentMediaRecorder.state !== "inactive") {
      this.currentMediaRecorder.stop();
    }
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
    }
    if (this.currentAudioContext && this.currentAudioContext.state !== "closed") {
      try {
        await this.currentAudioContext.close();
      } catch {
        // close() が失敗してもストリーム解放は継続
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }
  }

  static resampleTo16k(data: Float32Array, inputRate: number): Float32Array<ArrayBuffer> {
    if (inputRate === 16000) return new Float32Array(data);
    const ratio = inputRate / 16000;
    const newLength = Math.round(data.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      const floorSample = data[srcIndexFloor] ?? 0;
      const ceilSample = data[srcIndexCeil] ?? 0;
      result[i] = floorSample * (1 - fraction) + ceilSample * fraction;
    }
    return result;
  }

  static float32FramesToPcm16Blob(frames: readonly Float32Array[]): Blob {
    const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
    const buffer = new ArrayBuffer(totalLength * 2);
    const view = new DataView(buffer);
    let offset = 0;

    for (const frame of frames) {
      for (const sample of frame) {
        const clamped = Math.max(-1, Math.min(1, sample));
        const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/l16;rate=16000" });
  }
}
