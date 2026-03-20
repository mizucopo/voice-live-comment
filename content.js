const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isActive = false;
let isRestarting = false;
let isInitialStart = true;
let settings = { autoPost: true, language: 'ja-JP' };

// チャット入力欄を取得
function findChatInput() {
  // YouTube Studio (配信者側) - iframe内のinput
  const studioInput = document.querySelector('tp-yt-paper-input input') ||
                      document.querySelector('tp-yt-iron-input input') ||
                      document.querySelector('input.tp-yt-paper-input');
  if (studioInput) return studioInput;

  // YouTube Studio (その他のセレクタ)
  const studioAlt = document.querySelector('#input') ||
                     document.querySelector('yt-live-chat-text-input-field-renderer #input') ||
                     document.querySelector('yt-live-chat-text-input-field-renderer [contenteditable="true"]') ||
                     document.querySelector('#input-container [contenteditable="true"]');
  if (studioAlt) return studioAlt;

  // YouTube視聴側
  const ytInput = document.querySelector('#chat #input') ||
                  document.querySelector('#chat [contenteditable="true"]');
  if (ytInput) return ytInput;

  // フォールバック: chat内のcontenteditable
  const chatContainer = document.querySelector('#chat') || document.querySelector('yt-live-chat-app');
  if (chatContainer) {
    return chatContainer.querySelector('[contenteditable="true"]');
  }

  return null;
}

// チャット入力欄があるフレームでのみ動作
const hasChat = !!findChatInput();

if (!hasChat) {
  console.log('[Voice Live Comment] このフレームにはチャット入力欄がありません');
} else {
  console.log('[Voice Live Comment] チャット入力欄を検出しました');
}

// 設定を読み込む
async function loadSettings() {
  const result = await chrome.storage.sync.get({ autoPost: true, language: 'ja-JP' });
  settings = result;
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
  console.log('[Voice Live Comment] inputAndSubmit - input要素:', input);

  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  input.focus();
  console.log('[Voice Live Comment] input要素の種類:', input.tagName);

  // input要素の場合はvalueを使用
  if (input.tagName === 'INPUT') {
    // 値を設定
    input.value = text;

    // 複数のイベントを発火してフレームワークに検知させる
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    console.log('[Voice Live Comment] INPUTに値を設定:', text, '現在のvalue:', input.value);
  } else {
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    console.log('[Voice Live Comment] contenteditableに値を設定:', text);
  }

  // 自動投稿の場合は送信
  if (settings.autoPost) {
    // 少し待ってから送信ボタンを探す（フレームワークの更新を待つ）
    setTimeout(() => {
      const sendButton = findSendButton();
      console.log('[Voice Live Comment] 送信ボタン:', sendButton, 'disabled:', sendButton?.disabled);

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        console.log('[Voice Live Comment] 送信ボタンをクリック');
      } else {
        // 送信ボタンが無効な場合はEnterキー
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
        console.log('[Voice Live Comment] Enterキーを送信');
      }
    }, 100);
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
      isRestarting = false;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      if (isInitialStart) {
        console.log('[Voice Live Comment] 音声認識を開始しました');
        isInitialStart = false;
      }
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
      // 権限エラーは停止して通知
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('[Voice Live Comment] 権限エラー:', event.error);
        sendError('マイクへのアクセスが拒否されました');
        stopRecognition(true);
        return;
      }

      // no-speech, aborted はonendで再開するので何もしない
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // その他のエラーは自動再試行
      console.warn('[Voice Live Comment] エラー:', event.error);
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 100);
      }
    };

    recognition.onend = () => {
      // 自動再開（ユーザーが停止していない場合）
      if (isActive && !isRestarting) {
        isRestarting = true;
        restartRecognition();
      }
    };

    recognition.start();
  });
}

// 音声認識を停止
function stopRecognition(keepErrorBadge = false) {
  isActive = false;
  isInitialStart = true; // 次回開始時にログを出力

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

// メッセージ受信（チャット入力欄があるフレームのみ）
if (hasChat) {
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
}

// 初期化
console.log('[Voice Live Comment] Content script loaded');
