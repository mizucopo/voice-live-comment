import { SttProvider } from "./stt-provider.js";

type GrokSttResponse = { ok: boolean; text?: string; error?: string };

function isGrokSttResponse(value: unknown): value is GrokSttResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.ok === "boolean" &&
    (response.text === undefined || typeof response.text === "string") &&
    (response.error === undefined || typeof response.error === "string")
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export class GrokSttProvider extends SttProvider {
  readonly apiKey: string;
  readonly language: string;
  readonly boostPhrases: string[];

  constructor(apiKey: string, language: string, boostPhrases: string[] = []) {
    super();
    this.apiKey = apiKey;
    this.language = language;
    this.boostPhrases = boostPhrases;
    this.recordingFormat = "pcm16";
  }

  override start(): Promise<void> {
    this._emitStart();
    return Promise.resolve();
  }

  override stop(): Promise<void> {
    return Promise.resolve();
  }

  override async sendAudio(audioBlob: Blob): Promise<void> {
    if (!this.apiKey) {
      this._emitError(new Error("xAI APIキーが設定されていません。設定画面で入力してください。"));
      return;
    }

    try {
      const response: unknown = await chrome.runtime.sendMessage({
        type: "GROK_STT_RECOGNIZE",
        apiKey: this.apiKey,
        audioBase64: await blobToBase64(audioBlob),
        language: this.language,
        boostPhrases: this.boostPhrases,
      });

      if (!isGrokSttResponse(response)) {
        throw new Error("Grok STTの変換に失敗しました");
      }
      if (!response.ok) {
        throw new Error(response.error ? response.error : "Grok STTの変換に失敗しました");
      }

      if (response.text) {
        this._emitResult(response.text);
      }
    } catch (error) {
      this._emitError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
