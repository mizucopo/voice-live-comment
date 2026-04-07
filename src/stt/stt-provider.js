export class SttProvider {
  constructor() {
    this._resultCallbacks = [];
    this._errorCallbacks = [];
    this._startCallbacks = [];
    this._stopCallbacks = [];
  }

  async start() {
    throw new Error('start() must be implemented');
  }

  async stop() {
    throw new Error('stop() must be implemented');
  }

  async sendAudio(_audioBlob) {
    // no-op: browser provider doesn't need audio data
  }

  onResult(callback) {
    this._resultCallbacks.push(callback);
  }

  onError(callback) {
    this._errorCallbacks.push(callback);
  }

  onStart(callback) {
    this._startCallbacks.push(callback);
  }

  onStop(callback) {
    this._stopCallbacks.push(callback);
  }

  _emitResult(text) {
    for (const cb of this._resultCallbacks) cb(text);
  }

  _emitError(error) {
    for (const cb of this._errorCallbacks) cb(error);
  }

  _emitStart() {
    for (const cb of this._startCallbacks) cb();
  }

  _emitStop() {
    for (const cb of this._stopCallbacks) cb();
  }
}
