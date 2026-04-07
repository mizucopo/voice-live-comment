export class Vad {
  constructor() {
    this._session = null;
    this._ort = null;
    this._isSpeech = false;
    this._silenceTimer = null;
    this._speechStartCallbacks = [];
    this._speechEndCallbacks = [];
    this._frameQueue = [];
    this._isProcessing = false;
    this.THRESHOLD = 0.5;
    this.SILENCE_TIMEOUT_MS = 300;
    this.SAMPLE_RATE = 16000;
    this.FRAME_SIZE = 512; // 30ms at 16kHz
  }

  async init() {
    this._ort = await import('onnxruntime-web');
    const modelPath = chrome.runtime.getURL('models/silero-vad.onnx');
    this._session = await this._ort.InferenceSession.create(modelPath);
  }

  onSpeechStart(callback) {
    this._speechStartCallbacks.push(callback);
  }

  onSpeechEnd(callback) {
    this._speechEndCallbacks.push(callback);
  }

  processFrame(pcmData) {
    if (!this._session) return;

    for (let offset = 0; offset < pcmData.length; offset += this.FRAME_SIZE) {
      const end = Math.min(offset + this.FRAME_SIZE, pcmData.length);
      if (end - offset < this.FRAME_SIZE) continue;
      const frame = pcmData.slice(offset, end);
      this._frameQueue.push(frame);
    }

    this._processQueue();
  }

  async _processQueue() {
    if (this._isProcessing) return;
    this._isProcessing = true;

    while (this._frameQueue.length > 0) {
      const frame = this._frameQueue.shift();
      await this._runInference(frame);
    }

    this._isProcessing = false;
  }

  async _runInference(frame) {
    try {
      const tensor = new this._ort.Tensor('float32', frame, [1, this.FRAME_SIZE]);
      const srTensor = new this._ort.Tensor('int64', BigInt64Array.from([BigInt(this.SAMPLE_RATE)]), [1]);

      const feeds = {};
      feeds[this._session.inputNames[0]] = tensor;
      if (this._session.inputNames.length > 1) {
        feeds[this._session.inputNames[1]] = srTensor;
      }

      const results = await this._session.run(feeds);
      const probability = results[this._session.outputNames[0]].data[0];

      this._updateState(probability);
    } catch (error) {
      console.error('[VAD] 推論エラー:', error);
    }
  }

  _updateState(probability) {
    if (probability >= this.THRESHOLD && !this._isSpeech) {
      this._isSpeech = true;
      clearTimeout(this._silenceTimer);
      for (const cb of this._speechStartCallbacks) cb();
    } else if (probability < this.THRESHOLD && this._isSpeech) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = setTimeout(() => {
        this._isSpeech = false;
        for (const cb of this._speechEndCallbacks) cb();
      }, this.SILENCE_TIMEOUT_MS);
    } else if (probability >= this.THRESHOLD && this._isSpeech) {
      clearTimeout(this._silenceTimer);
    }
  }

  destroy() {
    clearTimeout(this._silenceTimer);
    this._frameQueue = [];
    this._isSpeech = false;
  }
}
