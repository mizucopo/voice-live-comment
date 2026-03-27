# テストコード追加 設計ドキュメント

> **作成日:** 2026-03-28

## 目標

Voice Live Comment（Chrome拡張機能）にVitestを使用したテストコードを追加する。リファクタリングでテスト可能な構造にした後、単体テストと統合テスト（Chrome APIモック使用）を実装する。

---

## 1. プロジェクト構造

```
f01/
├── src/
│   ├── utils/
│   │   ├── url.js         # isTargetPage関数
│   │   └── text.js        # trimText関数
│   ├── background.js      # Service Worker（リファクタリング）
│   ├── content.js         # コンテンツスクリプト（リファクタリング）
│   └── options.js         # 設定画面（リファクタリング）
├── test/
│   ├── setup.js           # テスト共通セットアップ
│   ├── utils/
│   │   ├── url.test.js
│   │   └── text.test.js
│   ├── background.test.js
│   ├── content.test.js
│   └── options.test.js
├── vitest.config.js
├── package.json
└── manifest.json          # パスをsrc/に更新
```

## 2. リファクタリング方針

### 抽出する純粋関数

**src/utils/url.js**
```javascript
export function isTargetPage(url) {
  return url.includes('youtube.com/watch') ||
         url.includes('youtube.com/live') ||
         url.includes('studio.youtube.com');
}
```

**src/utils/text.js**
```javascript
export function trimText(text) {
  return text.trim().replace(/\s+/g, ' ');
}
```

### 既存ファイルの変更

- グローバル変数は維持（Chrome拡張の仕様上必要）
- 純粋関数をimportして使用
- テスト用に必要な関数をexport

### manifest.jsonの更新

- `background.js` → `src/background.js`
- `content.js` → `src/content.js`

## 3. テスト構成

### 使用ライブラリ

- `vitest` - テストランナー
- `@vitest/coverage-v8` - カバレッジ計測
- `jsdom` - DOM環境

### vitest.config.js

```javascript
export default {
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html']
    }
  }
}
```

### test/setup.js

Chrome APIのグローバルモックを設定：

```javascript
import { vi } from 'vitest';

global.chrome = {
  storage: {
    sync: {
      get: vi.fn(),
      set: vi.fn()
    }
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn()
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn()
  },
  notifications: {
    create: vi.fn()
  },
  scripting: {
    executeScript: vi.fn()
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    }
  }
};
```

## 4. モック戦略

### Chrome API モック

- `chrome.storage.sync` - 設定の読み書き
- `chrome.tabs` - タブ操作
- `chrome.action` - バッジ更新
- `chrome.notifications` - 通知表示
- `chrome.scripting` - スクリプト注入
- `chrome.runtime` - メッセージング

### Web API モック

- `SpeechRecognition` - コンストラクタとイベントハンドラをモック
- `document` - jsdomが提供

## 5. テストケース一覧

### src/utils/url.test.js

- `isTargetPage()` - YouTube/watch URL → true
- `isTargetPage()` - YouTube/live URL → true
- `isTargetPage()` - YouTube Studio URL → true
- `isTargetPage()` - その他のURL → false

### src/utils/text.test.js

- `trimText()` - 前後のスペース除去
- `trimText()` - 連続スペースを1つに
- `trimText()` - 空文字の処理
- `trimText()` - スペースのみの処理

### src/background.test.js

- `isTargetPage()` の各パターン
- `updateBadge()` - アクティブ時のバッジ設定
- `updateBadge()` - 非アクティブ時のバッジクリア
- `setBadgeError()` - エラーバッジ設定
- メッセージ受信: `UPDATE_BADGE`
- メッセージ受信: `SHOW_ERROR`

### src/content.test.js

- `findChatInput()` - yt-live-chat-text-input-field-renderer
- `findChatInput()` - tp-yt-paper-input
- `findChatInput()` - YouTube視聴側
- `findChatInput()` - 見つからない場合
- `findSendButton()` - 各種セレクタ
- `inputAndSubmit()` - トリム処理の適用
- `inputAndSubmit()` - 空文字は送信しない
- `inputAndSubmit()` - contenteditableへの入力
- `inputAndSubmit()` - INPUT要素への入力
- `inputAndSubmit()` - 送信ボタンクリック

### src/options.test.js

- `loadSettings()` - デフォルト値で読み込み
- `loadSettings()` - 保存済み値で読み込み
- `saveSettings()` - 設定保存
- `saveSettings()` - 空言語はデフォルト値

---

## 成功基準

- 全テストがパスする
- カバレッジ80%以上
- 既存機能が動作する（リグレッションなし）
