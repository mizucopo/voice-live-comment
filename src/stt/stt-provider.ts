import type { RecordingFormat } from "../audio-capture.js";

export type SttResultCallback = (text: string) => void;
export type SttErrorCallback = (error: Error) => void;
export type SttLifecycleCallback = () => void;

export class SttProvider {
  recordingFormat: RecordingFormat = "webm";
  readonly resultCallbacks: SttResultCallback[];
  readonly errorCallbacks: SttErrorCallback[];
  readonly startCallbacks: SttLifecycleCallback[];
  readonly stopCallbacks: SttLifecycleCallback[];

  constructor() {
    this.resultCallbacks = [];
    this.errorCallbacks = [];
    this.startCallbacks = [];
    this.stopCallbacks = [];
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
    this.resultCallbacks.push(callback);
  }

  onError(callback: SttErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  onStart(callback: SttLifecycleCallback): void {
    this.startCallbacks.push(callback);
  }

  onStop(callback: SttLifecycleCallback): void {
    this.stopCallbacks.push(callback);
  }

  emitResult(text: string): void {
    for (const cb of this.resultCallbacks) cb(text);
  }

  emitError(error: Error): void {
    for (const cb of this.errorCallbacks) cb(error);
  }

  emitStart(): void {
    for (const cb of this.startCallbacks) cb();
  }

  emitStop(): void {
    for (const cb of this.stopCallbacks) cb();
  }
}
