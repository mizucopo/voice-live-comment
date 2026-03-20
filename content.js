const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isActive = false;
let settings = { autoPost: true, language: 'ja-JP' };

// 設定を読み込む
async function loadSettings() {
  const result = await chrome.storage.sync.get({ autoPost: true, language: 'ja-JP' });
  settings = result;
}

// チャット入力欄を取得
function findChatInput() {
  // YouTube視聴側
  const ytInput = document.querySelector('#chat #input') ||
                  document.querySelector('#chat [contenteditable="true"]');
  if (ytInput) return ytInput;

  // YouTube Studio
  const studioInput = document.querySelector('#input-container [contenteditable="true"]') ||
                      document.querySelector('yt-live-chat-message-input-renderer #input');
  if (studioInput) return studioInput;

  // フォールバック: chat内のcontenteditable
  const chatContainer = document.querySelector('#chat') || document.querySelector('yt-live-chat-app');
  if (chatContainer) {
    return chatContainer.querySelector('[contenteditable="true"]');
  }

  return null;
}

// 送信ボタンを取得
function findSendButton() {
  return document.querySelector('#chat #send-button') ||
         document.querySelector('[aria-label="送信"]') ||
         document.querySelector('button[aria-label*="Send"]') ||
         document.querySelector('#send-button');
}

// テキストを入力して送信
function inputAndSubmit(text) {
  const input = findChatInput();
  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  // contenteditableにテキストを入力
  input.focus();
  input.textContent = text;

  // 入力イベントを発火（React等のフレームワーク対応）
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));

  // 自動投稿の場合は送信
  if (settings.autoPost) {
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
    } else {
      // 送信ボタンが見つからない場合はEnterキー
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      }));
    }
  }
}

// エラーをbackgroundに送信
function sendError(message) {
  console.error('[Voice Live Comment] sendError:', message);
  chrome.runtime.sendMessage({ type: 'SHOW_ERROR', message });
}

// 音声認識を開始
function startRecognition() {
  if (!SpeechRecognition) {
    sendError('このブラウザは音声認識に対応していません');
    return;
  }

  loadSettings().then(() => {
    recognition = new SpeechRecognition();
    recognition.lang = settings.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isActive = true;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      console.log('[Voice Live Comment] 音声認識を開始しました');
    };

    recognition.onresult = (event) => {
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        }
      }

      if (finalText) {
        console.log('[Voice Live Comment] 確定:', finalText);
        inputAndSubmit(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.error('[Voice Live Comment] エラー:', event.error);

      // 権限エラーは停止
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        sendError('マイクへのアクセスが拒否されました');
        stopRecognition(true);
        return;
      }

      // その他のエラーは自動再試行
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 500);
      }
    };

    recognition.onend = () => {
      console.log('[Voice Live Comment] 音声認識が終了しました');

      // 自動再開（ユーザーが停止していない場合）
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 500);
      }
    };

    recognition.start();
  });
}

// 音声認識を停止
function stopRecognition(keepErrorBadge = false) {
  isActive = false;

  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // 既に停止している場合は無視
    }
    recognition = null;
  }

  // エラー時はバッジをそのまま残す
  if (!keepErrorBadge) {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
  }
  console.log('[Voice Live Comment] 音声認識を停止しました');
}

// 音声認識を再開
function restartRecognition() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // 無視
    }
    recognition = null;
  }
  startRecognition();
}

// メッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_RECOGNITION') {
    if (isActive) {
      stopRecognition();
    } else {
      startRecognition();
    }
    sendResponse({ isActive });
  }
  return true;
});

// 初期化
console.log('[Voice Live Comment] Content script loaded');
