import { DEFAULT_SETTINGS, normalizeSettings, type ExtensionSettings } from "./settings.js";
import { CommentPostingQueue } from "./comment-posting.js";
import { REVIEW_TIMEOUT_MS, type CommentReviewDecision } from "./comment-review.js";
import type { SttProvider } from "./stt/stt-provider.js";
import { BrowserSttProvider } from "./stt/browser-stt-provider.js";
import { GoogleSttProvider } from "./stt/google-stt-provider.js";
import { GrokSttProvider } from "./stt/grok-stt-provider.js";
import { createExternalPipeline } from "./external-pipeline.js";
import { VoiceCommentSession } from "./voice-comment-session.js";

type ChatInput = HTMLElement | HTMLInputElement;
type ValueElement = HTMLElement & { value: string };

// チャット入力欄を取得
function findChatInput(): ChatInput | null {
  const liveChatInput =
    document.querySelector("yt-live-chat-text-input-field-renderer div#input") ??
    document.querySelector("yt-live-chat-text-input-field-renderer div[contenteditable]") ??
    document.querySelector("div#input[contenteditable]");
  if (liveChatInput instanceof HTMLElement) return liveChatInput;

  const studioInput =
    document.querySelector("tp-yt-paper-input input") ??
    document.querySelector("tp-yt-iron-input input") ??
    document.querySelector("input.tp-yt-paper-input");
  if (studioInput instanceof HTMLInputElement) return studioInput;

  const ytInput =
    document.querySelector("#chat #input") ??
    document.querySelector('#chat [contenteditable="true"]');
  if (ytInput instanceof HTMLElement) return ytInput;

  const chatContainer =
    document.querySelector("#chat") ?? document.querySelector("yt-live-chat-app");
  if (chatContainer) {
    return chatContainer.querySelector<HTMLElement>('[contenteditable="true"]');
  }

  return null;
}

// ページリロード時にバッジをリセット
void chrome.runtime.sendMessage({ type: "UPDATE_BADGE", isActive: false });

const hasChat = !!findChatInput();

// 設定を読み込む
async function loadSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(result);
}

// 送信ボタンを取得
function findSendButton(): HTMLButtonElement | null {
  return (
    document.querySelector<HTMLButtonElement>("#chat #send-button") ??
    document.querySelector<HTMLButtonElement>('[aria-label="送信"]') ??
    document.querySelector<HTMLButtonElement>('button[aria-label*="Send"]') ??
    document.querySelector<HTMLButtonElement>("#send-button")
  );
}

async function requestReview(
  text: string,
  criteria: string,
  signal: AbortSignal,
): Promise<CommentReviewDecision> {
  signal.throwIfAborted();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  try {
    const response: unknown = await new Promise((resolve, reject) => {
      abort = () => reject(new Error("投稿前レビューを取り消しました"));
      signal.addEventListener("abort", abort, { once: true });
      timeoutId = setTimeout(
        () => reject(new Error("投稿前レビューがタイムアウトしたため、投稿しませんでした")),
        REVIEW_TIMEOUT_MS,
      );
      chrome.runtime.sendMessage({ type: "REVIEW_COMMENT", text, criteria }).then(resolve, reject);
    });

    if (typeof response === "object" && response !== null && "ok" in response) {
      if (
        response.ok === true &&
        "decision" in response &&
        (response.decision === "post" || response.decision === "skip")
      ) {
        return response.decision;
      }
      if (response.ok === false && "error" in response && typeof response.error === "string") {
        throw new Error(response.error);
      }
    }
    throw new Error("投稿前レビューの応答が不正なため、投稿しませんでした");
  } catch (error) {
    throw new Error(
      "投稿前レビューに失敗しました: " + (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abort);
  }
}

// 承認された本文を入力し、送信完了まで次のコメントを待たせる。
async function inputAndSubmit(text: string, autoPost: boolean, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  const input = findChatInput();

  if (!input) {
    sendError("チャット入力欄が見つかりません");
    return;
  }

  input.focus();

  if (input.contentEditable === "true" || input.hasAttribute("contenteditable")) {
    input.textContent = text;
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (input.tagName === "INPUT") {
    const paperInput =
      input.closest("tp-yt-paper-input") ?? document.querySelector("tp-yt-paper-input");

    if (paperInput instanceof HTMLElement) {
      (paperInput as ValueElement).value = text;
      paperInput.dispatchEvent(
        new CustomEvent("value-changed", {
          bubbles: true,
          detail: { value: text },
        }),
      );
    }

    if (input instanceof HTMLInputElement) input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (autoPost && !signal.aborted) {
    await new Promise<void>((resolve) => {
      const cancel = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      const timeoutId = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        const currentText = input instanceof HTMLInputElement ? input.value : input.textContent;
        if (signal.aborted || findChatInput() !== input || currentText !== text) {
          resolve();
          return;
        }
        const sendButton = findSendButton();

        if (sendButton && !sendButton.disabled) {
          sendButton.click();
        } else {
          for (const type of ["keydown", "keypress", "keyup"]) {
            input.dispatchEvent(
              new KeyboardEvent(type, {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                bubbles: true,
              }),
            );
          }
        }
        resolve();
      }, 200);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
}

// エラーをbackgroundに送信
function sendError(message: string): void {
  void chrome.runtime.sendMessage({ type: "SHOW_ERROR", message });
}

// プロバイダーを作成
function createProvider(providerSettings: ExtensionSettings): SttProvider {
  switch (providerSettings.sttProvider) {
    case "google":
      return new GoogleSttProvider(providerSettings.googleApiKey, providerSettings.language);
    case "grok":
      return new GrokSttProvider(
        providerSettings.xaiApiKey,
        providerSettings.language,
        providerSettings.boostPhrases,
      );
    case "browser":
    default:
      return new BrowserSttProvider({
        language: providerSettings.language,
        useLocalModel: providerSettings.useLocalModel,
        boostPhrases: providerSettings.boostPhrases,
        recognitionVolumeThreshold: providerSettings.recognitionVolumeThreshold,
      });
  }
}

const postingQueue = new CommentPostingQueue({
  review: requestReview,
  submit: inputAndSubmit,
  notifyError: sendError,
});

const session = new VoiceCommentSession({
  loadSettings,
  createProvider,
  createExternalPipeline,
  postComment: (text, context) => {
    void postingQueue.enqueue(text, context);
  },
  notifyActive: (isActive) => {
    void chrome.runtime.sendMessage({ type: "UPDATE_BADGE", isActive });
  },
  notifyError: sendError,
});

// メッセージ受信（チャット入力欄があるフレームのみ）
if (hasChat) {
  chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
    if (message.type === "TOGGLE_RECOGNITION") {
      sendResponse(session.toggle());
    } else if (message.type === "SETTINGS_UPDATED") {
      // Invalidate pending reviews synchronously, before loading the new settings.
      void session.restartWithLatestSettings();
    }
    return true;
  });
  window.addEventListener("pagehide", () => void session.stop());
}
