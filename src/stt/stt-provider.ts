import type { RecordingFormat } from "../audio-capture.js";

export type SttResultCallback = (text: string) => void;
export type SttErrorCallback = (error: Error) => void;
export type SttLifecycleCallback = () => void;

export class SttProvider {
  recordingFormat: RecordingFormat = "webm";
  readonly _resultCallbacks: SttResultCallback[];
  readonly _errorCallbacks: SttErrorCallback[];
  readonly _startCallbacks: SttLifecycleCallback[];
  readonly _stopCallbacks: SttLifecycleCallback[];

  constructor() {
    this._resultCallbacks = [];
    this._errorCallbacks = [];
    this._startCallbacks = [];
    this._stopCallbacks = [];
  }

  start(): Promise<void> {
    return Promise.reject(new Error("start() must be implemented"));
  }

  stop(): Promise<void> {
    return Promise.reject(new Error("stop() must be implemented"));
  }

  sendAudio(audioBlob: Blob): Promise<void> {
    void audioBlob;
    return Promise.resolve();
  }

  onResult(callback: SttResultCallback): void {
    this._resultCallbacks.push(callback);
  }

  onError(callback: SttErrorCallback): void {
    this._errorCallbacks.push(callback);
  }

  onStart(callback: SttLifecycleCallback): void {
    this._startCallbacks.push(callback);
  }

  onStop(callback: SttLifecycleCallback): void {
    this._stopCallbacks.push(callback);
  }

  _emitResult(text: string): void {
    for (const cb of this._resultCallbacks) cb(text);
  }

  _emitError(error: Error): void {
    for (const cb of this._errorCallbacks) cb(error);
  }

  _emitStart(): void {
    for (const cb of this._startCallbacks) cb();
  }

  _emitStop(): void {
    for (const cb of this._stopCallbacks) cb();
  }
}
