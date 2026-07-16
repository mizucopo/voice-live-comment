import {
  trimText,
  parseDictionaryRules,
  applyDictionary,
  type DictionaryRule,
} from "./utils/text.js";
import { DEFAULT_SETTINGS, normalizeSettings, type ExtensionSettings } from "./settings.js";
import type { SttProvider } from "./stt/stt-provider.js";
import { BrowserSttProvider } from "./stt/browser-stt-provider.js";
import { GoogleSttProvider } from "./stt/google-stt-provider.js";
import { GrokSttProvider } from "./stt/grok-stt-provider.js";
import { createExternalPipeline } from "./external-pipeline.js";
import { VoiceCommentSession } from "./voice-comment-session.js";

type ChatInput = HTMLElement | HTMLInputElement;
type ValueElement = HTMLElement & { value: string };

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let parsedRules: DictionaryRule[] = [];

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
  settings = normalizeSettings(result);
  parsedRules = parseDictionaryRules(settings.dictionary);
  return settings;
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

// テキストを入力して送信
function inputAndSubmit(text: string): void {
  text = trimText(text);
  text = applyDictionary(text, parsedRules);
  console.log("[Voice Live Comment] 確定:", text);

  if (!text) return;

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

  if (settings.autoPost) {
    setTimeout(() => {
      const sendButton = findSendButton();

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
      } else {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          }),
        );
        input.dispatchEvent(
          new KeyboardEvent("keypress", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          }),
        );
        input.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            bubbles: true,
          }),
        );
      }
    }, 200);
  }
}

// エラーをbackgroundに送信
function sendError(message: string): void {
  void chrome.runtime.sendMessage({ type: "SHOW_ERROR", message });
}

// プロバイダーを作成
function createProvider(providerSettings: ExtensionSettings = settings): SttProvider {
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

const session = new VoiceCommentSession({
  loadSettings,
  createProvider,
  createExternalPipeline,
  postComment: inputAndSubmit,
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
      void (async () => {
        await loadSettings();
        await session.restartWithLatestSettings();
      })();
    }
    return true;
  });
}
