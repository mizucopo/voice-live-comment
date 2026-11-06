/* eslint-disable @typescript-eslint/require-await -- ResponseモックはPromiseを返すAPI形状をasyncで表す。 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { GoogleSttProvider } from "../../src/stt/google-stt-provider.js";

type TestResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type TestFetch = (input: string, init?: RequestInit) => Promise<TestResponse>;

describe("GoogleSttProvider", () => {
  let provider: GoogleSttProvider;
  let mockFetch: Mock<TestFetch>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    provider = new GoogleSttProvider("test-api-key", "ja-JP");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sendAudio でGoogle Cloud STT APIを呼び出す", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        results: [{ alternatives: [{ transcript: "こんにちは" }] }],
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const onResult = vi.fn();
    provider.onResult(onResult);

    const audioBlob = new Blob(["fake-audio"], { type: "audio/webm;codecs=opus" });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode("fake-audio").buffer);
    await provider.sendAudio(audioBlob);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://speech.googleapis.com/v1/speech:recognize?key=test-api-key",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const fetchCall = mockFetch.mock.calls.at(0);
    const requestBody = fetchCall?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("JSONリクエストが送信されていません");
    const body = JSON.parse(requestBody) as {
      config: { encoding: string; languageCode: string };
      audio: { content: string };
    };
    expect(body.config.encoding).toBe("WEBM_OPUS");
    expect(body.config.languageCode).toBe("ja-JP");
    expect(body.audio.content).toBeDefined();

    expect(onResult).toHaveBeenCalledWith("こんにちは");
  });

  it("APIキー未設定でsendAudio呼び出し時にエラー", async () => {
    provider = new GoogleSttProvider("", "ja-JP");
    const onError = vi.fn();
    provider.onError(onError);

    const audioBlob = new Blob(["fake-audio"], { type: "audio/webm" });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode("fake-audio").buffer);
    await provider.sendAudio(audioBlob);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("API 4xxエラー時にonErrorを呼び出す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid audio",
    });

    const onError = vi.fn();
    provider.onError(onError);

    const audioBlob = new Blob(["fake-audio"], { type: "audio/webm" });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode("fake-audio").buffer);
    await provider.sendAudio(audioBlob);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  function createAudioBlob(): Blob {
    const blob = new Blob(["fake-audio"], { type: "audio/webm" });
    blob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode("fake-audio").buffer);
    return blob;
  }

  function failure(status: number, body = "quota exceeded"): TestResponse {
    return { ok: false, status, statusText: "Request failed", text: async () => body };
  }

  it("HTTP 429のみ1秒・2秒待機して再試行し、成功結果を1回通知する", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ alternatives: [{ transcript: "テスト" }] }] }),
      });
    const onResult = vi.fn();
    const onError = vi.fn();
    provider.onResult(onResult);
    provider.onError(onError);

    const pending = provider.sendAudio(createAudioBlob());
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenCalledExactlyOnceWith("テスト");
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP 429が続いても最大2回の再試行で終了し、最後の応答本文を通知する", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(failure(429, "first"))
      .mockResolvedValueOnce(failure(429, "second"))
      .mockResolvedValue(failure(429, "final quota exceeded"));
    const onError = vi.fn();
    const onResult = vi.fn();
    provider.onError(onError);
    provider.onResult(onResult);

    const pending = provider.sendAudio(createAudioBlob());
    await vi.runAllTimersAsync();
    await pending;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      new Error("Google STT API error 429: final quota exceeded"),
    );
    expect(onResult).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 500, 503])(
    "HTTP %iの本文に429が含まれても再試行しない",
    async (status) => {
      vi.useFakeTimers();
      mockFetch.mockResolvedValue(failure(status, "invalid request 429"));
      const onError = vi.fn();
      provider.onError(onError);

      const pending = provider.sendAudio(createAudioBlob());
      await vi.runAllTimersAsync();
      await pending;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        new Error(`Google STT API error ${String(status)}: invalid request 429`),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("429の次が400なら追加の再試行をせず、その400エラーを通知する", async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(failure(429))
      .mockResolvedValue(failure(400, "invalid request 429"));
    const onError = vi.fn();
    provider.onError(onError);

    const pending = provider.sendAudio(createAudioBlob());
    await vi.runAllTimersAsync();
    await pending;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      new Error("Google STT API error 400: invalid request 429"),
    );
  });

  it.each([new Error("network error 429"), "network error 429"])(
    "fetch例外に429が含まれても再試行しない: %s",
    async (error) => {
      vi.useFakeTimers();
      mockFetch.mockRejectedValue(error);
      const onError = vi.fn();
      provider.onError(onError);

      const pending = provider.sendAudio(createAudioBlob());
      await vi.runAllTimersAsync();
      await pending;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledExactlyOnceWith(new Error("network error 429"));
    },
  );

  it("JSON解析例外に429が含まれても再試行しない", async () => {
    vi.useFakeTimers();
    const error = new SyntaxError("invalid JSON 429");
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.reject(error) });
    const onError = vi.fn();
    provider.onError(onError);

    const pending = provider.sendAudio(createAudioBlob());
    await vi.runAllTimersAsync();
    await pending;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it.each(["empty", "rejected"])("応答本文が%sならstatusTextを通知する", async (body) => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () =>
        body === "empty" ? Promise.resolve("") : Promise.reject(new Error("read failed")),
    });
    const onError = vi.fn();
    provider.onError(onError);

    await provider.sendAudio(createAudioBlob());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      new Error("Google STT API error 400: Bad Request"),
    );
  });

  it("start / stop はno-op（外部APIはsendAudioのみ使用）", async () => {
    await expect(provider.start()).resolves.toBeUndefined();
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
