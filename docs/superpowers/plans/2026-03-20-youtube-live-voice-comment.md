# YouTube Live 音声コメント拡張機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 音声認識したテキストをYouTube Liveのチャットに自動投稿するChrome拡張機能を構築する

**Architecture:** Content Script方式。YouTube/YouTube Studioページに注入されたcontent.jsが音声認識を行い、チャット入力欄に直接テキストを入力・投稿する。background.jsはアイコンクリックのハンドリングとバッジ/通知制御を担当。

**Tech Stack:** Chrome Extension Manifest V3, Web Speech API, chrome.storage.sync, chrome.notifications

---

## ファイル構成

```
voice-live-comment/
├── manifest.json           # 拡張機能定義（Manifest V3）
├── background.js           # Service Worker
├── content.js              # YouTube/YouTube Studio用スクリプト
├── options.html            # 設定画面
├── options.js              # 設定画面ロジック
├── popup.html              # 削除
├── popup.js                # 削除
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Task 1: プロジェクトセットアップ

**Files:**
- Delete: `popup.html`, `popup.js`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

- [ ] **Step 1: 既存ファイルの削除**

```bash
rm popup.html popup.js
```

- [ ] **Step 2: iconsディレクトリ作成**

```bash
mkdir -p icons
```

- [ ] **Step 3: アイコン画像の準備**

シンプルなマイクアイコンを作成（SVGからPNG変換、またはプレースホルダー画像）

※ 実際のアイコンは別途用意するか、以下のようなプレースホルダーを使用:
```bash
# 一時的にシンプルなPNGを作成（実装時に本番アイコンに差し替え）
# 今後のステップで適切なアイコンを用意
```

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "chore: 不要なpopupファイルを削除、iconsディレクトリを追加"
```

---

## Task 2: manifest.json の更新

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: manifest.jsonをManifest V3形式に更新**

```json
{
  "manifest_version": 3,
  "name": "Voice Live Comment",
  "version": "1.0.0",
  "description": "音声認識でYouTube Liveにコメント投稿",
  "permissions": [
    "storage",
    "activeTab",
    "notifications"
  ],
  "host_permissions": [
    "*://www.youtube.com/*",
    "*://studio.youtube.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": [
        "*://www.youtube.com/live/*",
        "*://www.youtube.com/watch*",
        "*://studio.youtube.com/*"
      ],
      "js": ["content.js"]
    }
  ],
  "options_page": "options.html",
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: コミット**

```bash
git add manifest.json
git commit -m "feat: Manifest V3形式に更新、権限とcontent_scriptsを定義"
```

---

## Task 3: 設定画面 (options.html, options.js)

**Files:**
- Create: `options.html`
- Create: `options.js`

- [ ] **Step 1: options.htmlを作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Voice Live Comment 設定</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 400px;
      margin: 20px;
      line-height: 1.6;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 600;
    }
    input[type="text"] {
      width: 100%;
      padding: 8px;
      font-size: 14px;
      box-sizing: border-box;
    }
    .hint {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }
    button {
      padding: 8px 16px;
      font-size: 14px;
      cursor: pointer;
    }
    .status {
      margin-top: 12px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>設定</h1>

  <div class="form-group">
    <label>
      <input type="checkbox" id="autoPost" checked>
      自動投稿する
    </label>
    <div class="hint">オフの場合、テキストを入力欄に入れるだけで送信しません</div>
  </div>

  <div class="form-group">
    <label for="language">言語コード</label>
    <input type="text" id="language" value="ja-JP" placeholder="例: ja-JP, en-US, ko-KR, zh-CN">
    <div class="hint">音声認識の言語を指定します</div>
  </div>

  <button id="save">保存</button>
  <div id="status" class="status"></div>

  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: options.jsを作成**

```javascript
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
```

- [ ] **Step 3: コミット**

```bash
git add options.html options.js
git commit -m "feat: 設定画面を追加（自動投稿、言語設定）"
```

---

## Task 4: Background Service Worker (background.js)

**Files:**
- Create: `background.js`

- [ ] **Step 1: background.jsを作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add background.js
git commit -m "feat: Background Service Workerを追加（アイコンクリック、バッジ、通知）"
```

---

## Task 5: Content Script (content.js)

**Files:**
- Create: `content.js`

- [ ] **Step 1: content.jsを作成（基本構造）**

```javascript
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isActive = false;
let settings = { autoPost: true, language: 'ja-JP' };

// 設定を読み込む
async function loadSettings() {
  const result = await chrome.storage.sync.get({ autoPost: true, language: 'ja-JP' });
  settings = result;
}

// チャット入力欄を取得
function findChatInput() {
  // YouTube視聴側
  const ytInput = document.querySelector('#chat #input') ||
                  document.querySelector('#chat [contenteditable="true"]');
  if (ytInput) return ytInput;

  // YouTube Studio
  const studioInput = document.querySelector('#input-container [contenteditable="true"]') ||
                      document.querySelector('yt-live-chat-message-input-renderer #input');
  if (studioInput) return studioInput;

  // フォールバック: chat内のcontenteditable
  const chatContainer = document.querySelector('#chat') || document.querySelector('yt-live-chat-app');
  if (chatContainer) {
    return chatContainer.querySelector('[contenteditable="true"]');
  }

  return null;
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
  const input = findChatInput();
  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  // contenteditableにテキストを入力
  input.focus();
  input.textContent = text;

  // 入力イベントを発火（React等のフレームワーク対応）
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));

  // 自動投稿の場合は送信
  if (settings.autoPost) {
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
    } else {
      // 送信ボタンが見つからない場合はEnterキー
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      }));
    }
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
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      console.log('[Voice Live Comment] 音声認識を開始しました');
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
        console.log('[Voice Live Comment] 確定:', finalText);
        inputAndSubmit(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.error('[Voice Live Comment] エラー:', event.error);

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        sendError('マイクへのアクセスが拒否されました');
        stopRecognition();
        return;
      }

      // その他のエラーは自動再試行
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 500);
      }
    };

    recognition.onend = () => {
      console.log('[Voice Live Comment] 音声認識が終了しました');

      // 自動再開（ユーザーが停止していない場合）
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 500);
      }
    };

    recognition.start();
  });
}

// 音声認識を停止
function stopRecognition() {
  isActive = false;

  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // 既に停止している場合は無視
    }
    recognition = null;
  }

  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
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

// メッセージ受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_RECOGNITION') {
    if (isActive) {
      stopRecognition();
    } else {
      startRecognition();
    }
    sendResponse({ isActive });
  }
  return true;
});

// 初期化
console.log('[Voice Live Comment] Content script loaded');
```

- [ ] **Step 2: コミット**

```bash
git add content.js
git commit -m "feat: Content Scriptを追加（音声認識、チャット入力）"
```

---

## Task 6: アイコン画像の作成

**Files:**
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

- [ ] **Step 1: シンプルなSVGアイコンを作成（PNGに変換）**

※ 実際のプロジェクトではデザイナーが作成するか、アイコン生成ツールを使用

一時的なプレースホルダーとして、以下のコマンドでシンプルなPNGを作成可能:
```bash
# ImageMagickがある場合
convert -size 16x16 xc:none -fill "#4285F4" -draw "circle 8,8 8,2" icons/icon16.png
convert -size 48x48 xc:none -fill "#4285F4" -draw "circle 24,24 24,6" icons/icon48.png
convert -size 128x128 xc:none -fill "#4285F4" -draw "circle 64,64 64,16" icons/icon128.png
```

または、シンプルなマイクアイコンのSVGを作成してPNG変換。

- [ ] **Step 2: コミット**

```bash
git add icons/
git commit -m "feat: 拡張機能アイコンを追加"
```

---

## Task 7: 動作確認とデバッグ

**Files:**
- なし（手動テスト）

- [ ] **Step 1: Chromeに拡張機能を読み込む**

1. Chromeで `chrome://extensions/` を開く
2. 「デベロッパーモード」をオン
3. 「パッケージ化されていない拡張機能を読み込む」
4. `voice-live-comment` ディレクトリを選択

- [ ] **Step 2: YouTube Liveページでテスト**

1. YouTube Live配信ページを開く（例: `https://www.youtube.com/live/xxx`）
2. 拡張機能アイコンをクリック → バッジが「●」になる
3. マイクに向かって話す → チャット入力欄にテキストが入る
4. 自動投稿がオンなら自動送信
5. 再度アイコンクリック → バッジが消える

- [ ] **Step 3: YouTube Studioでテスト**

1. YouTube Studioのライブ配信画面を開く
2. 同様にテスト

- [ ] **Step 4: 設定画面をテスト**

1. 拡張機能を右クリック → 「オプション」
2. 自動投稿をオフにして保存
3. 音声認識 → 入力欄にテキストが入るが送信されない
4. 手動でEnter押下で送信

---

## Task 8: 最終コミットとバージョンタグ

**Files:**
- なし

- [ ] **Step 1: 最終確認**

```bash
git status
git log --oneline -10
```

- [ ] **Step 2: バージョンタグ**

```bash
git tag -a v1.0.0 -m "Initial release"
```

---

## 完了条件

- [ ] YouTube Live視聴側で音声認識→チャット投稿が動作する
- [ ] YouTube Studio配信側で音声認識→チャット投稿が動作する
- [ ] アイコンクリックでON/OFFトグル
- [ ] バッジで状態表示（緑●=認識中、なし=停止）
- [ ] エラー時にバッジ×＋通知表示
- [ ] 設定画面で自動投稿ON/OFF、言語設定が可能
