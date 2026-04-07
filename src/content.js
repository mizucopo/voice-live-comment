import { trimText, parseDictionaryRules, applyDictionary } from './utils/text.js';
import { BrowserSttProvider } from './stt/browser-stt-provider.js';
import { GoogleSttProvider } from './stt/google-stt-provider.js';
import { SpeechmaticsSttProvider } from './stt/speechmatics-stt-provider.js';
import { DeepgramSttProvider } from './stt/deepgram-stt-provider.js';
import { AudioCapture } from './audio-capture.js';
import { Vad } from './vad.js';

let isActive = false;
let isStarting = false;
let currentProvider = null;
let audioCapture = null;
let vad = null;
let settings = {
  sttProvider: 'browser',
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: '',
  googleApiKey: ''
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
    sttProvider: 'browser',
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: '',
    googleApiKey: ''
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

// プロバイダーを作成
function createProvider() {
  switch (settings.sttProvider) {
    case 'google':
      return new GoogleSttProvider(settings.googleApiKey, settings.language);
    case 'speechmatics':
      return new SpeechmaticsSttProvider();
    case 'deepgram':
      return new DeepgramSttProvider();
    case 'browser':
    default:
      return new BrowserSttProvider({
        language: settings.language,
        useLocalModel: settings.useLocalModel,
        boostPhrases: settings.boostPhrases
      });
  }
}

// 外部API用のAudioCapture + VADパイプラインをセットアップ
async function setupExternalPipeline(provider) {
  audioCapture = new AudioCapture();
  vad = new Vad();

  await vad.init();

  audioCapture.onPcmData((frame) => vad.processFrame(frame));
  vad.onSpeechStart(() => audioCapture?.startRecording());
  vad.onSpeechEnd(() => {
    if (!audioCapture) return;
    const blob = audioCapture.stopRecording();
    if (blob.size > 0) {
      provider.sendAudio(blob);
    }
  });

  await audioCapture.start();
}

// 音声認識を開始
async function startRecognition() {
  await loadSettings();

  let provider;
  try {
    provider = createProvider();
  } catch (error) {
    sendError(error.message);
    return;
  }

  currentProvider = provider;

  provider.onStart(() => {
    isActive = true;
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
    console.log('[Voice Live Comment] 音声認識を開始しました');
  });

  provider.onResult((text) => {
    inputAndSubmit(text);
  });

  provider.onError((error) => {
    sendError(error.message);
  });

  // 外部API使用時はAudioCapture + VADパイプラインを初期化
  if (settings.sttProvider !== 'browser') {
    try {
      await setupExternalPipeline(provider);
    } catch (error) {
      sendError('VADの初期化に失敗しました: ' + error.message);
      currentProvider = null;
      return;
    }
  }

  try {
    await provider.start();
  } catch (error) {
    sendError(error.message);
    currentProvider = null;
  }
}

// 音声認識を停止
async function stopRecognition() {
  isActive = false;

  if (audioCapture) {
    try { await audioCapture.stop(); } catch (e) {}
    audioCapture = null;
  }

  if (currentProvider) {
    try { await currentProvider.stop(); } catch (e) {}
    currentProvider = null;
  }

  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
  console.log('[Voice Live Comment] 音声認識を停止しました');
}

// メッセージ受信（チャット入力欄があるフレームのみ）
if (hasChat) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_RECOGNITION') {
      if (isActive) {
        stopRecognition();
      } else if (isStarting) {
        sendResponse({ isActive: false });
        return true;
      } else {
        isStarting = true;
        startRecognition().finally(() => {
          isStarting = false;
        });
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
