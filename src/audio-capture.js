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
    this._scriptProcessor.connect(this._audioContext.destination);

    this._mediaRecorder = new MediaRecorder(this._stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    this._allChunks = [];
    this._recordingChunks = [];
    this._isRecording = false;

    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this._allChunks.push(e.data);
        if (this._isRecording) {
          this._recordingChunks.push(e.data);
        }
      }
    };

    this._mediaRecorder.start(250);
  }

  startRecording() {
    const preChunks = this._allChunks.slice(-2);
    this._recordingChunks = [...preChunks];
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
      await this._audioContext.close();
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
