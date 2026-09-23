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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GrokからYouTubeコメントへの投稿", () => {
  it.each([
    {
      text: "Thank you for watching this live stream.",
      language: "en",
      posted: false,
      review: "off",
    },
    {
      text: "오늘도 방송을 시청해 주셔서 감사합니다.",
      language: "",
      posted: false,
      review: "off",
    },
    { text: "YouTubeでGrokを使っています。", language: "ja", posted: true, review: "off" },
    { text: "とーきょーだね。", language: "ja", posted: true, review: "post" },
    { text: "とーきょーだね。", language: "ja", posted: false, review: "skip" },
    { text: "とーきょーだね。", language: "ja", posted: false, review: "error" },
  ])(
    "認識結果の投稿判定: $text（レビュー: $review）",
    async ({ text, language, posted, review }) => {
      const reviewEnabled = review !== "off";
      mockStorage.sync.get.mockResolvedValue({
        ...DEFAULT_SETTINGS,
        sttProvider: "grok",
        xaiApiKey: "test-xai-key",
        commentReviewEnabled: reviewEnabled,
        typesafeApiKey: "test-typesafe-key",
        dictionary: "とーきょー→東京",
      });
      const fetchMock = vi.fn<typeof fetch>().mockImplementation((url) => {
        if (url === "https://api.x.ai/v1/stt") {
          return Promise.resolve(new Response(JSON.stringify({ text, language })));
        }
        if (url === "https://api.typesafe.ai/v1/systemone") {
          return Promise.resolve(
            review === "error"
              ? new Response("service unavailable", { status: 503 })
              : new Response(
                  JSON.stringify({
                    answers: {
                      decision: {
                        type: "choice",
                        choice: review,
                        probabilities: {
                          post: review === "post" ? 1 : 0,
                          skip: review === "skip" ? 1 : 0,
                        },
                        confidence: 1,
                      },
                    },
                  }),
                ),
          );
        }
        return Promise.reject(new Error(`想定外のAPI呼び出し: ${String(url)}`));
      });
      vi.stubGlobal("fetch", fetchMock);
      const createProcessor = vi.spyOn(MockAudioContext.prototype, "createScriptProcessor");
      const click = vi.fn(() => document.querySelector("#input")?.textContent);
      document.querySelector("#send-button")?.addEventListener("click", click);

      await import("../src/background.js");
      const backgroundListener = mockRuntime.onMessage.addListener.mock.calls.at(-1)?.at(0);
      if (!backgroundListener) throw new Error("backgroundのリスナーがありません");
      mockRuntime.sendMessage.mockImplementation((message) => {
        if (message.type !== "GROK_STT_RECOGNIZE" && message.type !== "REVIEW_COMMENT") {
          return Promise.resolve(undefined);
        }
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

      const expectedText = reviewEnabled ? "東京だね。" : text;
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
        reviewEnabled
          ? ["https://api.x.ai/v1/stt", "https://api.typesafe.ai/v1/systemone"]
          : ["https://api.x.ai/v1/stt"],
      );
      if (reviewEnabled) {
        const reviewBody = fetchMock.mock.calls.at(1)?.[1]?.body;
        if (typeof reviewBody !== "string") throw new Error("レビューのJSON bodyがありません");
        expect(JSON.parse(reviewBody)).toMatchObject({
          model: "jev-latest",
          state: { comment: expectedText },
        });
        expect(mockRuntime.sendMessage).toHaveBeenCalledWith({
          type: "REVIEW_COMMENT",
          text: expectedText,
          criteria: DEFAULT_SETTINGS.commentReviewCriteria,
        });
      }
      expect(document.querySelector("#input")?.textContent).toBe(
        posted ? expectedText : "手動の下書き",
      );
      expect(click).toHaveBeenCalledTimes(posted ? 1 : 0);
      if (posted) expect(click).toHaveReturnedWith(expectedText);
      expect(
        mockRuntime.sendMessage.mock.calls.filter(([message]) => message.type === "SHOW_ERROR"),
      ).toHaveLength(review === "error" ? 1 : 0);

      contentListener({ type: "TOGGLE_RECOGNITION" }, {}, vi.fn());
      await vi.advanceTimersByTimeAsync(0);
    },
  );
});
