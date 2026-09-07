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
  private readonly loadSettings: VoiceCommentSessionDependencies["loadSettings"];
  private readonly createProvider: VoiceCommentSessionDependencies["createProvider"];
  private readonly createExternalPipeline: VoiceCommentSessionDependencies["createExternalPipeline"];
  private readonly postComment: VoiceCommentSessionDependencies["postComment"];
  private readonly notifyActive: VoiceCommentSessionDependencies["notifyActive"];
  private readonly notifyError: VoiceCommentSessionDependencies["notifyError"];
  private readonly startTimeoutMs: number;
  private readonly logger: Pick<Console, "error" | "log" | "warn">;
  private isActive: boolean;
  private isStarting: boolean;
  private currentProvider: SttProvider | null;
  private externalPipeline: ExternalPipeline | null;
  private startTimeoutId: ReturnType<typeof setTimeout> | null;

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
    this.loadSettings = loadSettings;
    this.createProvider = createProvider;
    this.createExternalPipeline = createExternalPipeline;
    this.postComment = postComment;
    this.notifyActive = notifyActive;
    this.notifyError = notifyError;
    this.startTimeoutMs = startTimeoutMs;
    this.logger = logger;

    this.isActive = false;
    this.isStarting = false;
    this.currentProvider = null;
    this.externalPipeline = null;
    this.startTimeoutId = null;
  }

  snapshot(): { isActive: boolean } {
    return { isActive: this.isActive };
  }

  toggle(): { isActive: boolean } {
    if (this.isActive) {
      void this.stop();
      return this.snapshot();
    }

    if (this.isStarting) {
      return this.snapshot();
    }

    this.isStarting = true;
    this.startTimeoutId = setTimeout(() => {
      if (this.isStarting && !this.isActive) {
        void this.handleStartTimeout();
      }
    }, this.startTimeoutMs);

    void this.start().catch((error: unknown) => {
      this.logger.error("[Voice Live Comment] startRecognition failed:", error);
      this.notifyError("音声認識の開始に失敗しました: " + errorMessage(error));
      this.finishStarting();
    });

    return this.snapshot();
  }

  async restartWithLatestSettings(): Promise<void> {
    if (!this.isActive) return;

    await this.stop();
    this.toggle();
  }

  async stop(): Promise<void> {
    this.isActive = false;
    this.finishStarting();

    const { provider, pipeline } = this.takeCurrentResources();

    await this.stopExternalPipeline(pipeline);
    await this.stopProvider(provider);

    this.notifyActive(false);
    this.logger.log("[Voice Live Comment] 音声認識を停止しました");
  }

  private async start(): Promise<void> {
    const settings = await this.loadSettings();

    let provider: SttProvider;
    try {
      provider = this.createProvider(settings);
    } catch (error) {
      this.notifyError(errorMessage(error));
      this.finishStarting();
      return;
    }

    this.currentProvider = provider;
    this.bindProvider(provider);

    if (settings.sttProvider === "google" || settings.sttProvider === "grok") {
      try {
        this.externalPipeline = await this.createExternalPipeline(provider, settings);
      } catch (error) {
        this.notifyError("VADの初期化に失敗しました: " + errorMessage(error));
        this.currentProvider = null;
        this.finishStarting();
        return;
      }
    }

    try {
      await provider.start();
    } catch (error) {
      await this.cleanupFailedStart();
      this.notifyError(errorMessage(error));
    }
  }

  private bindProvider(provider: SttProvider): void {
    provider.onStart(() => {
      this.isActive = true;
      this.finishStarting();
      this.notifyActive(true);
      this.logger.log("[Voice Live Comment] 音声認識を開始しました");
    });

    provider.onResult((text) => {
      this.postComment(text);
    });

    provider.onError((error) => {
      this.notifyError(error.message);
      if (this.isStarting) {
        this.finishStarting();
      }
    });
  }

  private async cleanupFailedStart(): Promise<void> {
    const { provider, pipeline } = this.takeCurrentResources();

    await this.stopExternalPipeline(pipeline);
    await this.stopProvider(provider);
    this.isActive = false;
    this.finishStarting();
  }

  private async handleStartTimeout(): Promise<void> {
    this.logger.warn("[Voice Live Comment] 音声認識の開始がタイムアウトしました");

    const { provider, pipeline } = this.takeCurrentResources();

    await this.stopExternalPipeline(pipeline);
    await this.stopProvider(provider);

    this.finishStarting();
    this.notifyError("音声認識の開始がタイムアウトしました。再度お試しください。");
  }

  private takeCurrentResources(): {
    provider: SttProvider | null;
    pipeline: ExternalPipeline | null;
  } {
    const provider = this.currentProvider;
    const pipeline = this.externalPipeline;
    this.currentProvider = null;
    this.externalPipeline = null;
    return { provider, pipeline };
  }

  private async stopProvider(providerToStop: SttProvider | null): Promise<void> {
    if (providerToStop) {
      try {
        await providerToStop.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    }
  }

  private async stopExternalPipeline(pipelineToStop: ExternalPipeline | null): Promise<void> {
    if (pipelineToStop) {
      try {
        await pipelineToStop.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    }
  }

  private finishStarting(): void {
    this.isStarting = false;
    this.clearStartTimeout();
  }

  private clearStartTimeout(): void {
    if (this.startTimeoutId !== null) {
      clearTimeout(this.startTimeoutId);
    }
    this.startTimeoutId = null;
  }
}
