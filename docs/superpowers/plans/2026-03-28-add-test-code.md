# テストコード追加 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voice Live Comment（Chrome拡張機能）にVitestを使用したテストコードを追加し、テスト可能な構造にリファクタリングする

**Architecture:** 純粋関数をutils/に抽出し、既存ファイルをsrc/に移動。Chrome APIをモックして統合テストを実現。

**Tech Stack:** Vitest, jsdom, @vitest/coverage-v8

---

## ファイル構成

### 新規作成
- `package.json` - 依存関係定義
- `vitest.config.js` - Vitest設定
- `test/setup.js` - Chrome APIモック
- `src/utils/url.js` - URL判定関数
- `src/utils/text.js` - テキスト処理関数
- `test/utils/url.test.js` - URL関数テスト
- `test/utils/text.test.js` - テキスト関数テスト
- `test/background.test.js` - バックグラウンドテスト
- `test/content.test.js` - コンテンツスクリプトテスト
- `test/options.test.js` - 設定画面テスト

### 移動・修正
- `background.js` → `src/background.js`
- `content.js` → `src/content.js`
- `options.js` → `src/options.js`
- `manifest.json` - パス更新

---

## Task 1: プロジェクトセットアップ

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: package.jsonを作成**

```json
{
  "name": "voice-live-comment",
  "version": "1.0.0",
  "description": "音声認識でYouTube Liveにコメント投稿",
  "type": "module",
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "jsdom": "^26.0.0"
  }
}
```

- [ ] **Step 2: vitest.config.jsを作成**

```javascript
export default {
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/**/*.test.js']
    }
  }
};
```

- [ ] **Step 3: 依存関係をインストール**

Run: `npm install`
Expected: node_modulesが作成され、依存関係がインストールされる

- [ ] **Step 4: コミット**

```bash
git add package.json vitest.config.js package-lock.json
git commit -m "chore: add vitest configuration"
```

---

## Task 2: テストセットアップファイル作成

**Files:**
- Create: `test/setup.js`

- [ ] **Step 1: testディレクトリを作成**

Run: `mkdir -p test/utils src/utils`

- [ ] **Step 2: test/setup.jsを作成**

```javascript
import { vi } from 'vitest';

// Chrome API モック
const mockStorage = {
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined)
  }
};

const mockTabs = {
  query: vi.fn().mockResolvedValue([]),
  sendMessage: vi.fn().mockResolvedValue({})
};

const mockAction = {
  setBadgeText: vi.fn().mockResolvedValue(undefined),
  setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined)
};

const mockNotifications = {
  create: vi.fn().mockResolvedValue('')
};

const mockScripting = {
  executeScript: vi.fn().mockResolvedValue([])
};

const mockRuntime = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn()
  }
};

global.chrome = {
  storage: mockStorage,
  tabs: mockTabs,
  action: mockAction,
  notifications: mockNotifications,
  scripting: mockScripting,
  runtime: mockRuntime
};

// SpeechRecognition モック
class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {}
  stop() {}
}

global.SpeechRecognition = MockSpeechRecognition;
global.webkitSpeechRecognition = MockSpeechRecognition;

// テスト間でモックをリセット
beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.sync.get.mockResolvedValue({});
  mockStorage.sync.set.mockResolvedValue(undefined);
  mockTabs.query.mockResolvedValue([]);
  mockTabs.sendMessage.mockResolvedValue({});
});
```

- [ ] **Step 3: コミット**

```bash
git add test/setup.js
git commit -m "chore: add test setup with Chrome API mocks"
```

---

## Task 3: URL関数の抽出とテスト

**Files:**
- Create: `src/utils/url.js`
- Create: `test/utils/url.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/utils/url.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { isTargetPage } from '../../src/utils/url.js';

describe('isTargetPage', () => {
  it('YouTube watch URLに対してtrueを返す', () => {
    expect(isTargetPage('https://www.youtube.com/watch?v=abc123')).toBe(true);
  });

  it('YouTube live URLに対してtrueを返す', () => {
    expect(isTargetPage('https://www.youtube.com/live/xyz789')).toBe(true);
  });

  it('YouTube Studio URLに対してtrueを返す', () => {
    expect(isTargetPage('https://studio.youtube.com/channel/123')).toBe(true);
  });

  it('その他のURLに対してfalseを返す', () => {
    expect(isTargetPage('https://example.com')).toBe(false);
  });

  it('YouTubeトップページに対してfalseを返す', () => {
    expect(isTargetPage('https://www.youtube.com/')).toBe(false);
  });

  it('YouTube search URLに対してfalseを返す', () => {
    expect(isTargetPage('https://www.youtube.com/results?search_query=test')).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- test/utils/url.test.js`
Expected: FAIL - モジュールが見つからない

- [ ] **Step 3: 最小限の実装を書く**

`src/utils/url.js`:

```javascript
/**
 * URLがYouTube Live/配信対象ページかどうかを判定
 * @param {string} url - 判定対象のURL
 * @returns {boolean} 対象ページならtrue
 */
export function isTargetPage(url) {
  return url.includes('youtube.com/watch') ||
         url.includes('youtube.com/live') ||
         url.includes('studio.youtube.com');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- test/utils/url.test.js`
Expected: PASS - 全6テスト成功

- [ ] **Step 5: コミット**

```bash
git add src/utils/url.js test/utils/url.test.js
git commit -m "feat: add isTargetPage utility with tests"
```

---

## Task 4: テキスト処理関数の抽出とテスト

**Files:**
- Create: `src/utils/text.js`
- Create: `test/utils/text.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/utils/text.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { trimText } from '../../src/utils/text.js';

describe('trimText', () => {
  it('前後のスペースを除去する', () => {
    expect(trimText('  hello world  ')).toBe('hello world');
  });

  it('連続スペースを1つにする', () => {
    expect(trimText('hello    world')).toBe('hello world');
  });

  it('空文字をそのまま返す', () => {
    expect(trimText('')).toBe('');
  });

  it('スペースのみを空文字にする', () => {
    expect(trimText('   ')).toBe('');
  });

  it('タブ文字も処理する', () => {
    expect(trimText('\thello\tworld\t')).toBe('hello world');
  });

  it('改行をスペースに変換する', () => {
    expect(trimText('hello\nworld')).toBe('hello world');
  });

  it('正常なテキストはそのまま', () => {
    expect(trimText('hello world')).toBe('hello world');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- test/utils/text.test.js`
Expected: FAIL - モジュールが見つからない

- [ ] **Step 3: 最小限の実装を書く**

`src/utils/text.js`:

```javascript
/**
 * テキストをトリムし、連続する空白を1つにまとめる
 * @param {string} text - 処理対象のテキスト
 * @returns {string} トリム済みのテキスト
 */
export function trimText(text) {
  return text.trim().replace(/\s+/g, ' ');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- test/utils/text.test.js`
Expected: PASS - 全7テスト成功

- [ ] **Step 5: コミット**

```bash
git add src/utils/text.js test/utils/text.test.js
git commit -m "feat: add trimText utility with tests"
```

---

## Task 5: background.jsの移動とリファクタリング

**Files:**
- Create: `src/background.js`
- Modify: `manifest.json`
- Create: `test/background.test.js`
- Delete: `background.js` (移動後)

- [ ] **Step 1: src/background.jsを作成（リファクタリング版）**

```javascript
import { isTargetPage } from './utils/url.js';

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
        files: ['src/content.js']
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

- [ ] **Step 2: 失敗するテストを書く**

`test/background.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateBadge, setBadgeError, showNotification } from '../src/background.js';

describe('background.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateBadge', () => {
    it('アクティブ時に緑のバッジを設定する', async () => {
      await updateBadge(true);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#4CAF50' });
    });

    it('非アクティブ時にバッジをクリアする', async () => {
      await updateBadge(false);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  describe('setBadgeError', () => {
    it('エラー時に赤い×バッジを設定する', async () => {
      await setBadgeError();
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '×' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#F44336' });
    });
  });

  describe('showNotification', () => {
    it('通知を作成する', async () => {
      await showNotification('テストタイトル', 'テストメッセージ');
      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'テストタイトル',
        message: 'テストメッセージ'
      });
    });
  });
});
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npm test -- test/background.test.js`
Expected: PASS

- [ ] **Step 4: manifest.jsonを更新**

manifest.jsonのservice_workerパスを更新：

```json
"background": {
  "service_worker": "src/background.js",
  "type": "module"
},
```

- [ ] **Step 5: 古いbackground.jsを削除**

Run: `rm background.js`

- [ ] **Step 6: コミット**

```bash
git add src/background.js test/background.test.js manifest.json
git rm background.js
git commit -m "refactor: move background.js to src/ and add tests"
```

---

## Task 6: content.jsの移動とリファクタリング

**Files:**
- Create: `src/content.js`
- Modify: `manifest.json`
- Create: `test/content.test.js`
- Delete: `content.js` (移動後)

- [ ] **Step 1: src/content.jsを作成（リファクタリング版）**

```javascript
import { trimText } from './utils/text.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isActive = false;
let isRestarting = false;
let isInitialStart = true;
let settings = { autoPost: true, language: 'ja-JP' };

// チャット入力欄を取得
export function findChatInput() {
  // YouTube Studio / Live Chat - contenteditableなdiv
  const liveChatInput = document.querySelector('yt-live-chat-text-input-field-renderer div#input') ||
                         document.querySelector('yt-live-chat-text-input-field-renderer div[contenteditable]') ||
                         document.querySelector('div#input[contenteditable]');
  if (liveChatInput) return liveChatInput;

  // YouTube Studio (配信者側) - iframe内のinput
  const studioInput = document.querySelector('tp-yt-paper-input input') ||
                      document.querySelector('tp-yt-iron-input input') ||
                      document.querySelector('input.tp-yt-paper-input');
  if (studioInput) return studioInput;

  // YouTube視聴側
  const ytInput = document.querySelector('#chat #input') ||
                  document.querySelector('#chat [contenteditable="true"]');
  if (ytInput) return ytInput;

  // フォールバック: chat内のcontenteditable
  const chatContainer = document.querySelector('#chat') || document.querySelector('yt-live-chat-app');
  if (chatContainer) {
    return chatContainer.querySelector('[contenteditable="true"]');
  }

  return null;
}

// 送信ボタンを取得
export function findSendButton() {
  return document.querySelector('#chat #send-button') ||
         document.querySelector('[aria-label="送信"]') ||
         document.querySelector('button[aria-label*="Send"]') ||
         document.querySelector('#send-button');
}

// テキストを入力して送信
export function inputAndSubmit(text) {
  // トリム処理：前後のスペース除去＋連続スペースを1つに
  text = trimText(text);
  console.log('[Voice Live Comment] 確定:', text);

  if (!text) return; // 空文字の場合は何もしない

  const input = findChatInput();

  if (!input) {
    sendError('チャット入力欄が見つかりません');
    return;
  }

  input.focus();

  // contenteditableなdivの場合
  if (input.contentEditable === 'true' || input.hasAttribute('contenteditable')) {
    input.textContent = text;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: text,
      inputType: 'insertText'
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // input要素の場合
  else if (input.tagName === 'INPUT') {
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

  // 自動投稿の場合は送信
  if (settings.autoPost) {
    setTimeout(() => {
      const sendButton = findSendButton();

      if (sendButton && !sendButton.disabled) {
        sendButton.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keypress', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        }));
      }
    }, 200);
  }
}

// エラーをbackgroundに送信
function sendError(message) {
  chrome.runtime.sendMessage({ type: 'SHOW_ERROR', message });
}

// 設定を読み込む
export async function loadSettings() {
  const result = await chrome.storage.sync.get({ autoPost: true, language: 'ja-JP' });
  settings = result;
  return settings;
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
      isRestarting = false;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      if (isInitialStart) {
        console.log('[Voice Live Comment] 音声認識を開始しました');
        isInitialStart = false;
      }
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
        inputAndSubmit(finalText);
      }
    };

    recognition.onerror = (event) => {
      // 権限エラーは停止して通知
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        sendError('マイクへのアクセスが拒否されました');
        stopRecognition(true);
        return;
      }

      // no-speech, aborted はonendで再開するので何もしない
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // その他のエラーは自動再試行
      if (isActive) {
        setTimeout(() => {
          if (isActive) restartRecognition();
        }, 100);
      }
    };

    recognition.onend = () => {
      // 自動再開（ユーザーが停止していない場合）
      if (isActive && !isRestarting) {
        isRestarting = true;
        restartRecognition();
      }
    };

    recognition.start();
  });
}

// 音声認識を停止
function stopRecognition(keepErrorBadge = false) {
  isActive = false;
  isInitialStart = true;

  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      // 既に停止している場合は無視
    }
    recognition = null;
  }

  if (!keepErrorBadge) {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
  }
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

// ページリロード時にバッジをリセット
chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });

// チャット入力欄があるフレームでのみ動作
const hasChat = !!findChatInput();

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
      // 設定更新時に再読み込み
      loadSettings().then(() => {
        if (isActive) {
          restartRecognition();
        }
      });
    }
    return true;
  });
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/content.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findChatInput, findSendButton, inputAndSubmit, loadSettings } from '../src/content.js';

describe('content.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('findChatInput', () => {
    it('yt-live-chat-text-input-field-renderer内のdiv#inputを取得する', () => {
      document.body.innerHTML = `
        <yt-live-chat-text-input-field-renderer>
          <div id="input" contenteditable="true"></div>
        </yt-live-chat-text-input-field-renderer>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.id).toBe('input');
    });

    it('tp-yt-paper-input内のinputを取得する', () => {
      document.body.innerHTML = `
        <tp-yt-paper-input>
          <input type="text" />
        </tp-yt-paper-input>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.tagName).toBe('INPUT');
    });

    it('#chat内のcontenteditableを取得する', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div contenteditable="true"></div>
        </div>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.hasAttribute('contenteditable')).toBe(true);
    });

    it('チャット入力欄がない場合はnullを返す', () => {
      document.body.innerHTML = '<div>no chat here</div>';
      const result = findChatInput();
      expect(result).toBeNull();
    });
  });

  describe('findSendButton', () => {
    it('#send-buttonを取得する', () => {
      document.body.innerHTML = '<button id="send-button">送信</button>';
      const result = findSendButton();
      expect(result).not.toBeNull();
      expect(result.id).toBe('send-button');
    });

    it('aria-label="送信"のボタンを取得する', () => {
      document.body.innerHTML = '<button aria-label="送信">Send</button>';
      const result = findSendButton();
      expect(result).not.toBeNull();
    });

    it('送信ボタンがない場合はnullを返す', () => {
      document.body.innerHTML = '<div>no button</div>';
      const result = findSendButton();
      expect(result).toBeNull();
    });
  });

  describe('inputAndSubmit', () => {
    it('トリム処理を適用する', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      const input = document.getElementById('input');
      input.focus = vi.fn();

      inputAndSubmit('  hello   world  ');

      expect(input.textContent).toBe('hello world');
    });

    it('空文字の場合は何もしない', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      const input = document.getElementById('input');
      input.focus = vi.fn();

      inputAndSubmit('   ');

      expect(input.textContent).toBe('');
    });

    it('チャット入力欄がない場合はエラーを送信する', () => {
      document.body.innerHTML = '';
      inputAndSubmit('test');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SHOW_ERROR',
        message: 'チャット入力欄が見つかりません'
      });
    });
  });

  describe('loadSettings', () => {
    it('デフォルト値で設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: true, language: 'ja-JP' });
    });

    it('保存済み設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: false, language: 'en-US' });
    });
  });
});
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npm test -- test/content.test.js`
Expected: PASS

- [ ] **Step 4: manifest.jsonを更新**

manifest.jsonのcontent_scriptsパスを更新：

```json
"content_scripts": [
  {
    "matches": [
      "*://www.youtube.com/live/*",
      "*://www.youtube.com/watch*",
      "*://studio.youtube.com/*"
    ],
    "js": ["src/content.js"],
    "all_frames": true
  }
],
```

- [ ] **Step 5: 古いcontent.jsを削除**

Run: `rm content.js`

- [ ] **Step 6: コミット**

```bash
git add src/content.js test/content.test.js manifest.json
git rm content.js
git commit -m "refactor: move content.js to src/ and add tests"
```

---

## Task 7: options.jsの移動とテスト

**Files:**
- Create: `src/options.js`
- Modify: `manifest.json` または `options.html`
- Create: `test/options.test.js`
- Delete: `options.js` (移動後)

- [ ] **Step 1: src/options.jsを作成（リファクタリング版）**

```javascript
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

// 自動初期化（ブラウザ環境でのみ実行）
if (typeof window !== 'undefined') {
  init();
}
```

- [ ] **Step 2: 失敗するテストを書く**

`test/options.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSettings, saveSettings } from '../src/options.js';

describe('options.js', () => {
  let autoPostCheckbox;
  let languageInput;
  let statusElement;

  beforeEach(() => {
    // DOM構築
    document.body.innerHTML = `
      <input type="checkbox" id="autoPost" />
      <input type="text" id="language" />
      <div id="status"></div>
      <button id="save">保存</button>
    `;
    autoPostCheckbox = document.getElementById('autoPost');
    languageInput = document.getElementById('language');
    statusElement = document.getElementById('status');

    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadSettings', () => {
    it('デフォルト値で設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(true);
      expect(languageInput.value).toBe('ja-JP');
    });

    it('保存済み設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(false);
      expect(languageInput.value).toBe('en-US');
    });
  });

  describe('saveSettings', () => {
    it('設定を保存する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'en-US';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'en-US'
      });
      expect(result).toEqual({ autoPost: true, language: 'en-US' });
    });

    it('空の言語はデフォルト値にする', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = '   ';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'ja-JP'
      });
      expect(result).toEqual({ autoPost: true, language: 'ja-JP' });
    });

    it('保存後にステータスを表示する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(statusElement.textContent).toBe('保存しました');

      vi.advanceTimersByTime(2000);
      expect(statusElement.textContent).toBe('');
    });

    it('YouTubeタブに設定更新を通知する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      chrome.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.youtube.com/watch?v=test' }
      ]);

      await saveSettings();

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'SETTINGS_UPDATED' });
    });
  });
});
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npm test -- test/options.test.js`
Expected: PASS

- [ ] **Step 4: options.htmlを更新**

options.htmlのスクリプトパスを更新：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Voice Live Comment 設定</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    label { display: block; margin: 10px 0; }
    button { margin-top: 10px; padding: 8px 16px; }
    #status { color: green; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>設定</h1>
  <label>
    <input type="checkbox" id="autoPost" />
    自動投稿する
  </label>
  <label>
    言語コード:
    <input type="text" id="language" value="ja-JP" />
  </label>
  <button id="save">保存</button>
  <div id="status"></div>
  <script type="module" src="src/options.js"></script>
</body>
</html>
```

- [ ] **Step 5: 古いoptions.jsを削除**

Run: `rm options.js`

- [ ] **Step 6: コミット**

```bash
git add src/options.js test/options.test.js options.html
git rm options.js
git commit -m "refactor: move options.js to src/ and add tests"
```

---

## Task 8: 全テスト実行とカバレッジ確認

**Files:**
- なし（確認のみ）

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: 全テストPASS

- [ ] **Step 2: カバレッジを確認**

Run: `npm run test:coverage`
Expected: カバレッジ80%以上

- [ ] **Step 3: 最終コミット**

```bash
git add -A
git commit -m "test: complete test implementation with 80%+ coverage"
```

---

## 完了基準

- [ ] 全テストがパスする
- [ ] カバレッジ80%以上
- [ ] 既存機能が動作する（Chrome拡張として正常動作）
