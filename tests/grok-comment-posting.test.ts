import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { MockAudioContext, mockRuntime, mockStorage } from "./setup.js";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="chat">
      <div id="input" contenteditable="true">手動の下書き</div>
      <button id="send-button">送信</button>
    </div>
  `;
  mockStorage.sync.get.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    sttProvider: "grok",
    xaiApiKey: "test-xai-key",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GrokからYouTubeコメントへの投稿", () => {
  it.each([
    { text: "Thank you for watching this live stream.", language: "en", posted: false },
    { text: "오늘도 방송을 시청해 주셔서 감사합니다.", language: "", posted: false },
    { text: "YouTubeでGrokを使っています。", language: "ja", posted: true },
  ])("認識結果の投稿判定: $text", async ({ text, language, posted }) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text, language }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const createProcessor = vi.spyOn(MockAudioContext.prototype, "createScriptProcessor");
    const click = vi.fn();
    document.querySelector("#send-button")?.addEventListener("click", click);

    await import("../src/background.js");
    const backgroundListener = mockRuntime.onMessage.addListener.mock.calls.at(-1)?.at(0);
    if (!backgroundListener) throw new Error("backgroundのリスナーがありません");
    mockRuntime.sendMessage.mockImplementation((message) => {
      if (message.type !== "GROK_STT_RECOGNIZE") return Promise.resolve(undefined);
      return new Promise((resolve) => {
        backgroundListener(message, {}, resolve);
      });
    });

    await import("../src/content.js");
    const contentListener = mockRuntime.onMessage.addListener.mock.calls.at(-1)?.at(0);
    if (!contentListener) throw new Error("contentのリスナーがありません");
    contentListener({ type: "TOGGLE_RECOGNITION" }, {}, vi.fn());
    await vi.waitFor(() => expect(createProcessor).toHaveBeenCalledOnce());

    const processor = createProcessor.mock.results.at(0)?.value;
    if (!processor) throw new Error("音声入力が開始されていません");
    const speech = Float32Array.from(
      { length: 4800 },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000),
    );
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(100);
      processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => speech } });
    }
    // フィルターの余韻も含め、実時間に沿って無音を入力する。
    for (let i = 0; i < 35; i++) {
      await vi.advanceTimersByTimeAsync(100);
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4800) },
      });
    }
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(document.querySelector("#input")?.textContent).toBe(posted ? text : "手動の下書き");
    expect(click).toHaveBeenCalledTimes(posted ? 1 : 0);

    contentListener({ type: "TOGGLE_RECOGNITION" }, {}, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
  });
});
