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
      this._recordingChunks = [];
      this._isRecording = false;

      this._mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this._allChunks.push(e.data);
          // 最初のチャンク(WEBMヘッダー) + 直近19チャンク(約5秒分)に制限
          if (this._allChunks.length > 20) {
            this._allChunks = [this._allChunks[0], ...this._allChunks.slice(-19)];
          }
          if (this._isRecording) {
            this._recordingChunks.push(e.data);
          }
        }
      };

      this._mediaRecorder.start(250);
    } catch (e) {
      // 部分初期化済みリソースの解放
      if (this._scriptProcessor) {
        try { this._scriptProcessor.disconnect(); } catch (_) {}
      }
      if (this._audioContext && this._audioContext.state !== 'closed') {
        try { await this._audioContext.close(); } catch (_) {}
      }
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
      throw e;
    }
  }

  startRecording() {
    const chunks = [];
    // 最初のチャンク（WEBMヘッダーを含む）を必ず含める
    if (this._allChunks.length > 0) {
      chunks.push(this._allChunks[0]);
    }
    // 直近のチャンク（発話直前の音声コンテキスト）
    const preChunks = this._allChunks.slice(-2);
    for (const chunk of preChunks) {
      if (!chunks.includes(chunk)) {
        chunks.push(chunk);
      }
    }
    this._recordingChunks = chunks;
    this._isRecording = true;
  }

  stopRecording() {
    this._isRecording = false;
    const blob = new Blob(this._recordingChunks, { type: 'audio/webm;codecs=opus' });
    this._recordingChunks = [];
    return blob;
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
