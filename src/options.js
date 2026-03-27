// デフォルト設定
const DEFAULT_SETTINGS = {
  autoPost: true,
  language: 'ja-JP'
};

// 設定を読み込んでフォームに反映
export async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
  return result;
}

// 設定を保存
export async function saveSettings() {
  const autoPost = document.getElementById('autoPost').checked;
  const language = document.getElementById('language').value.trim() || 'ja-JP';

  await chrome.storage.sync.set({ autoPost, language });

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

  return { autoPost, language };
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
