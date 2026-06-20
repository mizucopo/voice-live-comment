const MEDIA_RECORDER_TIMESLICE_MS = 250;
const PRE_ROLL_MS = 3000;
const MAX_PRE_ROLL_CHUNKS = Math.ceil(PRE_ROLL_MS / MEDIA_RECORDER_TIMESLICE_MS);
const PCM_SAMPLE_RATE = 16000;
// Grokに送るraw PCMが最初の発話サンプルから始まらないようにする。
const PCM_LEADING_SILENCE_MS = 500;
const PCM_LEADING_SILENCE_SAMPLES = Math.round((PCM_SAMPLE_RATE * PCM_LEADING_SILENCE_MS) / 1000);

export class AudioCapture {
  constructor({ recordingFormat = 'webm' } = {}) {
    this._recordingFormat = recordingFormat;
    this._stream = null;
    this._audioContext = null;
    this._mediaRecorder = null;
    this._scriptProcessor = null;
    this._pcmCallbacks = [];
    this._resetChunkState();
  }

  onPcmData(callback) {
    this._pcmCallbacks.push(callback);
  }

  get mediaRecorder() {
    return this._mediaRecorder;
  }

  get audioContext() {
    return this._audioContext;
  }

  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    try {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this._audioContext.createMediaStreamSource(this._stream);
      this._scriptProcessor = this._audioContext.createScriptProcessor(4096, 1, 1);

      this._scriptProcessor.onaudioprocess = (e) => {
        const pcmData = e.inputBuffer.getChannelData(0);
        const resampled = AudioCapture.resampleTo16k(pcmData, this._audioContext.sampleRate);
        if (this._recordingFormat === 'pcm16') {
          this._handlePcmData(resampled);
        }
        for (const cb of this._pcmCallbacks) {
          cb(resampled);
        }
      };

      source.connect(this._scriptProcessor);
      // ScriptProcessorはdestinationに接続しないとonaudioprocessが発火しないため、
      // GainNode(無音)を経由してフィードバックループを防止する
      const silentGain = this._audioContext.createGain();
      silentGain.gain.value = 0;
      this._scriptProcessor.connect(silentGain);
      silentGain.connect(this._audioContext.destination);

      const startedAtMs = Date.now();
      this._resetChunkState(startedAtMs);
      if (this._recordingFormat === 'webm') {
        this._startMediaRecorderSegment(startedAtMs);
      }
    } catch (e) {
      // 部分初期化済みリソースの解放
      try {
        if (this._scriptProcessor) {
          try { this._scriptProcessor.disconnect(); } catch (_) {}
        }
        if (this._audioContext && this._audioContext.state !== 'closed') {
          try { await this._audioContext.close(); } catch (_) {}
        }
        this._stream.getTracks().forEach(t => t.stop());
      } catch (_) {}
      this._stream = null;
      throw e;
    }
  }

  startRecording() {
    const chunks = [];
    if (this._headerChunk) {
      chunks.push(this._headerChunk);
    }
    const startedAtMs = Date.now();
    const preRollStartMs = Math.max(
      startedAtMs - PRE_ROLL_MS,
      this._preRollBoundaryMs
    );
    this._recordingPreRollStartMs = preRollStartMs;
    const preChunks = this._allChunks
      .filter((chunk) => (
        this._chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs
      ));
    for (const { data } of preChunks) {
      if (!chunks.includes(data)) {
        chunks.push(data);
      }
    }
    const prePcmChunks = this._recordingFormat === 'pcm16'
      ? this._allPcmChunks
        .filter((chunk) => (
          this._chunkOverlapsRecordingStart(chunk) && chunk.capturedFromMs <= startedAtMs
        ))
        .map(({ data }) => data)
      : [];
    this._recordingChunks = chunks;
    this._recordingPcmChunks = this._recordingFormat === 'pcm16'
      ? [
          new Float32Array(PCM_LEADING_SILENCE_SAMPLES),
          ...prePcmChunks
        ]
      : [];
    this._isRecording = true;
  }

  markPreRollBoundary() {
    const boundaryMs = Date.now();
    this._preRollBoundaryMs = boundaryMs;
    this._allChunks = this._allChunks
      .filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    this._allPcmChunks = this._allPcmChunks
      .filter(({ capturedToMs }) => capturedToMs > boundaryMs);
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._startMediaRecorderSegment(boundaryMs);
    }
  }

  stopRecording() {
    this._isRecording = false;
    if (this._recordingFormat === 'pcm16') {
      const blob = AudioCapture.float32FramesToPcm16Blob(this._recordingPcmChunks);
      this._recordingPcmChunks = [];
      this._recordingChunks = [];
      return blob;
    }

    const blob = new Blob(this._recordingChunks, { type: 'audio/webm;codecs=opus' });
    this._recordingChunks = [];
    this._recordingPcmChunks = [];
    return blob;
  }

  _resetChunkState(startedAtMs = 0) {
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

  _handlePcmData(frame) {
    const data = new Float32Array(frame);
    const durationMs = (data.length / 16000) * 1000;
    const capturedToMs = Math.max(
      this._lastPcmCapturedToMs + durationMs,
      Date.now()
    );
    const capturedFromMs = capturedToMs - durationMs;
    const chunk = { data, capturedFromMs, capturedToMs };

    this._lastPcmCapturedToMs = capturedToMs;
    this._allPcmChunks.push(chunk);
    this._trimBufferedPcmChunks();

    if (this._isRecording && this._chunkOverlapsRecordingStart(chunk)) {
      this._recordingPcmChunks.push(data);
    }
  }

  _handleDataAvailable(e, segmentId = this._segmentId) {
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
      capturedToMs
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

  _appendRecordingChunk(chunk) {
    if (!this._isRecording) {
      return;
    }
    if (!this._chunkOverlapsRecordingStart(chunk)) {
      return;
    }
    this._recordingChunks.push(chunk.data);
  }

  _chunkOverlapsRecordingStart(chunk) {
    return chunk.capturedToMs > this._recordingPreRollStartMs;
  }

  _startMediaRecorderSegment(startedAtMs) {
    const previousRecorder = this._mediaRecorder;
    this._segmentId += 1;

    this._headerChunk = null;
    this._expectingHeaderChunk = false;
    this._mediaRecorderStartedAtMs = startedAtMs;
    this._firstChunkTimecode = null;
    this._lastChunkCapturedToMs = startedAtMs;

    if (previousRecorder && previousRecorder.state !== 'inactive') {
      previousRecorder.stop();
    }

    this._mediaRecorder = new MediaRecorder(this._stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    const segmentId = this._segmentId;
    this._mediaRecorder.ondataavailable = (e) => {
      this._handleDataAvailable(e, segmentId);
    };
    this._mediaRecorder.start(MEDIA_RECORDER_TIMESLICE_MS);
    this._requestHeaderChunk();
  }

  _requestHeaderChunk() {
    if (typeof this._mediaRecorder.requestData !== 'function') return;

    // 最初のBlobがヘッダーと音声を併せ持つ前に、再利用するヘッダーだけを分離する。
    this._expectingHeaderChunk = true;
    try {
      this._mediaRecorder.requestData();
    } catch (_) {
      this._expectingHeaderChunk = false;
    }
  }

  _resolveChunkStartMs(e, deliveredAtMs) {
    if (Number.isFinite(e.timecode)) {
      if (this._firstChunkTimecode === null) {
        this._firstChunkTimecode = e.timecode;
      }
      return this._mediaRecorderStartedAtMs + Math.max(0, e.timecode - this._firstChunkTimecode);
    }

    return this._lastChunkCapturedToMs || deliveredAtMs;
  }

  _resolveChunkEndMs(capturedFromMs) {
    return capturedFromMs + MEDIA_RECORDER_TIMESLICE_MS;
  }

  _trimBufferedChunks() {
    this._allChunks = this._allChunks.slice(-MAX_PRE_ROLL_CHUNKS);
  }

  _trimBufferedPcmChunks() {
    const lowerBoundMs = Math.max(
      this._preRollBoundaryMs,
      this._lastPcmCapturedToMs - PRE_ROLL_MS
    );
    this._allPcmChunks = this._allPcmChunks
      .filter(({ capturedToMs }) => capturedToMs > lowerBoundMs);
  }

  async stop() {
    if (this._mediaRecorder && this._mediaRecorder.state !== 'inactive') {
      this._mediaRecorder.stop();
    }
    if (this._scriptProcessor) {
      this._scriptProcessor.disconnect();
    }
    if (this._audioContext && this._audioContext.state !== 'closed') {
      try {
        await this._audioContext.close();
      } catch (_) {
        // close() が失敗してもストリーム解放は継続
      }
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
  }

  static resampleTo16k(data, inputRate) {
    if (inputRate === 16000) return data;
    const ratio = inputRate / 16000;
    const newLength = Math.round(data.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      result[i] = data[srcIndexFloor] * (1 - fraction) + data[srcIndexCeil] * fraction;
    }
    return result;
  }

  static float32FramesToPcm16Blob(frames) {
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

    return new Blob([buffer], { type: 'audio/l16;rate=16000' });
  }
}
