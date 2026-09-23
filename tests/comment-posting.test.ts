import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_TIMEOUT_MS } from "../src/comment-review.js";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/settings.js";
import { mockRuntime, mockStorage, type RuntimeMessageListener } from "./setup.js";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const approved = { ok: true, decision: "post" };
const rejected = { ok: true, decision: "skip" };

describe("投稿前レビューからYouTubeへの入力・投稿", () => {
  const review = vi.fn<(message: Record<string, unknown>) => Promise<unknown>>();
  let listener: RuntimeMessageListener;
  let settings: ExtensionSettings;
  let sent: string[];

  function input(): HTMLElement | HTMLInputElement {
    const value = document.querySelector("#input");
    if (!(value instanceof HTMLElement)) throw new Error("入力欄がありません");
    return value;
  }

  function inputText(): string {
    const element = input();
    return element instanceof HTMLInputElement ? element.value : (element.textContent ?? "");
  }

  function setInputText(text: string): void {
    const element = input();
    if (element instanceof HTMLInputElement) element.value = text;
    else element.textContent = text;
  }

  async function start(): Promise<void> {
    listener({ type: "TOGGLE_RECOGNITION" }, {}, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    const recognition = global.MockSpeechRecognition.instances.at(-1);
    if (!recognition) throw new Error("音声認識が開始されていません");
    recognition.onstart();
  }

  function recognize(text: string): void {
    const recognition = global.MockSpeechRecognition.instances.at(-1);
    if (!recognition) throw new Error("音声認識が開始されていません");
    recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }

  async function setup(overrides: Partial<ExtensionSettings> = {}, studio = false): Promise<void> {
    settings = {
      ...DEFAULT_SETTINGS,
      recognitionVolumeThreshold: 0,
      commentReviewEnabled: true,
      ...overrides,
    };
    document.body.innerHTML = studio
      ? '<tp-yt-paper-input><input id="input" value="手動の下書き" /></tp-yt-paper-input><button id="send-button">送信</button>'
      : '<div id="chat"><div id="input" contenteditable="true">手動の下書き</div><button id="send-button">送信</button></div>';
    document.querySelector("#send-button")?.addEventListener("click", () => {
      sent.push(inputText());
    });
    mockStorage.sync.get.mockImplementation(() => Promise.resolve(settings));
    await import("../src/content.js");
    const registered = mockRuntime.onMessage.addListener.mock.calls.at(-1)?.at(0);
    if (!registered) throw new Error("リスナーがありません");
    listener = registered;
    await start();
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    sent = [];
    review.mockReset().mockResolvedValue(approved);
    mockRuntime.sendMessage.mockImplementation((message) =>
      message.type === "REVIEW_COMMENT" ? review(message) : Promise.resolve(undefined),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([true, false])("レビューOFF・自動投稿%sではJevに送信しない", async (autoPost) => {
    await setup({ commentReviewEnabled: false, autoPost });
    recognize("独り言です");
    await vi.advanceTimersByTimeAsync(200);
    expect(review).not.toHaveBeenCalled();
    expect(inputText()).toBe("独り言です");
    expect(sent).toEqual(autoPost ? ["独り言です"] : []);
  });

  it.each([false, true])(
    "承認された辞書適用後の本文を一度だけ投稿する（Studio=%s）",
    async (studio) => {
      await setup({ dictionary: "とーきょー→東京" }, studio);
      recognize("  とーきょー  だね ");
      await vi.advanceTimersByTimeAsync(200);
      expect(review).toHaveBeenCalledExactlyOnceWith({
        type: "REVIEW_COMMENT",
        text: "東京 だね",
        criteria: settings.commentReviewCriteria,
      });
      expect(sent).toEqual(["東京 だね"]);
      expect(inputText()).toBe("東京 だね");
    },
  );

  it.each([false, true])("却下時は下書きを保持し送信しない（自動投稿=%s）", async (autoPost) => {
    await setup({ autoPost });
    review.mockResolvedValue(rejected);
    recognize("却下する文");
    await vi.advanceTimersByTimeAsync(500);
    expect(inputText()).toBe("手動の下書き");
    expect(sent).toEqual([]);
    expect(
      mockRuntime.sendMessage.mock.calls.filter(([message]) => message.type === "SHOW_ERROR"),
    ).toEqual([]);
  });

  it("自動投稿OFFでも入力前にレビューし、承認された文だけを入力する", async () => {
    await setup({ autoPost: false });
    const pending = deferred<unknown>();
    review.mockReturnValue(pending.promise);
    recognize("おなかすいたな");
    await vi.advanceTimersByTimeAsync(0);
    expect(inputText()).toBe("手動の下書き");
    pending.resolve(approved);
    await vi.advanceTimersByTimeAsync(500);
    expect(inputText()).toBe("おなかすいたな");
    expect(sent).toEqual([]);
  });

  it.each([undefined, {}, { ok: true, decision: "unknown" }, { ok: false, error: "APIエラー" }])(
    "失敗・不正応答 %j は入力せず通知し、次のコメントを処理する",
    async (response) => {
      await setup();
      review.mockResolvedValueOnce(response);
      recognize("最初");
      await vi.advanceTimersByTimeAsync(300);
      expect(inputText()).toBe("手動の下書き");
      expect(sent).toEqual([]);
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith({
        type: "SHOW_ERROR",
        message: expect.stringContaining("投稿前レビュー"),
      });
      recognize("次のコメント");
      await vi.advanceTimersByTimeAsync(200);
      expect(sent).toEqual(["次のコメント"]);
    },
  );

  it("メッセージ通信が失敗しても入力・投稿しない", async () => {
    await setup();
    review.mockRejectedValue(new Error("通信切断"));
    recognize("通信失敗");
    await vi.advanceTimersByTimeAsync(200);
    expect(inputText()).toBe("手動の下書き");
    expect(sent).toEqual([]);
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith({
      type: "SHOW_ERROR",
      message: expect.stringContaining("通信切断"),
    });
  });

  it("応答がない場合も10秒で次へ進み、遅れた承認は投稿しない", async () => {
    await setup();
    const pending = deferred<unknown>();
    review.mockReturnValueOnce(pending.promise);
    recognize("遅いコメント");
    recognize("次のコメント");
    await vi.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS);
    expect(sent).toEqual([]);
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith({
      type: "SHOW_ERROR",
      message: expect.stringContaining("タイムアウト"),
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toEqual(["次のコメント"]);
    pending.resolve(approved);
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual(["次のコメント"]);
  });

  it("連続コメントは送信完了まで順序を保ち、却下を飛ばす", async () => {
    await setup();
    const first = deferred<unknown>();
    review.mockReturnValueOnce(first.promise).mockResolvedValueOnce(rejected);
    recognize("一番目");
    recognize("二番目");
    recognize("三番目");
    await vi.advanceTimersByTimeAsync(0);
    expect(review).toHaveBeenCalledTimes(1);
    first.resolve(approved);
    await vi.advanceTimersByTimeAsync(199);
    expect(review).toHaveBeenCalledTimes(1);
    expect(inputText()).toBe("一番目");
    await vi.advanceTimersByTimeAsync(201);
    expect(review.mock.calls.map(([message]) => message.text)).toEqual([
      "一番目",
      "二番目",
      "三番目",
    ]);
    expect(sent).toEqual(["一番目", "三番目"]);
  });

  it("レビュー中に停止すると待ち行列を破棄し、再開を古い応答で妨げない", async () => {
    await setup();
    const pending = deferred<unknown>();
    review.mockReturnValueOnce(pending.promise);
    recognize("停止前");
    recognize("待ち行列");
    await vi.advanceTimersByTimeAsync(0);
    listener({ type: "TOGGLE_RECOGNITION" }, {}, vi.fn());
    await start();
    recognize("再開後");
    await vi.advanceTimersByTimeAsync(200);
    pending.resolve(approved);
    await vi.advanceTimersByTimeAsync(200);
    expect(review.mock.calls.map(([message]) => message.text)).toEqual(["停止前", "再開後"]);
    expect(sent).toEqual(["再開後"]);
  });

  it("設定変更受信時に取り消し、新しい設定の読込完了前でも古い承認を無効にする", async () => {
    await setup();
    const pending = deferred<unknown>();
    review.mockReturnValueOnce(pending.promise);
    recognize("変更前");
    await vi.advanceTimersByTimeAsync(0);
    const loading = deferred<ExtensionSettings>();
    mockStorage.sync.get.mockReturnValueOnce(loading.promise);
    listener({ type: "SETTINGS_UPDATED" }, {}, vi.fn());
    pending.resolve(approved);
    await vi.advanceTimersByTimeAsync(200);
    expect(inputText()).toBe("手動の下書き");
    expect(sent).toEqual([]);
    loading.resolve({ ...settings, commentReviewEnabled: false });
    await vi.advanceTimersByTimeAsync(0);
    global.MockSpeechRecognition.instances.at(-1)?.onstart();
    recognize("変更後");
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toEqual(["変更後"]);
    expect(review).toHaveBeenCalledOnce();
  });

  it.each(["stop", "settings", "edit"])("承認後の200ms待機中の%sで送信しない", async (action) => {
    await setup();
    recognize("承認済み");
    await vi.advanceTimersByTimeAsync(0);
    expect(inputText()).toBe("承認済み");
    if (action === "edit") setInputText("手動で書き換えた文");
    else
      listener(
        { type: action === "stop" ? "TOGGLE_RECOGNITION" : "SETTINGS_UPDATED" },
        {},
        vi.fn(),
      );
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([]);
  });

  it("送信ボタンがない場合は承認済み本文だけEnterで送信する", async () => {
    await setup();
    document.querySelector("#send-button")?.remove();
    const keys: string[] = [];
    input().addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") keys.push(inputText());
    });
    recognize("こんにちは");
    await vi.advanceTimersByTimeAsync(200);
    expect(keys).toEqual(["こんにちは"]);
    review.mockResolvedValue(rejected);
    recognize("却下文");
    await vi.advanceTimersByTimeAsync(200);
    expect(keys).toEqual(["こんにちは"]);
  });

  it("辞書適用後の空文字はレビューも入力もしない", async () => {
    await setup({ dictionary: "削除→" });
    recognize("削除");
    await vi.advanceTimersByTimeAsync(200);
    expect(review).not.toHaveBeenCalled();
    expect(inputText()).toBe("手動の下書き");
    expect(sent).toEqual([]);
  });
});
