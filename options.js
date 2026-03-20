// デフォルト設定
const DEFAULT_SETTINGS = {
  autoPost: true,
  language: 'ja-JP'
};

// 設定を読み込んでフォームに反映
async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
}

// 設定を保存
async function saveSettings() {
  const autoPost = document.getElementById('autoPost').checked;
  const language = document.getElementById('language').value.trim() || 'ja-JP';

  await chrome.storage.sync.set({ autoPost, language });

  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('save').addEventListener('click', saveSettings);
