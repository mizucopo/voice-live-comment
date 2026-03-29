const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// テキストをトリムし、連続する空白を1つにまとめる
function trimText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.trim().replace(/\s+/g, ' ');
}

// 辞書テキストをパースして置換ルール配列に変換する
function parseDictionaryRules(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('→');
      if (idx === -1) return null;
      return { from: line.slice(0, idx), to: line.slice(idx + 1) };
    })
    .filter(Boolean);
}

// 置換ルールをテキストに適用する
function applyDictionary(text, rules) {
  for (const rule of rules) {
    text = text.replaceAll(rule.from, rule.to);
  }
  return text;
}

// デュアルバッファリング状態
const recognitions = [null, null];
let activeIndex = 0;
let nextPreStarted = false;
let isActive = false;
let isInitialStart = true;
let settings = {
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: ''
};
let parsedRules = [];

// チャット入力欄を取得
function findChatInput() {
  const liveChatInput = document.querySelector('yt-live-chat-text-input-field-renderer div#input') ||
                         document.querySelector('yt-live-chat-text-input-field-renderer div[contenteditable]') ||
                         document.querySelector('div#input[contenteditable]');
  if (liveChatInput) return liveChatInput;

  const studioInput = document.querySelector('tp-yt-paper-input input') ||
                      document.querySelector('tp-yt-iron-input input') ||
                      document.querySelector('input.tp-yt-paper-input');
  if (studioInput) return studioInput;

  const ytInput = document.querySelector('#chat #input') ||
                  document.querySelector('#chat [contenteditable="true"]');
  if (ytInput) return ytInput;

  const chatContainer = document.querySelector('#chat') || document.querySelector('yt-live-chat-app');
  if (chatContainer) {
    return chatContainer.querySelector('[contenteditable="true"]');
  }

  return null;
}

// ページリロード時にバッジをリセット
chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });

const hasChat = !!findChatInput();

// 設定を読み込む
async function loadSettings() {
  const result = await chrome.storage.sync.get({
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: ''
  });
  settings = result;
  parsedRules = parseDictionaryRules(settings.dictionary);
  return settings;
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
  text = trimText(text);
  text = applyDictionary(text, parsedRules);
  console.log('[Voice Live Comment] 確定:', text);

  if (!text) return;

  const input = findChatInput();

  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  input.focus();

  if (input.contentEditable === 'true' || input.hasAttribute('contenteditable')) {
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.tagName === 'INPUT') {
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

  if (settings.autoPost) {
    setTimeout(() => {
      const sendButton = findSendButton();

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keypress', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }
    }, 200);
  }
}

// エラーをbackgroundに送信
function sendError(message) {
  chrome.runtime.sendMessage({ type: 'SHOW_ERROR', message });
}

// 認識インスタンスをセットアップ
function setupRecognitionInstance(index) {
  const rec = new SpeechRecognition();

  rec.lang = settings.language;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  // オンデバイスモデル（Chrome 138+）
  if (settings.useLocalModel && 'processLocally' in rec) {
    rec.processLocally = true;
  }

  // ワードブースト（Chrome 138+, オンデバイスのみ）
  if (settings.useLocalModel && typeof SpeechRecognitionPhrase !== 'undefined' && settings.boostPhrases.length > 0) {
    rec.phrases = settings.boostPhrases.map(p => new SpeechRecognitionPhrase(p, 10.0));
  }

  rec.onstart = () => {
    if (isInitialStart) {
      isActive = true;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      console.log('[Voice Live Comment] 音声認識を開始しました');
      isInitialStart = false;
    }
  };

  rec.onresult = (event) => {
    let finalText = '';
    let hasFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
        hasFinal = true;
      }
    }
    if (finalText) {
      inputAndSubmit(finalText);
    }
    // アクティブインスタンスの最終結果で次を先行起動
    if (hasFinal && index === activeIndex) {
      preStartNextInstance();
    }
  };

  rec.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      sendError('マイクへのアクセスが拒否されました');
      stopRecognition(true);
      return;
    }
  };

  rec.onend = () => {
    if (!isActive) return;

    if (index === activeIndex) {
      // アクティブインスタンス終了 → 次に切り替え
      activeIndex = (index + 1) % 2;
      nextPreStarted = false;
      // 次がまだ起動していなければフォールバック起動
      if (!recognitions[activeIndex]) {
        startInstance(activeIndex);
      }
    } else {
      // 先行起動したインスタンスが予期せず終了 → 再起動
      recognitions[index] = null;
    }
  };

  recognitions[index] = rec;
  return rec;
}

// 指定インデックスのインスタンスを起動
function startInstance(index) {
  if (recognitions[index]) {
    try { recognitions[index].stop(); } catch (e) {}
    recognitions[index] = null;
  }
  const rec = setupRecognitionInstance(index);
  rec.start();
}

// 次インスタンスを先行起動
function preStartNextInstance() {
  if (nextPreStarted) return;
  nextPreStarted = true;
  const nextIndex = (activeIndex + 1) % 2;
  startInstance(nextIndex);
}

// 音声認識を開始
function startRecognition() {
  if (!SpeechRecognition) {
    sendError('このブラウザは音声認識に対応していません');
    return;
  }

  loadSettings().then(() => {
    activeIndex = 0;
    nextPreStarted = false;
    startInstance(0);
  });
}

// 音声認識を停止
function stopRecognition(keepErrorBadge = false) {
  isActive = false;
  isInitialStart = true;
  nextPreStarted = false;

  for (let i = 0; i < 2; i++) {
    if (recognitions[i]) {
      try { recognitions[i].stop(); } catch (e) {}
      recognitions[i] = null;
    }
  }

  if (!keepErrorBadge) {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
  }
  console.log('[Voice Live Comment] 音声認識を停止しました');
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
      loadSettings().then(() => {
        if (isActive) {
          stopRecognition();
          startRecognition();
        }
      });
    }
    return true;
  });
}
