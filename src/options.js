// デフォルト設定
const DEFAULT_SETTINGS = {
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: ''
};

// 設定を読み込んでフォームに反映
export async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
  document.getElementById('useLocalModel').checked = result.useLocalModel;
  document.getElementById('boostPhrases').value = result.boostPhrases.join('\n');
  document.getElementById('dictionary').value = result.dictionary;
  return result;
}

// 設定を保存
export async function saveSettings() {
  const autoPost = document.getElementById('autoPost').checked;
  const language = document.getElementById('language').value.trim() || 'ja-JP';
  const useLocalModel = document.getElementById('useLocalModel').checked;
  const boostPhrases = document.getElementById('boostPhrases').value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line);
  const dictionary = document.getElementById('dictionary').value;

  await chrome.storage.sync.set({ autoPost, language, useLocalModel, boostPhrases, dictionary });

  // content scriptへ設定更新を通知
  const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://studio.youtube.com/*'] });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {
      // エラーは無視（content scriptが読み込まれていない場合など）
    });
  });

  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);

  return { autoPost, language, useLocalModel, boostPhrases, dictionary };
}

// 初期化
export function init() {
  document.addEventListener('DOMContentLoaded', loadSettings);
  document.getElementById('save').addEventListener('click', saveSettings);
}

// 自動初期化（ブラウザ環境でDOM要素が存在する場合のみ実行）
if (typeof window !== 'undefined' && document.getElementById('save')) {
  init();
}
