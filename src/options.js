// デフォルト設定
const DEFAULT_SETTINGS = {
  sttProvider: 'browser',
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: '',
  googleApiKey: ''
};

// Provider別の設定UI表示切り替え
function updateProviderUI(provider) {
  const browserSettings = document.getElementById('browserSettings');
  const googleSettings = document.getElementById('googleSettings');
  const unimplementedWarning = document.getElementById('unimplementedWarning');

  browserSettings.style.display = 'none';
  googleSettings.style.display = 'none';
  unimplementedWarning.style.display = 'none';

  if (provider === 'browser') {
    browserSettings.style.display = '';
  } else if (provider === 'google') {
    googleSettings.style.display = '';
  } else {
    unimplementedWarning.style.display = '';
  }
}

// 設定を読み込んでフォームに反映
export async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('sttProvider').value = result.sttProvider;
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
  document.getElementById('useLocalModel').checked = result.useLocalModel;
  document.getElementById('boostPhrases').value = result.boostPhrases.join('\n');
  document.getElementById('dictionary').value = result.dictionary;
  document.getElementById('googleApiKey').value = result.googleApiKey;
  updateProviderUI(result.sttProvider);
  return result;
}

// 設定を保存
export async function saveSettings() {
  const sttProvider = document.getElementById('sttProvider').value;
  const autoPost = document.getElementById('autoPost').checked;
  const language = document.getElementById('language').value.trim() || 'ja-JP';
  const useLocalModel = document.getElementById('useLocalModel').checked;
  const boostPhrases = document.getElementById('boostPhrases').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);
  const dictionary = document.getElementById('dictionary').value;
  const googleApiKey = document.getElementById('googleApiKey').value.trim();

  await chrome.storage.sync.set({
    sttProvider, autoPost, language, useLocalModel, boostPhrases, dictionary, googleApiKey
  });

  // content scriptへ設定更新を通知
  const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://studio.youtube.com/*'] });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
  });

  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);

  return { sttProvider, autoPost, language, useLocalModel, boostPhrases, dictionary, googleApiKey };
}

// 初期化
export function init() {
  document.addEventListener('DOMContentLoaded', loadSettings);
  document.getElementById('save').addEventListener('click', saveSettings);
  document.getElementById('sttProvider').addEventListener('change', (e) => {
    updateProviderUI(e.target.value);
  });
}

// 自動初期化
if (typeof window !== 'undefined' && document.getElementById('save')) {
  init();
}
