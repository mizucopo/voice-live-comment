import { SttProvider } from "./stt-provider.js";

type GoogleRecognitionResponse = {
  results?: {
    alternatives?: { transcript?: string }[];
  }[];
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class GoogleSttProvider extends SttProvider {
  readonly apiKey: string;
  readonly language: string;

  constructor(apiKey: string, language: string) {
    super();
    this.apiKey = apiKey;
    this.language = language;
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
      this._emitError(
        new Error("Google Cloud APIキーが設定されていません。設定画面で入力してください。"),
      );
      return;
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (const byte of uint8Array) {
      binary += String.fromCharCode(byte);
    }
    const base64Audio = btoa(binary);

    const maxRetries = 2;
    let lastError = new Error("Google STTの変換に失敗しました");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(
          `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio: { content: base64Audio },
              config: {
                encoding: "WEBM_OPUS",
                sampleRateHertz: 48000,
                languageCode: this.language,
              },
            }),
          },
        );

        if (!response.ok) {
          if (response.status === 429 && attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
          const errorBody = await response.text().catch(() => "");
          throw new Error(
            `Google STT API error ${String(response.status)}: ${errorBody || response.statusText}`,
          );
        }

        const data = (await response.json()) as GoogleRecognitionResponse;
        if (data.results && data.results.length > 0) {
          const text = data.results
            .map((result) => result.alternatives?.[0]?.transcript ?? "")
            .filter((text) => text)
            .join("");
          if (text) {
            this._emitResult(text);
          }
        }
        return;
      } catch (error) {
        lastError = asError(error);
        if (lastError.message.includes("429") && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          continue;
        }
        break;
      }
    }

    this._emitError(lastError);
  }
}
