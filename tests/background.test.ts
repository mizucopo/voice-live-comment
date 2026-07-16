/* eslint-disable @typescript-eslint/require-await -- ResponseモックはPromiseを返すAPI形状をasyncで表す。 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateBadge, setBadgeError, showNotification } from "../src/background.js";
import { chromeMocks, mockRuntime } from "./setup.js";

const chrome = chromeMocks;

type TestMessageListener = (
  message: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: unknown) => void,
) => boolean | undefined;

function getMessageListener(): TestMessageListener {
  const listener = mockRuntime.onMessage.addListener.mock.calls.at(0)?.at(0);
  if (typeof listener !== "function") throw new Error("メッセージリスナーが登録されていません");
  return listener;
}

// background.jsはインポート時にonMessageリスナーを登録する。
// beforeEachでvi.clearAllMocks()が呼ばれるとmock.callsもクリアされるため、
// テスト内でリスナーを参照するにはリインポートが必要。
async function importBackground() {
  vi.resetModules();
  return await import("../src/background.js");
}

function createGrokMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "GROK_STT_RECOGNIZE",
    apiKey: "test-xai-key",
    audioBase64: btoa("fake-audio"),
    language: "ja-JP",
    boostPhrases: ["配信名", "コメント"],
    ...overrides,
  };
}

describe("background.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateBadge", () => {
    it("アクティブ時に緑のバッジを設定する", () => {
      updateBadge(true);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "●" });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#4CAF50" });
    });

    it("非アクティブ時にバッジをクリアする", () => {
      updateBadge(false);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
    });
  });

  describe("setBadgeError", () => {
    it("エラー時に赤い×バッジを設定する", () => {
      setBadgeError();
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "×" });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#F44336" });
    });
  });

  describe("showNotification", () => {
    it("通知を作成する", () => {
      showNotification("テストタイトル", "テストメッセージ");
      expect(chrome.runtime.getURL).toHaveBeenCalledWith("icons/icon128.png");
      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: "basic",
        iconUrl: "chrome-extension://test-id/icons/icon128.png",
        title: "テストタイトル",
        message: "テストメッセージ",
      });
    });
  });

  describe("onMessage handler", () => {
    it("UPDATE_BADGEメッセージでupdateBadgeを呼ぶ", async () => {
      await importBackground();

      // リスナーに登録されたコールバックを取得
      const listener = getMessageListener();

      // コールバックを実行
      listener({ type: "UPDATE_BADGE", isActive: true }, {}, vi.fn());

      // 検証
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "●" });
    });

    it("SHOW_ERRORメッセージでエラーバッジと通知を表示", async () => {
      await importBackground();

      const listener = getMessageListener();

      listener({ type: "SHOW_ERROR", message: "テストエラー" }, {}, vi.fn());

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: "×" });
      expect(chrome.notifications.create).toHaveBeenCalled();
    });

    it("GROK_STT_RECOGNIZEメッセージでxAI APIをservice workerから呼び出す", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "こんにちは" }),
      });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage(), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "こんにちは",
        });
      });
      expect(fetch).toHaveBeenCalledWith(
        "https://api.x.ai/v1/stt",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer test-xai-key" },
        }),
      );

      const requestInit = vi.mocked(fetch).mock.calls.at(0)?.at(1);
      if (!requestInit || typeof requestInit !== "object" || !("body" in requestInit)) {
        throw new Error("fetchのオプションが送信されていません");
      }
      const body = requestInit.body;
      expect(body).toBeInstanceOf(FormData);
      if (!(body instanceof FormData)) throw new Error("FormDataが送信されていません");
      expect(body.get("format")).toBe("true");
      expect(body.get("language")).toBe("ja");
      expect(body.get("audio_format")).toBe("pcm");
      expect(body.get("sample_rate")).toBe("16000");
      expect(body.getAll("keyterm")).toEqual(["配信名", "コメント"]);
      expect(body.get("file")).toBeInstanceOf(File);
      const file = body.get("file");
      expect(file).toBeInstanceOf(File);
      if (!(file instanceof File)) throw new Error("音声ファイルが送信されていません");
      expect(file.name).toBe("audio.pcm");
      await expect(file.text()).resolves.toBe("fake-audio");
    });

    it("GROK_STT_RECOGNIZEはAPI 429でリトライする", async () => {
      vi.useFakeTimers();
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ text: "テスト" }),
        });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage(), {}, sendResponse);

      expect(result).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "テスト",
        });
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("GROK_STT_RECOGNIZEは検出言語が空でも短い異言語結果を返さない", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "啊！",
          language: "",
          words: [{ text: "啊！", start: 0, end: 0.2 }],
        }),
      });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage({ language: "ja-JP" }), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "",
        });
      });
    });

    it("GROK_STT_RECOGNIZEは検出言語が空でも短い日本語結果を返す", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "東京！",
          language: "",
          words: [{ text: "東京！", start: 0, end: 0.4 }],
        }),
      });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage({ language: "ja-JP" }), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "東京！",
        });
      });
    });

    it("GROK_STT_RECOGNIZEは検出言語が空でも短い中国語結果を日本語設定で返さない", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "你好",
          language: "",
          words: [{ text: "你好", start: 0, end: 0.4 }],
        }),
      });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage({ language: "ja-JP" }), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "",
        });
      });
    });

    it("GROK_STT_RECOGNIZEは検出言語が空でも短い日本語かな結果を中国語設定で返さない", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "ああ！",
          language: "",
          words: [{ text: "ああ！", start: 0, end: 0.4 }],
        }),
      });
      await importBackground();

      const listener = getMessageListener();
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage({ language: "zh-CN" }), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          ok: true,
          text: "",
        });
      });
    });
  });
});
