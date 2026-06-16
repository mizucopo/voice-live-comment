# Voice Live Comment

音声認識でYouTube Liveのチャットにコメントを入力・投稿するChrome拡張機能です。
視聴ページとYouTube Studioの両方で使えます。

## 主な機能

- 拡張機能アイコンから音声認識を開始・停止
- 話した内容をテキスト化してYouTube Liveチャット欄へ入力
- 自動投稿と手動確認を切り替え
- 日本語、英語、韓国語、中国語などの言語設定
- ブラウザ標準STTとGoogle Cloud STTを切り替え
- 音声区間検出（VAD）で外部APIのコストを削減

## 動作環境

- Google Chrome（Manifest V3対応ブラウザ）

### 対応ページ

| ページ | URL |
|--------|-----|
| YouTube Live | `youtube.com/live/*`、`youtube.com/watch*` |
| YouTube Studio | `studio.youtube.com/*` |

## インストール

1. リポジトリをクローンまたはダウンロードします。
   ```bash
   git clone https://github.com/mizucopo/voice-live-comment.git
   ```
2. 依存パッケージをインストールしてビルドします。
   ```bash
   npm install
   npm run build
   ```
3. Chromeで `chrome://extensions/` を開きます。
4. 右上の「デベロッパーモード」をONにします。
5. 「パッケージ化されていない拡張機能を読み込む」をクリックします。
6. リポジトリのフォルダを選択します。

## 使い方

1. YouTube Live配信ページまたはYouTube Studioを開きます。
2. ツールバーの拡張機能アイコンをクリックして音声認識を開始します。
3. マイクに向かって話すと、認識テキストがチャット入力欄に入ります。
4. 自動投稿がONの場合は、そのままチャットに投稿されます。
5. もう一度アイコンをクリックすると音声認識を停止します。

### バッジ状態

| 状態 | バッジ | 色 |
|------|--------|-----|
| 停止中 | （なし） | グレー |
| 認識中 | ● | 緑 |
| エラー | ✕ | 赤 |

## 設定

ツールバーの拡張機能アイコンを右クリックし、「オプション」から設定画面を開きます。

| 設定項目 | デフォルト | 説明 |
|---------|-----------|------|
| 自動投稿する | ON | ONの場合は認識テキストを即座に送信し、OFFの場合は入力欄への反映のみ行います。 |
| 言語コード | ja-JP | 音声認識の言語（例: `en-US`, `ko-KR`, `zh-CN`） |
| STTプロバイダー | ブラウザ標準 | 音声認識エンジンを選択します。 |
| Google APIキー | （なし） | Google Cloud STT使用時のAPIキー |

## ライセンス

MIT License
