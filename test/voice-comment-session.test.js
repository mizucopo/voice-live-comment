import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  emitError(error) {
    for (const callback of this._errorCallbacks) callback(error);
  }
}

async function flushAsyncWork() {
  await new Promise(resolve => setTimeout(resolve, 0));
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
    dependencies.loadSettings.mockResolvedValue({ sttProvider: 'google' });
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();

    expect(dependencies.createExternalPipeline).toHaveBeenCalledWith(provider);
    expect(pipeline.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyError).toHaveBeenCalledWith('接続テスト失敗');
    expect(session.snapshot()).toEqual({ isActive: false });
  });

  it('認識結果を投稿 module に渡す', async () => {
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();
    provider.emitStart();
    provider.emitResult('こんにちは');

    expect(dependencies.postComment).toHaveBeenCalledWith('こんにちは');
  });
});
