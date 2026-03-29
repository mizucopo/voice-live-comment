# オンデバイスモデル使用時の音声入力不能バグ修正 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `processLocally = true`で音声認識が開始できないバグを修正し、自動的にクラウド認識へフォールバックする

**Architecture:** 診断結果に基づき、`processLocally = true`での`not-allowed`エラーを検知した場合、自動的にクラウド認識（`processLocally`なし）へフォールバックする。3秒タイムアウトでゾンビ状態も検知する。

**Tech Stack:** Chrome Extension (Manifest V3), Web Speech API, Vitest

---

### Task 1: テストセットアップの更新（`test/setup.js`）

**Files:**
- Modify: `test/setup.js`

- [ ] **Step 1: MockSpeechRecognitionにインスタンス追跡とstart()例外機能を追加**

`test/setup.js`の MockSpeechRecognition を以下に差し替える:

```javascript
// SpeechRecognition モック
const mockInstances = [];

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
    mockInstances.push(this);
  }
  start() {
    if (MockSpeechRecognition._startShouldThrow) {
      const error = MockSpeechRecognition._startShouldThrow;
      MockSpeechRecognition._startShouldThrow = null;
      throw error;
    }
  }
  stop() {}
}

MockSpeechRecognition._instances = mockInstances;
MockSpeechRecognition._startShouldThrow = null;

global.MockSpeechRecognition = MockSpeechRecognition;
global.webkitSpeechRecognition = vi.fn().mockImplementation(() => new MockSpeechRecognition());
global.SpeechRecognition = global.webkitSpeechRecognition;
```

`beforeEach`のリセット処理に以下を追加（`global.webkitSpeechRecognition.mockClear();`の後）:

```javascript
  // Reset instance tracking
  mockInstances.length = 0;
  MockSpeechRecognition._startShouldThrow = null;
```

- [ ] **Step 2: 既存テストが通ることを確認**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 3: コミット**

```bash
git add test/setup.js
git commit -m "test: MockSpeechRecognitionにインスタンス追跡とstart()例外機能を追加"
```

---

### Task 2: 新規状態変数と`fallbackToCloud()`関数の追加

**Files:**
- Modify: `src/content.js`

- [ ] **Step 1: 状態変数を追加**

`src/content.js`の49行目（`let parsedRules = [];`の直後）に追加:

```javascript
let hasFallbackFromLocal = false;
let startTimeoutId = null;
```

- [ ] **Step 2: `fallbackToCloud()`関数を追加**

`src/content.js`の`sendError`関数の直後（169行目の直後）に追加:

```javascript
// processLocally失敗時にクラウド認識へフォールバック
function fallbackToCloud(index, reason) {
  if (hasFallbackFromLocal) return;
  hasFallbackFromLocal = true;

  console.warn('[Voice Live Comment] オンデバイス認識が利用できないため、クラウド認識に切り替えます:', reason);
  sendError('オンデバイス認識が利用できないため、クラウド認識に切り替えました');

  settings.useLocalModel = false;
  activeIndex = 0;
  nextPreStarted = false;
  startInstance(0);
}
```

- [ ] **Step 3: 既存テストが通ることを確認**

Run: `npx vitest run`
Expected: 全テストPASS（まだ新規関数は使われていないため）

- [ ] **Step 4: コミット**

```bash
git add src/content.js
git commit -m "feat: hasFallbackFromLocal変数とfallbackToCloud()関数を追加"
```

---

### Task 3: `onerror`ハンドラのフォールバック対応

**Files:**
- Modify: `src/content.js:217-223`
- Modify: `test/content.test.js`

- [ ] **Step 1: フォールバックのテストを追加**

`test/content.test.js`の`describe('onMessage handler')`内に新しいテストを追加:

```javascript
    it('processLocally=trueでnot-allowedエラー時にクラウド認識へフォールバック', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));

      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBeGreaterThanOrEqual(1);
      expect(instances[0].processLocally).toBe(true);

      // not-allowedエラーをシミュレート
      instances[0].onerror({ error: 'not-allowed' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバックで新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(instances[1].processLocally).not.toBe(true);

      // エラー通知が送信される
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR', message: expect.stringContaining('クラウド') })
      );
    });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/content.test.js`
Expected: FAIL（まだフォールバック実装がないため）

- [ ] **Step 3: `onerror`ハンドラを更新**

`src/content.js`の`onerror`ハンドラ（217-223行目）を以下に差し替え:

```javascript
  rec.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      if (settings.useLocalModel) {
        fallbackToCloud(index, event.error);
        return;
      }
      sendError('マイクへのアクセスが拒否されました');
      stopRecognition(true);
      return;
    }
    console.warn('[Voice Live Comment] 認識エラー:', event.error);
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/content.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/content.js test/content.test.js
git commit -m "feat: onerrorハンドラでprocessLocally失敗時にクラウド認識へフォールバック"
```

---

### Task 4: `startInstance()`のtry-catch対応

**Files:**
- Modify: `src/content.js:248-256`
- Modify: `test/content.test.js`

- [ ] **Step 1: start()例外時のテストを追加**

`test/content.test.js`に追加:

```javascript
    it('processLocally=trueでstart()が例外を投げた場合クラウド認識へフォールバック', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });

      // 最初のstart()呼び出しで例外を投げる
      global.MockSpeechRecognition._startShouldThrow = new Error('start failed');

      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック確認: 2つ以上のインスタンスが作成されている
      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBeGreaterThanOrEqual(2);

      // エラー通知が送信される
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR' })
      );
    });
```

注意: このテストでは`setup.js`の`MockSpeechRecognition._startShouldThrow`を使用。最初の`start()`呼び出しのみ例外を投げ、2回目（フォールバック後）は成功する。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/content.test.js`
Expected: FAIL

- [ ] **Step 3: `startInstance()`にtry-catchを追加**

`src/content.js`の`startInstance`関数（248-256行目）を以下に差し替え:

```javascript
function startInstance(index) {
  if (recognitions[index]) {
    try { recognitions[index].stop(); } catch (e) {}
    recognitions[index] = null;
  }
  const rec = setupRecognitionInstance(index);
  try {
    rec.start();
    // onstart発火のタイムアウト監視（3秒）
    clearTimeout(startTimeoutId);
    startTimeoutId = setTimeout(() => {
      if (settings.useLocalModel) {
        console.warn('[Voice Live Comment] 認識開始タイムアウト');
        fallbackToCloud(index, 'timeout');
      }
    }, 3000);
  } catch (e) {
    console.error('[Voice Live Comment] start()例外:', e);
    if (settings.useLocalModel) {
      fallbackToCloud(index, e.message);
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/content.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/content.js test/content.test.js
git commit -m "feat: startInstance()にtry-catchとタイムアウト監視を追加"
```

---

### Task 5: `onstart`ハンドラのタイムアウトクリア対応

**Files:**
- Modify: `src/content.js:190-197`
- Modify: `test/content.test.js`

- [ ] **Step 1: タイムアウトのテストを追加**

`test/content.test.js`に追加:

```javascript
    it('processLocally=trueでonstartが発火しない場合タイムアウトでフォールバック', async () => {
      vi.useFakeTimers();
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await vi.advanceTimersByTimeAsync(10);

      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBe(1);

      // 3秒経過（タイムアウト発火）
      await vi.advanceTimersByTimeAsync(3000);

      // フォールバック確認
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(instances[1].processLocally).not.toBe(true);

      vi.useRealTimers();
    });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/content.test.js`
Expected: FAIL（onstartがclearTimeoutを呼ぶため、実際はタイムアウトがクリアされず動く可能性があるが、MockSpeechRecognitionのstart()はonstartを発火させないため、そのままタイムアウトが発火するはず）

注意: 現在の`MockSpeechRecognition.start()`は`onstart`を発火させない。そのため、`onstart`が呼ばれずタイムアウトが発火する。`onstart`ハンドラで`clearTimeout`を呼ぶ修正は、本番コードで`rec.start()`が成功して`onstart`が発火した場合にタイムアウトをクリアするために必要。

- [ ] **Step 3: `onstart`ハンドラにclearTimeoutを追加**

`src/content.js`の`onstart`ハンドラ（190-197行目）を以下に差し替え:

```javascript
  rec.onstart = () => {
    clearTimeout(startTimeoutId);
    if (isInitialStart) {
      isActive = true;
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', isActive: true });
      console.log('[Voice Live Comment] 音声認識を開始しました');
      isInitialStart = false;
    }
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run test/content.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/content.js test/content.test.js
git commit -m "feat: onstartハンドラでタイムアウトをクリア"
```

---

### Task 6: `stopRecognition()`と`SETTINGS_UPDATED`のクリーンアップ対応

**Files:**
- Modify: `src/content.js:280-297`（stopRecognition）
- Modify: `src/content.js:309-315`（SETTINGS_UPDATED handler）
- Modify: `test/content.test.js`

- [ ] **Step 1: クリーンアップのテストを追加**

`test/content.test.js`に追加:

```javascript
    it('フォールバック後に停止→再開でフォールバックがリセットされる', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック発生
      const instances = global.MockSpeechRecognition._instances;
      instances[0].onerror({ error: 'not-allowed' });
      await new Promise(resolve => setTimeout(resolve, 10));

      const instanceCountAfterFallback = instances.length;
      expect(instanceCountAfterFallback).toBeGreaterThanOrEqual(2);

      // 停止
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 再開（フォールバックフラグがリセットされているため再度フォールバック可能）
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThan(instanceCountAfterFallback);
    });

    it('SETTINGS_UPDATEDでフォールバックフラグがリセットされる', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());
      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック発生
      const instances = global.MockSpeechRecognition._instances;
      instances[0].onerror({ error: 'not-allowed' });
      await new Promise(resolve => setTimeout(resolve, 10));

      const instanceCountAfterFallback = instances.length;

      // 設定更新（useLocalModelをtrueのまま）
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());
      await new Promise(resolve => setTimeout(resolve, 50));

      // 設定更新後、再起動により新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThan(instanceCountAfterFallback);
    });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run test/content.test.js`
Expected: FAIL（`stopRecognition()`が`hasFallbackFromLocal`をリセットしていないため）

- [ ] **Step 3: `stopRecognition()`を更新**

`src/content.js`の`stopRecognition`関数（280-297行目）を以下に差し替え:

```javascript
function stopRecognition(keepErrorBadge = false) {
  isActive = false;
  isInitialStart = true;
  nextPreStarted = false;
  hasFallbackFromLocal = false;
  clearTimeout(startTimeoutId);

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
```

- [ ] **Step 4: `SETTINGS_UPDATED`ハンドラを更新**

`src/content.js`の`SETTINGS_UPDATED`ハンドラ（309-315行目付近）を以下に差し替え:

```javascript
    } else if (message.type === 'SETTINGS_UPDATED') {
      loadSettings().then(() => {
        hasFallbackFromLocal = false;
        if (isActive) {
          stopRecognition();
          startRecognition();
        }
      });
    }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run test/content.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/content.js test/content.test.js
git commit -m "feat: stopRecognitionとSETTINGS_UPDATEDでフォールバックフラグをリセット"
```

---

### Task 7: 最終検証

- [ ] **Step 1: 全テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 2: テストカバレッジを確認**

Run: `npx vitest run --coverage`
Expected: content.jsのカバレッジが80%以上

- [ ] **Step 3: 最終コミット（必要な場合のみ）**

変更があればコミット。なければスキップ。
