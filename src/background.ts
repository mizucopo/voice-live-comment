import { isTargetPage } from "./utils/url.js";
import { recognizeGrokSpeech, type GrokSttMessage } from "./stt/grok-stt-service.js";

type ToggleResponse = { isActive: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToggleResponse(value: unknown): value is ToggleResponse {
  return isRecord(value) && typeof value.isActive === "boolean";
}

function isGrokSttMessage(value: unknown): value is GrokSttMessage & { type: string } {
  return (
    isRecord(value) &&
    value.type === "GROK_STT_RECOGNIZE" &&
    typeof value.apiKey === "string" &&
    typeof value.audioBase64 === "string" &&
    typeof value.language === "string" &&
    (value.boostPhrases === undefined ||
      (Array.isArray(value.boostPhrases) &&
        value.boostPhrases.every((phrase) => typeof phrase === "string")))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// アイコンクリック時の処理
chrome.action.onClicked.addListener((tab) => {
  void handleActionClick(tab);
});

async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  // YouTube/YouTube Studioのページかチェック
  if (!tab.url || !isTargetPage(tab.url)) {
    showNotification("エラー", "YouTubeまたはYouTube Studioのページで使用してください");
    return;
  }

  if (tab.id === undefined) {
    showNotification("エラー", "対象タブを特定できませんでした");
    return;
  }

  // content.jsにトグルメッセージを送信
  try {
    const response: unknown = await chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_RECOGNITION",
    });
    if (isToggleResponse(response)) updateBadge(response.isActive);
  } catch {
    console.log("content.js未読み込み、注入を試みます...");

    // content.jsを注入して再試行
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-script.js"],
      });

      // 少し待ってからメッセージ送信
      await new Promise((resolve) => setTimeout(resolve, 100));
      const response: unknown = await chrome.tabs.sendMessage(tab.id, {
        type: "TOGGLE_RECOGNITION",
      });
      if (isToggleResponse(response)) updateBadge(response.isActive);
    } catch (injectError) {
      console.error("content.js注入失敗:", injectError);
      setBadgeError();
      showNotification("エラー", "ページを再読み込みしてから再試行してください");
    }
  }
}

// バッジ更新
export function updateBadge(isActive: boolean): void {
  if (isActive) {
    void chrome.action.setBadgeText({ text: "●" });
    void chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" }); // 緑
  } else {
    void chrome.action.setBadgeText({ text: "" });
  }
}

// エラーバッジ
export function setBadgeError(): void {
  void chrome.action.setBadgeText({ text: "×" });
  void chrome.action.setBadgeBackgroundColor({ color: "#F44336" }); // 赤
}

// 通知表示
export function showNotification(title: string, message: string): void {
  void chrome.notifications
    .create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title,
      message: message,
    })
    .catch((error: unknown) => {
      console.error("[Voice Live Comment] 通知表示エラー:", error);
    });
}

// content.jsからのメッセージ受信
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    isRecord(message) &&
    message.type === "UPDATE_BADGE" &&
    typeof message.isActive === "boolean"
  ) {
    updateBadge(message.isActive);
  } else if (
    isRecord(message) &&
    message.type === "SHOW_ERROR" &&
    typeof message.message === "string"
  ) {
    console.error("[Voice Live Comment] エラー:", message.message);
    setBadgeError();
    showNotification("エラー", message.message);
  } else if (isGrokSttMessage(message)) {
    recognizeGrokSpeech(message)
      .then((text) => {
        sendResponse({ ok: true, text });
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: errorMessage(error) });
      });
    return true;
  }
});
