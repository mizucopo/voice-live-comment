# YouTube Live 音声コメント拡張機能 設計書

## 概要

Chrome拡張機能で、音声認識したテキストをYouTube Liveのチャットに自動投稿する。

## 要件

- YouTube Live（視聴側）とYouTube Studio（配信者側）で動作
- アイコンクリックで音声認識ON/OFF
- 設定画面で「自動投稿/確認待ち」と「言語」を設定
- 認識中はアイコンバッジで状態表示
- エラー時はバッジ＋通知で知らせる

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                         │
├─────────────────┬─────────────────┬─────────────────────────┤
│  Background     │  Content Script │  Options Page           │
│  (Service       │  (YouTube Pages)│  (設定画面)              │
│   Worker)       │                 │                         │
├─────────────────┼─────────────────┼─────────────────────────┤
│ ・アイコン      │ ・音声認識      │ ・投稿モード設定         │
│  クリック処理   │ ・チャット入力  │ ・言語設定               │
│ ・バッジ制御    │ ・DOM監視       │                         │
│ ・通知表示      │ ・メッセージ    │                         │
│ ・設定読み書き  │  受信/送信      │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
         │                │                    │
         └────────────────┴────────────────────┘
                          │
                  chrome.storage.sync
                     (設定保存)
```

## ファイル構成

```
voice-live-comment/
├── manifest.json           # 拡張機能定義
├── background.js           # Service Worker
├── content.js              # YouTubeページ用スクリプト
├── options.html            # 設定画面
├── options.js              # 設定画面ロジック
└── icons/                  # 拡張機能アイコン
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## データフロー

```
[ユーザーがアイコンクリック]
         │
         ▼
┌─────────────────────┐
│   background.js     │
│ ・状態をトグル      │
│ ・バッジ更新        │
│ ・content.jsへ送信  │
└─────────┬───────────┘
          │ chrome.tabs.sendMessage
          ▼
┌─────────────────────┐
│    content.js       │
│ ・ON: 音声認識開始  │
│ ・OFF: 音声認識停止 │
└─────────┬───────────┘
          │ 音声認識結果
          ▼
┌─────────────────────┐
│  YouTube チャット   │
│ ・入力欄にテキスト  │
│ ・自動投稿または    │
│   確認待ち          │
└─────────────────────┘
```

## 設定項目

```typescript
interface Settings {
  autoPost: boolean;      // true: 即時投稿 / false: 確認待ち
  language: string;       // "ja-JP" | "en-US" など
}
```

### デフォルト値

```json
{
  "autoPost": true,
  "language": "ja-JP"
}
```

### 設定画面 (options.html)

- [x] 自動投稿する（チェックボックス）
- 言語コード: テキストボックス（placeholder: "例: ja-JP, en-US, ko-KR, zh-CN"）

## エラーハンドリング

| エラー種別 | バッジ | 通知 | 回復方法 |
|-----------|--------|------|----------|
| マイク権限なし | `❌` | 「マイクへのアクセスが拒否されました」 | 権限を許可して再クリック |
| チャット入力欄なし | `❌` | 「チャット入力欄が見つかりません」 | ライブ配信ページで再試行 |
| 音声認識エラー | `⚠` | （なし、ログのみ） | 自動再試行 |

## 状態バッジ一覧

| 状態 | バッジ | 色 |
|------|--------|-----|
| 停止中 | （なし） | グレー |
| 認識中 | `●` | 緑 |
| エラー | `❌` | 赤 |

## 実装のポイント

### Content Script (content.js)

- `SpeechRecognition` API で連続認識（`continuous: true`, `interimResults: true`）
- チャット入力欄のセレクタ検出（YouTubeとYouTube Studioで異なる）
- 認識確定時 → 入力欄にテキスト追加 → `autoPost` ならEnter送信

### Background (background.js)

- アイコンクリック → `chrome.tabs.sendMessage` で content.js に指示
- `chrome.action.setBadgeText` / `setBadgeBackgroundColor` で状態表示
- `chrome.notifications.create` でエラー通知

### チャット入力欄のセレクタ

```
YouTube視聴側: #chat #input, [contenteditable="true"]
YouTube Studio: #input-container [contenteditable="true"]
```

※ 実際はDOM構造を確認して調整

## 対象ページ

- `*://www.youtube.com/live/*`
- `*://www.youtube.com/watch?v=*`（ライブ配信中のみ動作）
- `*://studio.youtube.com/*`（ライブ配信画面）
