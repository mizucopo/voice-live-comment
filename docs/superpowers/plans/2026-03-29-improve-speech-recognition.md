# 音声認識精度改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 字幕ちゃん(jimakuChan)の手法を取り入れ、デュアルバッファリング・オンデバイスモデル・ワードブースト・カスタム辞書を導入して音声認識精度を改善する。

**Architecture:** content.js の単一インスタンス認識を2インスタンスのデュアルバッファリングに変更。`continuous = false` で発話単位の高精度認識を実現し、認識結果取得時に次インスタンスを先行起動してギャップをなくす。新設定（オンデバイス、ワードブースト、カスタム辞書）を options に追加。

**Tech Stack:** Chrome Extension MV3, Web Speech API (webkitSpeechRecognition), Vitest, jsdom

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/text.js` | Modify | `parseDictionaryRules()` / `applyDictionary()` を追加 |
| `test/utils/text.test.js` | Modify | 辞書ユーティリティのテストを追加 |
| `test/setup.js` | Modify | MockSpeechRecognition に `processLocally` / `phrases` を追加、コンストラクタ追跡 |
| `options.html` | Modify | 新設定項目のUI追加 |
| `src/options.js` | Modify | 新設定の保存・読み込み |
| `test/options.test.js` | Modify | 新設定のテスト |
| `src/content.js` | Rewrite | デュアルバッファリング + 全新機能 |
| `test/content.test.js` | Modify | デュアルバッファリングのテスト |

---

### Task 1: 辞書ユーティリティ追加 (utils/text.js)

**Files:**
- Modify: `src/utils/text.js`
- Modify: `test/utils/text.test.js`

- [ ] **Step 1: parseDictionaryRules の失敗テストを書く**

`test/utils/text.test.js` に以下を追加:

```javascript
import { parseDictionaryRules, applyDictionary } from '../../src/utils/text.js';

describe('parseDictionaryRules', () => {
  it('正しい形式のルールをパースする', () => {
    const text = 'にしむら→西村\nじまく→字幕';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([
      { from: 'にしむら', to: '西村' },
      { from: 'じまく', to: '字幕' }
    ]);
  });

  it('空行を無視する', () => {
    const text = 'にしむら→西村\n\nじまく→字幕\n';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([
      { from: 'にしむら', to: '西村' },
      { from: 'じまく', to: '字幕' }
    ]);
  });

  it('コメント行（#始まり）を無視する', () => {
    const text = '# コメント\nにしむら→西村';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([{ from: 'にしむら', to: '西村' }]);
  });

  it('矢印がない行を無視する', () => {
    const text = '無効な行\nにしむら→西村';
    const rules = parseDictionaryRules(text);
    expect(rules).toEqual([{ from: 'にしむら', to: '西村' }]);
  });

  it('空文字は空配列を返す', () => {
    expect(parseDictionaryRules('')).toEqual([]);
    expect(parseDictionaryRules('   ')).toEqual([]);
  });

  it('null/undefinedは空配列を返す', () => {
    expect(parseDictionaryRules(null)).toEqual([]);
    expect(parseDictionaryRules(undefined)).toEqual([]);
  });
});

describe('applyDictionary', () => {
  it('ルールに従って置換する', () => {
    const rules = [
      { from: 'にしむら', to: '西村' },
      { from: 'じまく', to: '字幕' }
    ];
    expect(applyDictionary('にしむらさん、じまくちゃん', rules)).toBe('西村さん、字幕ちゃん');
  });

  it('ルールが空の場合は元のテキストを返す', () => {
    expect(applyDictionary('こんにちは', [])).toBe('こんにちは');
  });

  it('同じパターンが複数あっても全て置換する', () => {
    const rules = [{ from: 'aa', to: 'bb' }];
    expect(applyDictionary('aaとaa', rules)).toBe('bbとbb');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run test/utils/text.test.js`
Expected: FAIL — `parseDictionaryRules` and `applyDictionary` are not exported from text.js

- [ ] **Step 3: parseDictionaryRules と applyDictionary を実装**

`src/utils/text.js` の末尾に追加:

```javascript
/**
 * 辞書テキストをパースして置換ルール配列に変換する
 * @param {string} text - 辞書テキスト（1行に1ルール、`→`区切り）
 * @returns {Array<{from: string, to: string}>} 置換ルール配列
 */
export function parseDictionaryRules(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('→');
      if (idx === -1) return null;
      return { from: line.slice(0, idx), to: line.slice(idx + 1) };
    })
    .filter(Boolean);
}

/**
 * 置換ルールをテキストに適用する
 * @param {string} text - 対象テキスト
 * @param {Array<{from: string, to: string}>} rules - 置換ルール配列
 * @returns {string} 置換後のテキスト
 */
export function applyDictionary(text, rules) {
  for (const rule of rules) {
    text = text.replaceAll(rule.from, rule.to);
  }
  return text;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run test/utils/text.test.js`
Expected: ALL PASS

- [ ] **Step 5: コミット**

```bash
git add src/utils/text.js test/utils/text.test.js
git commit -m "feat: 辞書ユーティリティ（parseDictionaryRules/applyDictionary）を追加"
```

---

### Task 2: MockSpeechRecognition を更新 (test/setup.js)

**Files:**
- Modify: `test/setup.js`

- [ ] **Step 1: モックを更新**

`test/setup.js` の `MockSpeechRecognition` クラスを以下に差し替え:

```javascript
class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.processLocally = undefined;
    this.phrases = [];
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
  }
  start() {}
  stop() {}
}
```

コンストラクタ呼び出しを追跡するため、`global.webkitSpeechRecognition` の設定を変更:

```javascript
global.webkitSpeechRecognition = vi.fn().mockImplementation(() => new MockSpeechRecognition());
global.SpeechRecognition = global.webkitSpeechRecognition;
```

`beforeEach` にモックリセットを追加:

```javascript
beforeEach(() => {
  vi.clearAllMocks();

  // Reset all Chrome API mocks with default return values
  mockStorage.sync.get.mockResolvedValue({});
  mockStorage.sync.set.mockResolvedValue(undefined);
  mockTabs.query.mockResolvedValue([]);
  mockTabs.sendMessage.mockResolvedValue({});
  mockAction.setBadgeText.mockResolvedValue(undefined);
  mockAction.setBadgeBackgroundColor.mockResolvedValue(undefined);
  mockNotifications.create.mockResolvedValue('');
  mockScripting.executeScript.mockResolvedValue([]);
  mockRuntime.sendMessage.mockResolvedValue(undefined);

  // Reset SpeechRecognition constructor tracking
  global.webkitSpeechRecognition.mockClear();
});
```

- [ ] **Step 2: 既存テストが通ることを確認**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: コミット**

```bash
git add test/setup.js
git commit -m "test: MockSpeechRecognition に processLocally/phrases を追加"
```

---

### Task 3: 設定UI追加 (options.html)

**Files:**
- Modify: `options.html`

- [ ] **Step 1: 新設定項目を options.html に追加**

`options.html` の `</div>` (language の form-group の直後) と `<button id="save">` の間に以下を挿入:

```html
  <div class="form-group">
    <label>
      <input type="checkbox" id="useLocalModel">
      オンデバイスモデルを使用（Chrome 138+）
    </label>
    <div class="hint">音声をローカルで処理します。初回はモデルのダウンロードが必要です</div>
  </div>

  <div class="form-group">
    <label for="boostPhrases">ワードブースト</label>
    <textarea id="boostPhrases" rows="3" placeholder="例: 配信名、よく使う言葉"></textarea>
    <div class="hint">認識優先度を上げたい言葉を1行に1つ入力（オンデバイスモデル使用時のみ有効）</div>
  </div>

  <div class="form-group">
    <label for="dictionary">カスタム辞書</label>
    <textarea id="dictionary" rows="5" placeholder="例:&#10;にしむら→西村&#10;じまく→字幕"></textarea>
    <div class="hint">誤認識→正しい表記 の形式で1行に1つ入力してください</div>
  </div>
```

また、`<style>` に textarea 用のスタイルを追加:

```css
textarea {
  width: 100%;
  padding: 8px;
  font-size: 14px;
  box-sizing: border-box;
  resize: vertical;
}
```

- [ ] **Step 2: コミット**

```bash
git add options.html
git commit -m "feat: 設定画面にオンデバイス・ワードブースト・辞書のUIを追加"
```

---

### Task 4: 設定ロジック更新 (options.js)

**Files:**
- Modify: `src/options.js`
- Modify: `test/options.test.js`

- [ ] **Step 1: 新設定の loadSettings テストを追加**

`test/options.test.js` の `describe('loadSettings')` に追加。`beforeEach` の DOM 構築に新しい要素を含める:

```javascript
beforeEach(() => {
  document.body.innerHTML = `
    <input type="checkbox" id="autoPost" />
    <input type="text" id="language" />
    <input type="checkbox" id="useLocalModel" />
    <textarea id="boostPhrases"></textarea>
    <textarea id="dictionary"></textarea>
    <div id="status"></div>
    <button id="save">保存</button>
  `;
  autoPostCheckbox = document.getElementById('autoPost');
  languageInput = document.getElementById('language');
  statusElement = document.getElementById('status');

  vi.clearAllMocks();
  vi.useFakeTimers();
});
```

新しいテストケースを `describe('loadSettings')` に追加:

```javascript
it('新設定をデフォルト値で読み込む', async () => {
  chrome.storage.sync.get.mockResolvedValue({
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: ''
  });

  await loadSettings();

  expect(document.getElementById('useLocalModel').checked).toBe(false);
  expect(document.getElementById('boostPhrases').value).toBe('');
  expect(document.getElementById('dictionary').value).toBe('');
});

it('新設定を保存済み値で読み込む', async () => {
  chrome.storage.sync.get.mockResolvedValue({
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: true,
    boostPhrases: ['配信', 'コメント'],
    dictionary: 'にしむら→西村'
  });

  await loadSettings();

  expect(document.getElementById('useLocalModel').checked).toBe(true);
  expect(document.getElementById('boostPhrases').value).toBe('配信\nコメント');
  expect(document.getElementById('dictionary').value).toBe('にしむら→西村');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run test/options.test.js`
Expected: FAIL — loadSettings does not handle new fields

- [ ] **Step 3: options.js の DEFAULT_SETTINGS と loadSettings を更新**

`src/options.js`:

```javascript
const DEFAULT_SETTINGS = {
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: ''
};

export async function loadSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('autoPost').checked = result.autoPost;
  document.getElementById('language').value = result.language;
  document.getElementById('useLocalModel').checked = result.useLocalModel;
  document.getElementById('boostPhrases').value = result.boostPhrases.join('\n');
  document.getElementById('dictionary').value = result.dictionary;
  return result;
}
```

- [ ] **Step 4: テストを実行して loadSettings が通ることを確認**

Run: `npx vitest run test/options.test.js`
Expected: loadSettings tests PASS, saveSettings tests FAIL (new fields not saved)

- [ ] **Step 5: saveSettings のテストを追加**

`test/options.test.js` の `describe('saveSettings')` に追加:

```javascript
it('新設定を保存する', async () => {
  autoPostCheckbox.checked = true;
  languageInput.value = 'ja-JP';
  document.getElementById('useLocalModel').checked = true;
  document.getElementById('boostPhrases').value = '配信\nコメント';
  document.getElementById('dictionary').value = 'にしむら→西村';
  chrome.tabs.query.mockResolvedValue([]);

  const result = await saveSettings();

  expect(chrome.storage.sync.set).toHaveBeenCalledWith({
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: true,
    boostPhrases: ['配信', 'コメント'],
    dictionary: 'にしむら→西村'
  });
});

it('boostPhrasesの空行を除外して保存する', async () => {
  autoPostCheckbox.checked = true;
  languageInput.value = 'ja-JP';
  document.getElementById('boostPhrases').value = '配信\n\nコメント\n';
  chrome.tabs.query.mockResolvedValue([]);

  const result = await saveSettings();

  expect(chrome.storage.sync.set).toHaveBeenCalledWith(
    expect.objectContaining({ boostPhrases: ['配信', 'コメント'] })
  );
});
```

- [ ] **Step 6: テストを実行して失敗を確認**

Run: `npx vitest run test/options.test.js`
Expected: new saveSettings tests FAIL

- [ ] **Step 7: saveSettings を更新**

`src/options.js`:

```javascript
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

  const tabs = await chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://studio.youtube.com/*'] });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(() => {});
  });

  const status = document.getElementById('status');
  status.textContent = '保存しました';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);

  return { autoPost, language, useLocalModel, boostPhrases, dictionary };
}
```

- [ ] **Step 8: テストを実行して全て通ることを確認**

Run: `npx vitest run test/options.test.js`
Expected: ALL PASS

- [ ] **Step 9: コミット**

```bash
git add src/options.js test/options.test.js
git commit -m "feat: オンデバイス・ワードブースト・辞書の設定保存・読み込みを実装"
```

---

### Task 5: content.js デュアルバッファリング実装

**Files:**
- Rewrite: `src/content.js`

これが最大の変更。content.js を完全に書き換える。

- [ ] **Step 1: content.js を書き換え**

`src/content.js` の全体を以下に差し替え:

```javascript
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// テキストをトリムし、連続する空白を1つにまとめる
function trimText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.trim().replace(/\s+/g, ' ');
}

// 辞書テキストをパースして置換ルール配列に変換する
function parseDictionaryRules(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('→');
      if (idx === -1) return null;
      return { from: line.slice(0, idx), to: line.slice(idx + 1) };
    })
    .filter(Boolean);
}

// 置換ルールをテキストに適用する
function applyDictionary(text, rules) {
  for (const rule of rules) {
    text = text.replaceAll(rule.from, rule.to);
  }
  return text;
}

// デュアルバッファリング状態
const recognitions = [null, null];
let activeIndex = 0;
let nextPreStarted = false;
let isActive = false;
let isInitialStart = true;
let settings = {
  autoPost: true,
  language: 'ja-JP',
  useLocalModel: false,
  boostPhrases: [],
  dictionary: ''
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
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: ''
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

// 認識インスタンスをセットアップ
function setupRecognitionInstance(index) {
  const rec = new SpeechRecognition();

  rec.lang = settings.language;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  // オンデバイスモデル（Chrome 138+）
  if (settings.useLocalModel && 'processLocally' in rec) {
    rec.processLocally = true;
  }

  // ワードブースト（Chrome 138+, オンデバイスのみ）
  if (settings.useLocalModel && typeof SpeechRecognitionPhrase !== 'undefined' && settings.boostPhrases.length > 0) {
    rec.phrases = settings.boostPhrases.map(p => new SpeechRecognitionPhrase(p, 10.0));
  }

  rec.onstart = () => {
    if (isInitialStart) {
      isActive = true;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      console.log('[Voice Live Comment] 音声認識を開始しました');
      isInitialStart = false;
    }
  };

  rec.onresult = (event) => {
    let finalText = '';
    let hasFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
        hasFinal = true;
      }
    }
    if (finalText) {
      inputAndSubmit(finalText);
    }
    // アクティブインスタンスの最終結果で次を先行起動
    if (hasFinal && index === activeIndex) {
      preStartNextInstance();
    }
  };

  rec.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      sendError('マイクへのアクセスが拒否されました');
      stopRecognition(true);
      return;
    }
  };

  rec.onend = () => {
    if (!isActive) return;

    if (index === activeIndex) {
      // アクティブインスタンス終了 → 次に切り替え
      activeIndex = (index + 1) % 2;
      nextPreStarted = false;
      // 次がまだ起動していなければフォールバック起動
      if (!recognitions[activeIndex]) {
        startInstance(activeIndex);
      }
    } else {
      // 先行起動したインスタンスが予期せず終了 → 再起動
      recognitions[index] = null;
    }
  };

  recognitions[index] = rec;
  return rec;
}

// 指定インデックスのインスタンスを起動
function startInstance(index) {
  if (recognitions[index]) {
    try { recognitions[index].stop(); } catch (e) {}
    recognitions[index] = null;
  }
  const rec = setupRecognitionInstance(index);
  rec.start();
}

// 次インスタンスを先行起動
function preStartNextInstance() {
  if (nextPreStarted) return;
  nextPreStarted = true;
  const nextIndex = (activeIndex + 1) % 2;
  startInstance(nextIndex);
}

// 音声認識を開始
function startRecognition() {
  if (!SpeechRecognition) {
    sendError('このブラウザは音声認識に対応していません');
    return;
  }

  loadSettings().then(() => {
    activeIndex = 0;
    nextPreStarted = false;
    startInstance(0);
  });
}

// 音声認識を停止
function stopRecognition(keepErrorBadge = false) {
  isActive = false;
  isInitialStart = true;
  nextPreStarted = false;

  for (let i = 0; i < 2; i++) {
    if (recognitions[i]) {
      try { recognitions[i].stop(); } catch (e) {}
      recognitions[i] = null;
    }
  }

  if (!keepErrorBadge) {
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: false });
  }
  console.log('[Voice Live Comment] 音声認識を停止しました');
}

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
```

- [ ] **Step 2: content.test.js を更新**

`test/content.test.js` を以下に書き換え:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('content.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('onMessage handler', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      vi.clearAllMocks();
    });

    it('TOGGLE_RECOGNITIONでstart/stopを切り替える', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ isActive: false });
    });

    it('SETTINGS_UPDATEDで設定を再読み込み', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: false,
        language: 'en-US',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });

    it('デュアルバッファリング: 開始時にインスタンスを1つ作成', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      // 少し待ってコンストラクタ呼び出しを確認
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(global.webkitSpeechRecognition).toHaveBeenCalled();
    });

    it('連続切替: 開始→停止→開始が動作する', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 停止
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 再開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sendResponse).toHaveBeenCalledTimes(3);
    });
  });
});
```

- [ ] **Step 3: 全テストを実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: コミット**

```bash
git add src/content.js test/content.test.js
git commit -m "feat: デュアルバッファリング音声認識 + オンデバイス + ワードブースト + カスタム辞書を実装"
```

---

### Task 6: 既存テストの修正と最終確認

**Files:**
- Possibly modify: `test/options.test.js` (fix existing tests for new saveSettings signature)

- [ ] **Step 1: 既存の saveSettings テストが新しい set 呼び出し形式に合うか確認**

`test/options.test.js` の `describe('saveSettings')` 内の既存テストの `toHaveBeenCalledWith` を、新しいフィールドを含む形式に更新:

```javascript
it('設定を保存する', async () => {
  autoPostCheckbox.checked = true;
  languageInput.value = 'en-US';
  chrome.tabs.query.mockResolvedValue([]);

  const result = await saveSettings();

  expect(chrome.storage.sync.set).toHaveBeenCalledWith({
    autoPost: true,
    language: 'en-US',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: ''
  });
});

it('空の言語はデフォルト値にする', async () => {
  autoPostCheckbox.checked = true;
  languageInput.value = '   ';
  chrome.tabs.query.mockResolvedValue([]);

  const result = await saveSettings();

  expect(chrome.storage.sync.set).toHaveBeenCalledWith({
    autoPost: true,
    language: 'ja-JP',
    useLocalModel: false,
    boostPhrases: [],
    dictionary: ''
  });
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
```

- [ ] **Step 2: 全テストを実行**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: コミット**

```bash
git add test/options.test.js
git commit -m "test: 既存テストを新設定項目に対応"
```
