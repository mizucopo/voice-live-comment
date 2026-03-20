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
    console.error('content.jsとの通信に失敗:', error);
    setBadgeError();
    showNotification('エラー', 'ページを再読み込みしてから再試行してください');
  }
});

// 対象ページかどうか判定
function isTargetPage(url) {
  return url.includes('youtube.com/watch') ||
         url.includes('youtube.com/live') ||
         url.includes('studio.youtube.com');
}

// バッジ更新
function updateBadge(isActive) {
  if (isActive) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // 緑
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// エラーバッジ
function setBadgeError() {
  chrome.action.setBadgeText({ text: '×' });
  chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // 赤
}

// 通知表示
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message
  });
}

// content.jsからのメッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_BADGE') {
    updateBadge(message.isActive);
  } else if (message.type === 'SHOW_ERROR') {
    setBadgeError();
    showNotification('エラー', message.message);
  }
});
