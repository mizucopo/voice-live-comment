import { trimText, parseDictionaryRules, applyDictionary } from './utils/text.js';
import { BrowserSttProvider } from './stt/browser-stt-provider.js';
import { GoogleSttProvider } from './stt/google-stt-provider.js';
import { AudioCapture } from './audio-capture.js';
import { Vad } from './vad.js';
import { VoiceCommentSession } from './voice-comment-session.js';

const SUPPORTED_STT_PROVIDERS = new Set(['browser', 'google']);

function normalizeSttProvider(provider) {
  return SUPPORTED_STT_PROVIDERS.has(provider) ? provider : 'browser';
}

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
  settings = { ...result, sttProvider: normalizeSttProvider(result.sttProvider) };
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
function createProvider(providerSettings = settings) {
  switch (providerSettings.sttProvider) {
    case 'google':
      return new GoogleSttProvider(providerSettings.googleApiKey, providerSettings.language);
    case 'browser':
    default:
      return new BrowserSttProvider({
        language: providerSettings.language,
        useLocalModel: providerSettings.useLocalModel,
        boostPhrases: providerSettings.boostPhrases
      });
  }
}

// 外部API用のAudioCapture + VADパイプラインを作成
async function createExternalPipeline(provider) {
  const audioCapture = new AudioCapture();
  const vad = new Vad();

  try {
    await vad.init();

    audioCapture.onPcmData((frame) => vad.processFrame(frame));
    vad.onSpeechStart(() => audioCapture.startRecording());
    vad.onSpeechEnd(() => {
      const blob = audioCapture.stopRecording();
      if (blob.size > 0) {
        provider.sendAudio(blob);
      }
    });

    await audioCapture.start();
  } catch (error) {
    vad.destroy();
    try { await audioCapture.stop(); } catch (_) {}
    throw error;
  }

  return {
    async stop() {
      try { await audioCapture.stop(); } catch (_) {}
      vad.destroy();
    }
  };
}

const session = new VoiceCommentSession({
  loadSettings,
  createProvider,
  createExternalPipeline,
  postComment: inputAndSubmit,
  notifyActive: (isActive) => chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive }),
  notifyError: sendError
});

// メッセージ受信（チャット入力欄があるフレームのみ）
if (hasChat) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_RECOGNITION') {
      sendResponse(session.toggle());
    } else if (message.type === 'SETTINGS_UPDATED') {
      loadSettings().then(() => session.restartWithLatestSettings());
    }
    return true;
  });
}
