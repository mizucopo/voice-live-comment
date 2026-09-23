import { describe, it, expect, vi, beforeEach, afterEach, type Mocked } from "vitest";
import {
  VoiceCommentSession,
  type VoiceCommentSessionDependencies,
} from "../src/voice-comment-session.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { SttProvider } from "../src/stt/stt-provider.js";

class FakeProvider extends SttProvider {
  override readonly start = vi.fn().mockResolvedValue(undefined);
  override readonly stop = vi.fn().mockResolvedValue(undefined);
  override readonly sendAudio = vi.fn().mockResolvedValue(undefined);
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = () => {
      promiseResolve();
    };
  });
  return { promise, resolve };
}

describe("VoiceCommentSession", () => {
  let provider: FakeProvider;
  let dependencies: Mocked<VoiceCommentSessionDependencies>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new FakeProvider();
    dependencies = {
      loadSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      createProvider: vi.fn().mockReturnValue(provider),
      createExternalPipeline: vi.fn(),
      postComment: vi.fn(),
      notifyActive: vi.fn(),
      notifyError: vi.fn(),
      startTimeoutMs: 10000,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("provider onStart 前の toggle では二重起動しない", async () => {
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

  it("外部 pipeline 初期化後に provider start が失敗したら cleanup する", async () => {
    const pipeline = { stop: vi.fn().mockResolvedValue(undefined) };
    provider.start.mockRejectedValueOnce(new Error("接続テスト失敗"));
    const settings = {
      ...DEFAULT_SETTINGS,
      sttProvider: "google" as const,
      recognitionVolumeThreshold: 0.12,
    };
    dependencies.loadSettings.mockResolvedValue(settings);
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();

    expect(dependencies.createExternalPipeline).toHaveBeenCalledWith(provider, settings);
    expect(pipeline.stop).toHaveBeenCalledTimes(1);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyError).toHaveBeenCalledWith("接続テスト失敗");
    expect(session.snapshot()).toEqual({ isActive: false });
  });

  it("Grokプロバイダー選択時に外部 pipeline を初期化する", async () => {
    const pipeline = { stop: vi.fn().mockResolvedValue(undefined) };
    const settings = {
      ...DEFAULT_SETTINGS,
      sttProvider: "grok" as const,
      recognitionVolumeThreshold: 0.1,
    };
    dependencies.loadSettings.mockResolvedValue(settings);
    dependencies.createExternalPipeline.mockResolvedValue(pipeline);
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();

    expect(dependencies.createExternalPipeline).toHaveBeenCalledWith(provider, settings);
  });

  it("認識結果を投稿 module に渡す", async () => {
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await flushAsyncWork();
    provider.emitStart();
    provider.emitResult("こんにちは");

    expect(dependencies.postComment).toHaveBeenCalledWith("こんにちは", {
      settings: DEFAULT_SETTINGS,
      signal: expect.any(AbortSignal),
    });
  });

  it("開始タイムアウト時に保留中の provider を停止してから再試行を許可する", async () => {
    vi.useFakeTimers();
    dependencies.startTimeoutMs = 1000;
    const session = new VoiceCommentSession(dependencies);

    session.toggle();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);

    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(dependencies.notifyError).toHaveBeenCalledWith(
      "音声認識の開始がタイムアウトしました。再度お試しください。",
    );

    session.toggle();
    await Promise.resolve();

    expect(dependencies.createProvider).toHaveBeenCalledTimes(2);
  });

  it("stop 中に再開しても新しい provider を停止しない", async () => {
    const firstProvider = new FakeProvider();
    const secondProvider = new FakeProvider();
    const stopPipeline = createDeferred();
    const pipeline = { stop: vi.fn().mockReturnValue(stopPipeline.promise) };
    dependencies.loadSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      sttProvider: "google",
    });
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

  it.each(["browser", "google", "grok"] as const)(
    "%s の停止時は投稿を即座に取り消し、古い結果を再開後にも渡さない",
    async (sttProvider) => {
      dependencies.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, sttProvider });
      const deferredStop = createDeferred();
      const pipeline = { stop: vi.fn().mockReturnValue(deferredStop.promise) };
      dependencies.createExternalPipeline.mockResolvedValue(pipeline);
      const session = new VoiceCommentSession(dependencies);
      session.toggle();
      await flushAsyncWork();
      provider.emitStart();
      provider.emitResult("最初のコメント");
      const context = dependencies.postComment.mock.calls[0]?.[1];
      expect(context?.signal.aborted).toBe(false);

      const oldProvider = provider;
      const stopping = session.stop();
      expect(context?.signal.aborted).toBe(true);
      oldProvider.emitResult("停止後の結果");
      const newProvider = new FakeProvider();
      dependencies.createProvider.mockReturnValue(newProvider);
      session.toggle();
      await flushAsyncWork();
      newProvider.emitStart();
      oldProvider.emitStart();
      oldProvider.emitResult("再開後に遅れて届く結果");
      oldProvider.emitError(new Error("古いエラー"));
      deferredStop.resolve();
      await stopping;

      expect(dependencies.postComment).toHaveBeenCalledTimes(1);
      expect(dependencies.notifyError).not.toHaveBeenCalled();
      expect(dependencies.notifyActive).toHaveBeenLastCalledWith(true);
      newProvider.emitResult("新しいコメント");
      expect(dependencies.postComment).toHaveBeenLastCalledWith("新しいコメント", {
        settings: { ...DEFAULT_SETTINGS, sttProvider },
        signal: expect.any(AbortSignal),
      });
      await session.stop();
    },
  );

  it("設定取得中に停止した開始処理からはプロバイダーを作らない", async () => {
    const loading = createDeferred();
    dependencies.loadSettings.mockImplementation(async () => {
      await loading.promise;
      return DEFAULT_SETTINGS;
    });
    const session = new VoiceCommentSession(dependencies);
    session.toggle();
    await session.stop();
    loading.resolve();
    await flushAsyncWork();
    expect(dependencies.createProvider).not.toHaveBeenCalled();
  });

  it("設定再起動の停止待ち中に明示停止したら再開しない", async () => {
    const deferredStop = createDeferred();
    dependencies.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, sttProvider: "grok" });
    dependencies.createExternalPipeline.mockResolvedValue({ stop: () => deferredStop.promise });
    const session = new VoiceCommentSession(dependencies);
    session.toggle();
    await flushAsyncWork();
    provider.emitStart();
    const restarting = session.restartWithLatestSettings();
    await session.stop();
    deferredStop.resolve();
    await restarting;
    expect(dependencies.createProvider).toHaveBeenCalledOnce();
    expect(session.snapshot()).toEqual({ isActive: false });
  });

  it("外部パイプライン初期化中の停止後は、完成したパイプラインも終了する", async () => {
    const initializing = createDeferred();
    const pipeline = { stop: vi.fn().mockResolvedValue(undefined) };
    dependencies.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, sttProvider: "grok" });
    dependencies.createExternalPipeline.mockImplementation(async () => {
      await initializing.promise;
      return pipeline;
    });
    const session = new VoiceCommentSession(dependencies);
    session.toggle();
    await flushAsyncWork();
    await session.stop();
    initializing.resolve();
    await flushAsyncWork();
    expect(pipeline.stop).toHaveBeenCalledOnce();
    expect(provider.start).not.toHaveBeenCalled();
    provider.emitResult("遅い結果");
    provider.emitStart();
    expect(dependencies.postComment).not.toHaveBeenCalled();
    expect(session.snapshot()).toEqual({ isActive: false });
  });
});
