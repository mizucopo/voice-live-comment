import { SttProvider } from "./stt-provider.js";
import { SpeechVolumeMonitor } from "../speech-volume-monitor.js";
import type { ExtensionSettings } from "../settings.js";

export type BrowserSttSettings = Pick<
  ExtensionSettings,
  "boostPhrases" | "language" | "recognitionVolumeThreshold" | "useLocalModel"
>;

type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike | undefined;
};
type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean | undefined;
  phrases?: unknown[] | undefined;
  onstart: (() => void) | null;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionLike;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<void>;
};
type SpeechRecognitionPhraseConstructor = new (phrase: string, boost: number) => unknown;
type SpeechRecognitionGlobal = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognitionPhrase?: SpeechRecognitionPhraseConstructor;
  };
type SpeechVolumeMonitorPort = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  hasRecentTargetSpeech: () => boolean;
  consumeRecentTargetSpeech: () => boolean;
};
type SpeechVolumeMonitorConstructor = new (options: {
  recognitionVolumeThreshold: number;
}) => SpeechVolumeMonitorPort;

const speechRecognitionGlobal = window as SpeechRecognitionGlobal;
const SpeechRecognitionClass: SpeechRecognitionConstructor | undefined =
  speechRecognitionGlobal.SpeechRecognition ?? speechRecognitionGlobal.webkitSpeechRecognition;
const SpeechRecognitionPhrase = speechRecognitionGlobal.SpeechRecognitionPhrase;

export class BrowserSttProvider extends SttProvider {
  settings: BrowserSttSettings;
  private readonly _SpeechVolumeMonitorClass: SpeechVolumeMonitorConstructor;
  private _speechVolumeMonitor: SpeechVolumeMonitorPort | null;
  readonly recognitions: (SpeechRecognitionLike | null)[];
  activeIndex: number;
  nextPreStarted: boolean;
  isActive: boolean;
  hasFallbackFromLocal: boolean;
  isInitialStart: boolean;
  startTimeoutId: ReturnType<typeof setTimeout> | null;
  private _speechVolumeMonitorGeneration: number;

  constructor(
    settings: BrowserSttSettings,
    {
      SpeechVolumeMonitorClass = SpeechVolumeMonitor,
    }: { SpeechVolumeMonitorClass?: SpeechVolumeMonitorConstructor } = {},
  ) {
    super();
    this.settings = settings;
    this._SpeechVolumeMonitorClass = SpeechVolumeMonitorClass;
    this._speechVolumeMonitor = null;
    this.recognitions = [null, null];
    this.activeIndex = 0;
    this.nextPreStarted = false;
    this.isActive = false;
    this.hasFallbackFromLocal = false;
    this.isInitialStart = true;
    this.startTimeoutId = null;
    this._speechVolumeMonitorGeneration = 0;
  }

  override async start(): Promise<void> {
    if (!SpeechRecognitionClass) {
      this._emitError(new Error("このブラウザは音声認識に対応していません"));
      return;
    }

    this.isInitialStart = true;
    this.isActive = true;
    this.activeIndex = 0;
    this.nextPreStarted = false;
    this.hasFallbackFromLocal = false;

    if (this.settings.useLocalModel) {
      const ready = await this.ensureOnDeviceModel();
      if (!ready) {
        this.settings = { ...this.settings, useLocalModel: false };
        this._emitError(
          new Error("オンデバイスモデルが利用できないため、クラウド認識を使用します"),
        );
      }
    }

    try {
      const monitorStarted = await this.startSpeechVolumeMonitor();
      if (!monitorStarted) return;
      // stop() may run while the monitor start promise is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!this.isActive) {
        await this.stopSpeechVolumeMonitor();
        return;
      }
      this.startInstance(0);
    } catch (error) {
      this.isActive = false;
      await this.stopSpeechVolumeMonitor();
      throw error;
    }
  }

  override async stop(): Promise<void> {
    this.isActive = false;
    this.isInitialStart = true;
    this.nextPreStarted = false;
    this.hasFallbackFromLocal = false;
    this.clearStartTimeout();

    for (let i = 0; i < 2; i++) {
      const rec = this.recognitions[i];
      if (rec) {
        this.recognitions[i] = null;
        try {
          rec.stop();
        } catch {
          // Cleanup remains best-effort.
        }
      }
    }

    await this.stopSpeechVolumeMonitor();
    this._emitStop();
  }

  async startSpeechVolumeMonitor(): Promise<boolean> {
    await this.stopSpeechVolumeMonitor();

    const generation = ++this._speechVolumeMonitorGeneration;
    const monitor = new this._SpeechVolumeMonitorClass({
      recognitionVolumeThreshold: this.settings.recognitionVolumeThreshold,
    });
    this._speechVolumeMonitor = monitor;

    try {
      await monitor.start();
    } catch (error) {
      if (
        this._speechVolumeMonitor !== monitor ||
        this._speechVolumeMonitorGeneration !== generation
      ) {
        await monitor.stop();
        return false;
      }

      this._speechVolumeMonitor = null;
      await monitor.stop();
      throw error;
    }

    if (
      this._speechVolumeMonitor !== monitor ||
      this._speechVolumeMonitorGeneration !== generation
    ) {
      if (this._speechVolumeMonitor === monitor) {
        this._speechVolumeMonitor = null;
      }
      await monitor.stop();
      return false;
    }

    return true;
  }

  async stopSpeechVolumeMonitor(): Promise<void> {
    this._speechVolumeMonitorGeneration++;
    if (!this._speechVolumeMonitor) return;

    const monitor = this._speechVolumeMonitor;
    this._speechVolumeMonitor = null;
    await monitor.stop();
  }

  setupRecognitionInstance(index: number): SpeechRecognitionLike {
    if (!SpeechRecognitionClass) throw new Error("このブラウザは音声認識に対応していません");
    const rec = new SpeechRecognitionClass();
    rec.lang = this.settings.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    if (this.settings.useLocalModel && "processLocally" in rec) {
      rec.processLocally = true;
    }

    if (
      this.settings.useLocalModel &&
      SpeechRecognitionPhrase &&
      this.settings.boostPhrases.length > 0
    ) {
      rec.phrases = this.settings.boostPhrases.map(
        (phrase) => new SpeechRecognitionPhrase(phrase, 10.0),
      );
    }

    rec.onstart = () => {
      this.clearStartTimeout();
      if (this.isInitialStart) {
        this._emitStart();
        this.isInitialStart = false;
      }
    };

    rec.onresult = (rawEvent: unknown) => {
      const event = rawEvent as SpeechRecognitionResultEventLike;
      if (this.recognitions[index] !== rec) return;
      let finalText = "";
      let hasFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result?.[0];
        if (result?.isFinal && alternative) {
          finalText += alternative.transcript;
          hasFinal = true;
        }
      }
      if (finalText && this.consumeRecentTargetSpeech()) {
        this._emitResult(finalText);
      }
      if (hasFinal && index === this.activeIndex) {
        this.preStartNextInstance();
      }
    };

    rec.onerror = (rawEvent: unknown) => {
      const event = rawEvent as SpeechRecognitionErrorEventLike;
      if (this.recognitions[index] !== rec) return;
      if (event.error === "no-speech") return;
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "language-not-supported"
      ) {
        if (this.settings.useLocalModel) {
          this.fallbackToCloud(index, event.error);
          return;
        }
        this._emitError(new Error("マイクへのアクセスが拒否されました"));
        void this.stop();
        return;
      }
      this._emitError(new Error(event.error));
      console.warn("[BrowserSttProvider] 認識エラー:", event.error);
    };

    rec.onend = () => {
      if (!this.isActive) return;
      if (this.recognitions[index] !== rec) return;

      this.recognitions[index] = null;

      if (index === this.activeIndex) {
        this.activeIndex = (index + 1) % 2;
        this.nextPreStarted = false;
        if (!this.recognitions[this.activeIndex]) {
          this.startInstance(this.activeIndex);
        }
      } else {
        this.startInstance(index);
      }
    };

    this.recognitions[index] = rec;
    return rec;
  }

  hasRecentTargetSpeech(): boolean {
    return this._speechVolumeMonitor?.hasRecentTargetSpeech() === true;
  }

  consumeRecentTargetSpeech(): boolean {
    return this._speechVolumeMonitor?.consumeRecentTargetSpeech() === true;
  }

  startInstance(index: number): void {
    if (this.recognitions[index]) {
      const rec = this.recognitions[index];
      this.recognitions[index] = null;
      try {
        rec.stop();
      } catch {
        // Cleanup remains best-effort.
      }
    }
    const rec = this.setupRecognitionInstance(index);
    try {
      rec.start();
      this.clearStartTimeout();
      this.startTimeoutId = setTimeout(() => {
        if (this.settings.useLocalModel) {
          this.fallbackToCloud(index, "timeout");
        }
      }, 3000);
    } catch (error) {
      if (this.settings.useLocalModel) {
        this.fallbackToCloud(index, error instanceof Error ? error.message : String(error));
      }
    }
  }

  preStartNextInstance(): void {
    if (this.nextPreStarted) return;
    this.nextPreStarted = true;
    const nextIndex = (this.activeIndex + 1) % 2;
    this.startInstance(nextIndex);
  }

  fallbackToCloud(_index: number, reason: string): void {
    if (this.hasFallbackFromLocal) return;
    this.hasFallbackFromLocal = true;

    this.settings = { ...this.settings, useLocalModel: false };
    this.activeIndex = 0;
    this.nextPreStarted = false;

    for (let i = 0; i < 2; i++) {
      const rec = this.recognitions[i];
      if (rec) {
        this.recognitions[i] = null;
        try {
          rec.stop();
        } catch {
          // Cleanup remains best-effort.
        }
      }
    }

    this.startInstance(0);

    this._emitError(
      new Error(`オンデバイス認識が利用できないため、クラウド認識に切り替えました (${reason})`),
    );
  }

  async ensureOnDeviceModel(): Promise<boolean> {
    if (!SpeechRecognitionClass?.available) return true;

    try {
      const status = await SpeechRecognitionClass.available({
        langs: [this.settings.language],
        processLocally: true,
      });

      if (status === "available") return true;

      if (
        (status === "downloadable" || status === "downloading") &&
        SpeechRecognitionClass.install
      ) {
        await SpeechRecognitionClass.install({
          langs: [this.settings.language],
          processLocally: true,
        });
        const newStatus = await SpeechRecognitionClass.available({
          langs: [this.settings.language],
          processLocally: true,
        });
        return newStatus === "available";
      }

      return false;
    } catch {
      return false;
    }
  }

  private clearStartTimeout(): void {
    if (this.startTimeoutId !== null) clearTimeout(this.startTimeoutId);
    this.startTimeoutId = null;
  }
}
