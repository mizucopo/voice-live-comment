const MEDIA_RECORDER_TIMESLICE_MS = 250;
const PRE_ROLL_MS = 3000;
const MAX_PRE_ROLL_CHUNKS = Math.ceil(PRE_ROLL_MS / MEDIA_RECORDER_TIMESLICE_MS);

export class AudioCapture {
  constructor() {
    this._stream = null;
    this._audioContext = null;
    this._mediaRecorder = null;
    this._scriptProcessor = null;
    this._pcmCallbacks = [];
    this._isRecording = false;
    this._recordingChunks = [];
    this._allChunks = [];
    this._headerChunk = null;
    this._preRollBoundaryMs = 0;
    this._mediaRecorderStartedAtMs = 0;
    this._firstChunkTimecode = null;
    this._lastChunkCapturedToMs = 0;
    this._expectingHeaderChunk = false;
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

      this._mediaRecorder = new MediaRecorder(this._stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this._allChunks = [];
      this._headerChunk = null;
      this._recordingChunks = [];
      this._isRecording = false;
      this._preRollBoundaryMs = 0;
      this._mediaRecorderStartedAtMs = Date.now();
      this._firstChunkTimecode = null;
      this._lastChunkCapturedToMs = this._mediaRecorderStartedAtMs;
      this._expectingHeaderChunk = false;

      this._mediaRecorder.ondataavailable = (e) => {
        this._handleDataAvailable(e);
      };

      this._mediaRecorder.start(MEDIA_RECORDER_TIMESLICE_MS);
      this._requestHeaderChunk();
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
    const preChunks = this._allChunks
      .filter(({ capturedFromMs }) => (
        capturedFromMs >= preRollStartMs && capturedFromMs <= startedAtMs
      ));
    for (const { data: chunk } of preChunks) {
      if (!chunks.includes(chunk)) {
        chunks.push(chunk);
      }
    }
    this._recordingChunks = chunks;
    this._isRecording = true;
  }

  markPreRollBoundary() {
    this._preRollBoundaryMs = Date.now();
  }

  stopRecording() {
    this._isRecording = false;
    const blob = new Blob(this._recordingChunks, { type: 'audio/webm;codecs=opus' });
    this._recordingChunks = [];
    return blob;
  }

  _handleDataAvailable(e) {
    if (e.data.size <= 0) {
      if (this._expectingHeaderChunk) {
        this._expectingHeaderChunk = false;
      }
      return;
    }

    const deliveredAtMs = Date.now();
    const capturedFromMs = this._resolveChunkStartMs(e, deliveredAtMs);
    const chunk = {
      data: e.data,
      capturedFromMs
    };

    this._lastChunkCapturedToMs = deliveredAtMs;

    if (this._expectingHeaderChunk) {
      this._headerChunk = e.data;
      this._expectingHeaderChunk = false;
      return;
    }

    this._allChunks.push(chunk);
    this._trimBufferedChunks();
    if (this._isRecording) {
      this._recordingChunks.push(e.data);
    }
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

  _trimBufferedChunks() {
    this._allChunks = this._allChunks.slice(-MAX_PRE_ROLL_CHUNKS);
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
}
