import type { SttProvider } from "./stt/stt-provider.js";
import type { ExtensionSettings } from "./settings.js";

export type VoiceCommentSettings = ExtensionSettings;

export type ExternalPipeline = {
  stop: () => Promise<void>;
};

export type VoiceCommentSessionDependencies = {
  loadSettings: () => Promise<VoiceCommentSettings>;
  createProvider: (settings: VoiceCommentSettings) => SttProvider;
  createExternalPipeline: (
    provider: SttProvider,
    settings: VoiceCommentSettings,
  ) => Promise<ExternalPipeline>;
  postComment: (text: string) => void;
  notifyActive: (isActive: boolean) => void;
  notifyError: (message: string) => void;
  startTimeoutMs?: number;
  logger?: Pick<Console, "error" | "log" | "warn">;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VoiceCommentSession {
  private readonly _loadSettings: VoiceCommentSessionDependencies["loadSettings"];
  private readonly _createProvider: VoiceCommentSessionDependencies["createProvider"];
  private readonly _createExternalPipeline: VoiceCommentSessionDependencies["createExternalPipeline"];
  private readonly _postComment: VoiceCommentSessionDependencies["postComment"];
  private readonly _notifyActive: VoiceCommentSessionDependencies["notifyActive"];
  private readonly _notifyError: VoiceCommentSessionDependencies["notifyError"];
  private readonly _startTimeoutMs: number;
  private readonly _logger: Pick<Console, "error" | "log" | "warn">;
  private _isActive: boolean;
  private _isStarting: boolean;
  private _currentProvider: SttProvider | null;
  private _externalPipeline: ExternalPipeline | null;
  private _startTimeoutId: ReturnType<typeof setTimeout> | null;

  constructor({
    loadSettings,
    createProvider,
    createExternalPipeline,
    postComment,
    notifyActive,
    notifyError,
    startTimeoutMs = 10000,
    logger = console,
  }: VoiceCommentSessionDependencies) {
    this._loadSettings = loadSettings;
    this._createProvider = createProvider;
    this._createExternalPipeline = createExternalPipeline;
    this._postComment = postComment;
    this._notifyActive = notifyActive;
    this._notifyError = notifyError;
    this._startTimeoutMs = startTimeoutMs;
    this._logger = logger;

    this._isActive = false;
    this._isStarting = false;
    this._currentProvider = null;
    this._externalPipeline = null;
    this._startTimeoutId = null;
  }

  snapshot(): { isActive: boolean } {
    return { isActive: this._isActive };
  }

  toggle(): { isActive: boolean } {
    if (this._isActive) {
      void this.stop();
      return this.snapshot();
    }

    if (this._isStarting) {
      return this.snapshot();
    }

    this._isStarting = true;
    this._startTimeoutId = setTimeout(() => {
      if (this._isStarting && !this._isActive) {
        void this._handleStartTimeout();
      }
    }, this._startTimeoutMs);

    void this._start().catch((error: unknown) => {
      this._logger.error("[Voice Live Comment] startRecognition failed:", error);
      this._notifyError("音声認識の開始に失敗しました: " + errorMessage(error));
      this._finishStarting();
    });

    return this.snapshot();
  }

  async restartWithLatestSettings(): Promise<void> {
    if (!this._isActive) return;

    await this.stop();
    this.toggle();
  }

  async stop(): Promise<void> {
    this._isActive = false;
    this._finishStarting();

    const { provider, pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    await this._stopProvider(provider);

    this._notifyActive(false);
    this._logger.log("[Voice Live Comment] 音声認識を停止しました");
  }

  private async _start(): Promise<void> {
    const settings = await this._loadSettings();

    let provider: SttProvider;
    try {
      provider = this._createProvider(settings);
    } catch (error) {
      this._notifyError(errorMessage(error));
      this._finishStarting();
      return;
    }

    this._currentProvider = provider;
    this._bindProvider(provider);

    if (settings.sttProvider === "google" || settings.sttProvider === "grok") {
      try {
        this._externalPipeline = await this._createExternalPipeline(provider, settings);
      } catch (error) {
        this._notifyError("VADの初期化に失敗しました: " + errorMessage(error));
        this._currentProvider = null;
        this._finishStarting();
        return;
      }
    }

    try {
      await provider.start();
    } catch (error) {
      await this._cleanupFailedStart();
      this._notifyError(errorMessage(error));
    }
  }

  private _bindProvider(provider: SttProvider): void {
    provider.onStart(() => {
      this._isActive = true;
      this._finishStarting();
      this._notifyActive(true);
      this._logger.log("[Voice Live Comment] 音声認識を開始しました");
    });

    provider.onResult((text) => {
      this._postComment(text);
    });

    provider.onError((error) => {
      this._notifyError(error.message);
      if (this._isStarting) {
        this._finishStarting();
      }
    });
  }

  private async _cleanupFailedStart(): Promise<void> {
    const { provider, pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    await this._stopProvider(provider);
    this._isActive = false;
    this._finishStarting();
  }

  private async _handleStartTimeout(): Promise<void> {
    this._logger.warn("[Voice Live Comment] 音声認識の開始がタイムアウトしました");

    const { provider, pipeline } = this._takeCurrentResources();

    await this._stopExternalPipeline(pipeline);
    await this._stopProvider(provider);

    this._finishStarting();
    this._notifyError("音声認識の開始がタイムアウトしました。再度お試しください。");
  }

  private _takeCurrentResources(): {
    provider: SttProvider | null;
    pipeline: ExternalPipeline | null;
  } {
    const provider = this._currentProvider;
    const pipeline = this._externalPipeline;
    this._currentProvider = null;
    this._externalPipeline = null;
    return { provider, pipeline };
  }

  private async _stopProvider(providerToStop: SttProvider | null): Promise<void> {
    if (providerToStop) {
      try {
        await providerToStop.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    }
  }

  private async _stopExternalPipeline(pipelineToStop: ExternalPipeline | null): Promise<void> {
    if (pipelineToStop) {
      try {
        await pipelineToStop.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    }
  }

  private _finishStarting(): void {
    this._isStarting = false;
    this._clearStartTimeout();
  }

  private _clearStartTimeout(): void {
    if (this._startTimeoutId !== null) {
      clearTimeout(this._startTimeoutId);
    }
    this._startTimeoutId = null;
  }
}
