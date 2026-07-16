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
  private readonly _recordingFormat: RecordingFormat;
  private _stream: MediaStream | null;
  private _audioContext: AudioContext | null;
  private _mediaRecorder: MediaRecorder | null;
  private _scriptProcessor: ScriptProcessorNode | null;
  private readonly _pcmCallbacks: ((frame: Float32Array<ArrayBuffer>) => void)[];
  private _isRecording = false;
  private _recordingChunks: Blob[] = [];
  private _recordingPcmChunks: Float32Array<ArrayBuffer>[] = [];
  private _allChunks: TimedChunk<Blob>[] = [];
  private _allPcmChunks: TimedChunk<Float32Array<ArrayBuffer>>[] = [];
  private _headerChunk: Blob | null = null;
  private _preRollBoundaryMs = 0;
  private _mediaRecorderStartedAtMs = 0;
  private _firstChunkTimecode: number | null = null;
  private _lastChunkCapturedToMs = 0;
  private _expectingHeaderChunk = false;
  private _recordingPreRollStartMs = 0;
  private _segmentId = 0;
  private _lastPcmCapturedToMs = 0;

  constructor({ recordingFormat = "webm" }: { recordingFormat?: RecordingFormat } = {}) {
    this._recordingFormat = recordingFormat;
    this._stream = null;
    this._audioContext = null;
    this._mediaRecorder = null;
    this._scriptProcessor = null;
    this._pcmCallbacks = [];
    this._resetChunkState();
  }

  onPcmData(callback: (frame: Float32Array<ArrayBuffer>) => void): void {
    this._pcmCallbacks.push(callback);
  }

  get mediaRecorder(): MediaRecorder | null {
    return this._mediaRecorder;
  }

  get audioContext(): AudioContext | null {
    return this._audioContext;
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._stream = stream;

    try {
      const audioContext = new AudioContext();
      this._audioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      this._scriptProcessor = scriptProcessor;

      scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        const pcmData = e.inputBuffer.getChannelData(0);
        const resampled = AudioCapture.resampleTo16k(pcmData, audioContext.sampleRate);
        if (this._recordingFormat === "pcm16") {
          this._handlePcmData(resampled);
        }
        for (const cb of this._pcmCallbacks) {
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
      this._resetChunkState(startedAtMs);
      if (this._recordingFormat === "webm") {
        this._startMediaRecorderSegment(startedAtMs);
      }
    } catch (e) {
      // 部分初期化済みリソースの解放
      try {
        if (this._scriptProcessor) {
          try {
            this._scriptProcessor.disconnect();
          } catch {
            // Cleanup remains best-effort.
          }
        }
        if (this._audioContext && this._audioContext.state !== "closed") {
          try {
            await this._audioContext.close();
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
      this._stream = null;
      throw e;
    }
  }

  startRecording({ preRollMs = PRE_ROLL_MS }: { preRollMs?: number } = {}): void {
    const chunks: Blob[] = [];
    if (this._headerChunk) {
      chunks.push(this._headerChunk);
    }
    const startedAtMs = Date.now();
    const boundedPreRollMs = Math.max(0, Math.min(PRE_ROLL_MS, preRollMs));
    const preRollStartMs = Math.max(startedAtMs - boundedPreRollMs, this._preRollBoundaryMs);
    this._recordingPreRollStartMs = preRollStartMs;
    const preChunks = this._allChunks.filter(
      (chunk) => this._chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs,
    );
    for (const { data } of preChunks) {
      if (!chunks.includes(data)) {
        chunks.push(data);
      }
    }
    const prePcmChunks =
      this._recordingFormat === "pcm16"
        ? this._allPcmChunks
            .filter(
              (chunk) =>
                this._chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs,
            )
            .map(({ data }) => data)
        : [];
    this._recordingChunks = chunks;
    this._recordingPcmChunks =
      this._recordingFormat === "pcm16"
        ? [new Float32Array(PCM_LEADING_SILENCE_SAMPLES), ...prePcmChunks]
        : [];
    this._isRecording = true;
  }

  markPreRollBoundary(): void {
    const boundaryMs = Date.now();
    this._preRollBoundaryMs = boundaryMs;
    this._allChunks = this._allChunks.filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    this._allPcmChunks = this._allPcmChunks.filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      this._startMediaRecorderSegment(boundaryMs);
    }
  }

  stopRecording(): Blob {
    this._isRecording = false;
    if (this._recordingFormat === "pcm16") {
      const blob = AudioCapture.float32FramesToPcm16Blob(this._recordingPcmChunks);
      this._recordingPcmChunks = [];
      this._recordingChunks = [];
      return blob;
    }

    const blob = new Blob(this._recordingChunks, { type: "audio/webm;codecs=opus" });
    this._recordingChunks = [];
    this._recordingPcmChunks = [];
    return blob;
  }

  private _resetChunkState(startedAtMs = 0): void {
    this._isRecording = false;
    this._recordingChunks = [];
    this._recordingPcmChunks = [];
    this._allChunks = [];
    this._allPcmChunks = [];
    this._headerChunk = null;
    this._preRollBoundaryMs = 0;
    this._mediaRecorderStartedAtMs = startedAtMs;
    this._firstChunkTimecode = null;
    this._lastChunkCapturedToMs = startedAtMs;
    this._expectingHeaderChunk = false;
    this._recordingPreRollStartMs = 0;
    this._segmentId = 0;
    this._lastPcmCapturedToMs = startedAtMs;
  }

  private _handlePcmData(frame: Float32Array): void {
    const data = new Float32Array(frame);
    const durationMs = (data.length / PCM_SAMPLE_RATE) * 1000;
    const capturedToMs = Math.max(this._lastPcmCapturedToMs + durationMs, Date.now());
    const capturedFromMs = capturedToMs - durationMs;
    const chunk = { data, capturedFromMs, capturedToMs };

    this._lastPcmCapturedToMs = capturedToMs;
    this._allPcmChunks.push(chunk);
    this._trimBufferedPcmChunks();

    if (this._isRecording && this._chunkOverlapsRecordingStart(chunk)) {
      this._recordingPcmChunks.push(data);
    }
  }

  private _handleDataAvailable(e: BlobEvent, segmentId = this._segmentId): void {
    if (segmentId !== this._segmentId) {
      return;
    }

    const data = e.data;
    if (data.size <= 0) {
      return;
    }

    const deliveredAtMs = Date.now();
    const capturedFromMs = this._resolveChunkStartMs(e, deliveredAtMs);
    const capturedToMs = this._resolveChunkEndMs(capturedFromMs);
    const chunk = {
      data,
      capturedFromMs,
      capturedToMs,
    };

    this._lastChunkCapturedToMs = capturedToMs;

    if (this._expectingHeaderChunk) {
      this._expectingHeaderChunk = false;
      if (this._isRecording) {
        this._appendRecordingChunk(chunk);
      } else {
        this._headerChunk = data;
      }
      return;
    }

    this._allChunks.push(chunk);
    this._trimBufferedChunks();
    this._appendRecordingChunk(chunk);
  }

  private _appendRecordingChunk(chunk: TimedChunk<Blob>): void {
    if (!this._isRecording) {
      return;
    }
    if (!this._chunkOverlapsRecordingStart(chunk)) {
      return;
    }
    this._recordingChunks.push(chunk.data);
  }

  private _chunkOverlapsRecordingStart(chunk: TimedChunk<unknown>): boolean {
    return chunk.capturedToMs > this._recordingPreRollStartMs;
  }

  private _startMediaRecorderSegment(startedAtMs: number): void {
    const previousRecorder = this._mediaRecorder;
    this._segmentId += 1;

    this._headerChunk = null;
    this._expectingHeaderChunk = false;
    this._mediaRecorderStartedAtMs = startedAtMs;
    this._firstChunkTimecode = null;
    this._lastChunkCapturedToMs = startedAtMs;

    if (previousRecorder && previousRecorder.state !== "inactive") {
      previousRecorder.stop();
    }

    if (!this._stream) throw new Error("Audio stream is not initialized");
    const mediaRecorder = new MediaRecorder(this._stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    this._mediaRecorder = mediaRecorder;
    const segmentId = this._segmentId;
    mediaRecorder.ondataavailable = (e: BlobEvent) => {
      this._handleDataAvailable(e, segmentId);
    };
    mediaRecorder.start(MEDIA_RECORDER_TIMESLICE_MS);
    this._requestHeaderChunk();
  }

  private _requestHeaderChunk(): void {
    const mediaRecorder = this._mediaRecorder;
    if (!mediaRecorder || typeof mediaRecorder.requestData !== "function") return;

    // 最初のBlobがヘッダーと音声を併せ持つ前に、再利用するヘッダーだけを分離する。
    this._expectingHeaderChunk = true;
    try {
      mediaRecorder.requestData();
    } catch {
      this._expectingHeaderChunk = false;
    }
  }

  private _resolveChunkStartMs(e: BlobEvent, deliveredAtMs: number): number {
    if (Number.isFinite(e.timecode)) {
      this._firstChunkTimecode ??= e.timecode;
      return this._mediaRecorderStartedAtMs + Math.max(0, e.timecode - this._firstChunkTimecode);
    }

    return this._lastChunkCapturedToMs || deliveredAtMs;
  }

  private _resolveChunkEndMs(capturedFromMs: number): number {
    return capturedFromMs + MEDIA_RECORDER_TIMESLICE_MS;
  }

  private _trimBufferedChunks(): void {
    this._allChunks = this._allChunks.slice(-MAX_PRE_ROLL_CHUNKS);
  }

  private _trimBufferedPcmChunks(): void {
    const lowerBoundMs = Math.max(this._preRollBoundaryMs, this._lastPcmCapturedToMs - PRE_ROLL_MS);
    this._allPcmChunks = this._allPcmChunks.filter(
      ({ capturedToMs }) => capturedToMs > lowerBoundMs,
    );
  }

  async stop(): Promise<void> {
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      this._mediaRecorder.stop();
    }
    if (this._scriptProcessor) {
      this._scriptProcessor.disconnect();
    }
    if (this._audioContext && this._audioContext.state !== "closed") {
      try {
        await this._audioContext.close();
      } catch {
        // close() が失敗してもストリーム解放は継続
      }
    }
    if (this._stream) {
      this._stream.getTracks().forEach((track) => {
        track.stop();
      });
      this._stream = null;
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
