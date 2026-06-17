import { isTargetPage } from './utils/url.js';

const GROK_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const SUPPORTED_FORMAT_LANGUAGES = new Set([
  'ar', 'cs', 'da', 'de', 'en', 'es', 'fa', 'fil', 'fr', 'hi',
  'id', 'it', 'ja', 'ko', 'mk', 'ms', 'nl', 'pl', 'pt', 'ro',
  'ru', 'sv', 'th', 'tr', 'vi'
]);

function normalizeGrokLanguage(language) {
  const code = String(language || '').split('-')[0].toLowerCase();
  return SUPPORTED_FORMAT_LANGUAGES.has(code) ? code : '';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

function createGrokSttRequestBody({ audioBase64, language, boostPhrases = [] }) {
  const formData = new FormData();
  const normalizedLanguage = normalizeGrokLanguage(language);

  if (normalizedLanguage) {
    formData.append('format', 'true');
    formData.append('language', normalizedLanguage);
  }

  formData.append('audio_format', 'pcm');
  formData.append('sample_rate', '16000');

  for (const phrase of boostPhrases) {
    formData.append('keyterm', phrase);
  }

  formData.append('file', base64ToBlob(audioBase64, 'audio/l16;rate=16000'), 'audio.pcm');
  return formData;
}

async function recognizeGrokSpeech(message) {
  if (!message.apiKey) {
    throw new Error('xAI APIキーが設定されていません。設定画面で入力してください。');
  }

  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(GROK_STT_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${message.apiKey}` },
        body: createGrokSttRequestBody(message)
      });

      if (!response.ok) {
        if (response.status === 429 && attempt < maxRetries) {
          await delay(Math.pow(2, attempt) * 1000);
          continue;
        }
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Grok STT API error ${response.status}: ${errorBody || response.statusText}`);
      }

      const data = await response.json();
      return data.text || '';
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt < maxRetries) {
        await delay(Math.pow(2, attempt) * 1000);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

// アイコンクリック時の処理
chrome.action.onClicked.addListener(async (tab) => {
  // YouTube/YouTube Studioのページかチェック
  if (!tab.url || !isTargetPage(tab.url)) {
    showNotification('エラー', 'YouTubeまたはYouTube Studioのページで使用してください');
    return;
  }

  // content.jsにトグルメッセージを送信
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_RECOGNITION' });
    updateBadge(response.isActive);
  } catch (error) {
    console.log('content.js未読み込み、注入を試みます...');

    // content.jsを注入して再試行
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['dist/content.js']
      });

      // 少し待ってからメッセージ送信
      await new Promise(resolve => setTimeout(resolve, 100));
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_RECOGNITION' });
      updateBadge(response.isActive);
    } catch (injectError) {
      console.error('content.js注入失敗:', injectError);
      setBadgeError();
      showNotification('エラー', 'ページを再読み込みしてから再試行してください');
    }
  }
});

// バッジ更新
export function updateBadge(isActive) {
  if (isActive) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // 緑
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// エラーバッジ
export function setBadgeError() {
  chrome.action.setBadgeText({ text: '×' });
  chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // 赤
}

// 通知表示
export function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: title,
    message: message
  }).catch(err => {
    console.error('[Voice Live Comment] 通知表示エラー:', err);
  });
}

// content.jsからのメッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    updateBadge(message.isActive);
  } else if (message.type === 'SHOW_ERROR') {
    console.error('[Voice Live Comment] エラー:', message.message);
    setBadgeError();
    showNotification('エラー', message.message);
  } else if (message.type === 'GROK_STT_RECOGNIZE') {
    recognizeGrokSpeech(message)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
