# Voice Live Comment

音声認識でYouTube Liveのチャットにコメントを投稿するChrome拡張機能です。

## 機能

- 音声をテキストに変換してYouTube Liveチャットに投稿
- YouTube Live（視聴側）とYouTube Studio（配信者側）の両方に対応
- アイコンクリックで音声認識のON/OFFを切り替え
- 認識状態をバッジで表示（● 緑 = 認識中、✕ 赤 = エラー）
- 自動投稿 / 手動確認の切り替え
- 音声認識の言語設定（日本語、英語、韓国語、中国語など）
- STTプロバイダー切り替え（ブラウザ標準 / Google Cloud STT）
- VADによる音声区間検出で外部APIのコストを削減

## 動作環境

- Google Chrome（Manifest V3対応ブラウザ）
- 対応ページ
  - YouTube Live（`youtube.com/live/*`、`youtube.com/watch*`）
  - YouTube Studio（`studio.youtube.com/*`）

## インストール

1. このリポジトリをクローンまたはダウンロード
   ```bash
   git clone https://github.com/mizucopo/voice-live-comment.git
   ```
2. 依存パッケージをインストールしてビルド
   ```bash
   npm install
   npm run build
   ```
3. Chromeで `chrome://extensions/` を開く
4. 右上の「デベロッパーモード」をONにする
5. 「パッケージ化されていない拡張機能を読み込む」をクリック
6. リポジトリのフォルダを選択

## 使い方

1. YouTube Live配信ページまたはYouTube Studioを開く
2. ツールバーの拡張機能アイコンをクリックして音声認識を開始
3. マイクに向かって話すと、テキストがチャット入力欄に入力され自動で投稿される
4. もう一度アイコンをクリックすると停止

### バッジ状態

| 状態 | バッジ | 色 |
|------|--------|-----|
| 停止中 | （なし） | グレー |
| 認識中 | ● | 緑 |
| エラー | ✕ | 赤 |

## 設定

ツールバーの拡張機能アイコンを右クリック > 「オプション」で設定画面を開けます。

| 設定項目 | デフォルト | 説明 |
|---------|-----------|------|
| 自動投稿する | ON | ONの場合は認識テキストを即座に送信、OFFの場合は入力欄に入れるのみ |
| 言語コード | ja-JP | 音声認識の言語（例: `en-US`, `ko-KR`, `zh-CN`） |
| STTプロバイダー | ブラウザ標準 | 音声認識エンジンの選択（ブラウザ標準 / Google Cloud STT） |
| Google APIキー | （なし） | Google Cloud STT使用時のAPIキー |

## 開発

開発に貢献したい方は [CONTRIBUTING.md](./CONTRIBUTING.md) をご覧ください。

## ライセンス

MIT License
