import { afterEach, describe, expect, it, vi } from "vitest";
import { recognizeGrokSpeech } from "../../src/stt/grok-stt-service.js";

function recognizeResponse(
  response: { text: string; language?: string },
  language = "ja-JP",
): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) }),
  );
  return recognizeGrokSpeech({ apiKey: "test-xai-key", audioBase64: "AAA=", language });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Grokの認識結果", () => {
  it("日本語設定では長い外国語のコメント候補を返さない", async () => {
    await expect(
      recognizeResponse({
        text: "Thank you for watching this live stream.",
        language: "en",
      }),
    ).resolves.toBe("");
  });

  it.each([
    "오늘도 방송을 시청해 주셔서 감사합니다.",
    "Спасибо за сегодняшний стрим!",
    "شكراً لمشاهدة البث المباشر",
  ])("日本語設定では言語未検出の外国語表記を返さない: %s", async (text) => {
    await expect(recognizeResponse({ text, language: "" })).resolves.toBe("");
  });

  it.each(["ja", "ja-JP", "Japanese", "", undefined])(
    "日本語と英字の固有名詞が混在するコメントを保持する: %s",
    async (language) => {
      const text = "YouTubeでGrokを使っています。";
      const response = language === undefined ? { text } : { text, language };
      await expect(recognizeResponse(response)).resolves.toBe(text);
    },
  );

  it.each(["東京！", "YouTube", "OK", "123", "👏", "韓国語で안녕と言います。"])(
    "言語未検出でも曖昧な表記や日本語の文章を保持する: %s",
    async (text) => {
      await expect(recognizeResponse({ text })).resolves.toBe(text);
    },
  );

  it.each(["啊！", "你好", "谢谢你！"])(
    "日本語設定で言語未検出の既知の外国語短文を除外する: %s",
    async (text) => {
      await expect(recognizeResponse({ text })).resolves.toBe("");
    },
  );

  it("英語設定では英語の長文コメントを保持する", async () => {
    const text = "Thank you for watching this live stream.";
    await expect(recognizeResponse({ text, language: "en-US" }, "en-GB")).resolves.toBe(text);
  });

  it("日本語設定では長い中国語のコメント候補も除外する", async () => {
    await expect(
      recognizeResponse({ text: "非常感谢大家收看今天的直播节目。", language: "zh-CN" }),
    ).resolves.toBe("");
  });

  it("言語未特定のコードでも日本語のコメントを保持する", async () => {
    await expect(recognizeResponse({ text: "こんにちは！", language: "und" })).resolves.toBe(
      "こんにちは！",
    );
  });
});
