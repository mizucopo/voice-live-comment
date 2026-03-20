const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isActive = false;
let isRestarting = false;
let isInitialStart = true;
let settings = { autoPost: true, language: 'ja-JP' };

// チャット入力欄を取得
function findChatInput() {
  // YouTube Studio / Live Chat - contenteditableなdiv
  const liveChatInput = document.querySelector('yt-live-chat-text-input-field-renderer div#input') ||
                         document.querySelector('yt-live-chat-text-input-field-renderer div[contenteditable]') ||
                         document.querySelector('div#input[contenteditable]');
  if (liveChatInput) return liveChatInput;

  // YouTube Studio (配信者側) - iframe内のinput
  const studioInput = document.querySelector('tp-yt-paper-input input') ||
                      document.querySelector('tp-yt-iron-input input') ||
                      document.querySelector('input.tp-yt-paper-input');
  if (studioInput) return studioInput;

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

// ページリロード時にバッジをリセット
chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });

// チャット入力欄があるフレームでのみ動作
const hasChat = !!findChatInput();

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
  // トリム処理：前後のスペース除去＋連続スペースを1つに
  text = text.trim().replace(/\s+/g, ' ');
  console.log('[Voice Live Comment] 確定:', text);

  if (!text) return; // 空文字の場合は何もしない

  const input = findChatInput();

  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  input.focus();

  // contenteditableなdivの場合
  if (input.contentEditable === 'true' || input.hasAttribute('contenteditable')) {
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // input要素の場合
  else if (input.tagName === 'INPUT') {
    const paperInput = input.closest('tp-yt-paper-input') ||
                       document.querySelector('tp-yt-paper-input');

    if (paperInput) {
      paperInput.value = text;
      paperInput.dispatchEvent(new CustomEvent('value-changed', {
        bubbles: true,
        detail: { value: text }
      }));
    }

    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 自動投稿の場合は送信
  if (settings.autoPost) {
    setTimeout(() => {
      const sendButton = findSendButton();

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keypress', {
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
      }
    }, 200);
  }
}

// エラーをbackgroundに送信
function sendError(message) {
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
        inputAndSubmit(finalText);
      }
    };

    recognition.onerror = (event) => {
      // 権限エラーは停止して通知
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        sendError('マイクへのアクセスが拒否されました');
        stopRecognition(true);
        return;
      }

      // no-speech, aborted はonendで再開するので何もしない
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // その他のエラーは自動再試行
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
  isInitialStart = true;

  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // 既に停止している場合は無視
    }
    recognition = null;
  }

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
    } else if (message.type === 'SETTINGS_UPDATED') {
      // 設定更新時に再読み込み
      loadSettings().then(() => {
        if (isActive) {
          restartRecognition();
        }
      });
    }
    return true;
  });
}
