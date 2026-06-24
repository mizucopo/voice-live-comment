import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceCommentSession } from '../src/voice-comment-session.js';

class FakeProvider {
  constructor() {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.sendAudio = vi.fn().mockResolvedValue(undefined);
    this._startCallbacks = [];
    this._resultCallbacks = [];
    this._errorCallbacks = [];
  }

  onStart(callback) {
    this._startCallbacks.push(callback);
  }

  onResult(callback) {
    this._resultCallbacks.push(callback);
  }

  onError(callback) {
    this._errorCallbacks.push(callback);
  }

  emitStart() {
    for (const callback of this._startCallbacks) callback();
  }

  emitResult(text) {
    for (const callback of this._resultCallbacks) callback(text);
  }
}

async function flushAsyncWork() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('VoiceCommentSession', () => {
  let provider;
  let dependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new FakeProvider();
    dependencies = {
      loadSettings: vi.fn().mockResolvedValue({ sttProvider: 'browser' }),
      createProvider: vi.fn().mockReturnValue(provider),
      createExternalPipeline: vi.fn(),
      postComment: vi.fn(),
      notifyActive: vi.fn(),
      notifyError: vi.fn(),
      startTimeoutMs: 10000
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provider onStart 前の toggle では二重起動しない', async () => {
    const session = new VoiceCommentSession(dependencies);

    expect(session.toggle()).toEqual({ isActive: false });
    await flushAsyncWork();

    expect(session.toggle()).toEqual({ isActive: false });
    await flushAsyncWork();

    expect(dependencies.createProvider).toHaveBeenCalledTimes(1);
    expect(provider.start).toHaveBeenCalledTimes(1);

    provider.emitStart();

    expect(dependencies.notifyActive).toHaveBeenCalledWith(true);
    expect(session.toggle()).toEqual({ isActive: false });
    await flushAsyncWork();

    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyActive).toHaveBeenCalledWith(false);
  });

  it('外部 pipeline 初期化後に provider start が失敗したら cleanup する', async () => {
    const pipeline = { stop: vi.fn().mockResolvedValue(undefined) };
    provider.start.mockRejectedValueOnce(new Error('接続テスト失敗'));
    const settings = { sttProvider: 'google', recognitionVolumeThreshold: 0.12 };
    dependencies.loadSettings.mockResolvedValue(settings);
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();

    expect(dependencies.createExternalPipeline).toHaveBeenCalledWith(provider, settings);
    expect(pipeline.stop).toHaveBeenCalledTimes(1);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyError).toHaveBeenCalledWith('接続テスト失敗');
    expect(session.snapshot()).toEqual({ isActive: false });
  });

  it('Grokプロバイダー選択時に外部 pipeline を初期化する', async () => {
    const pipeline = { stop: vi.fn().mockResolvedValue(undefined) };
    const settings = { sttProvider: 'grok', recognitionVolumeThreshold: 0.1 };
    dependencies.loadSettings.mockResolvedValue(settings);
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();

    expect(dependencies.createExternalPipeline).toHaveBeenCalledWith(provider, settings);
  });

  it('認識結果を投稿 module に渡す', async () => {
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();
    provider.emitStart();
    provider.emitResult('こんにちは');

    expect(dependencies.postComment).toHaveBeenCalledWith('こんにちは');
  });

  it('開始タイムアウト時に保留中の provider を停止してから再試行を許可する', async () => {
    vi.useFakeTimers();
    dependencies.startTimeoutMs = 1000;
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);

    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyError).toHaveBeenCalledWith(
      '音声認識の開始がタイムアウトしました。再度お試しください。'
    );

    session.toggle();
    await Promise.resolve();

    expect(dependencies.createProvider).toHaveBeenCalledTimes(2);
  });

  it('stop 中に再開しても新しい provider を停止しない', async () => {
    const firstProvider = new FakeProvider();
    const secondProvider = new FakeProvider();
    const stopPipeline = createDeferred();
    const pipeline = { stop: vi.fn().mockReturnValue(stopPipeline.promise) };
    dependencies.loadSettings.mockResolvedValue({ sttProvider: 'google' });
    dependencies.createProvider
      .mockReturnValueOnce(firstProvider)
      .mockReturnValueOnce(secondProvider);
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();
    firstProvider.emitStart();

    const stopPromise = session.stop();
    session.toggle();
    await flushAsyncWork();

    stopPipeline.resolve();
    await stopPromise;

    expect(firstProvider.stop).toHaveBeenCalledTimes(1);
    expect(secondProvider.stop).not.toHaveBeenCalled();
  });
});
