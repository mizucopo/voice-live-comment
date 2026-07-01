# Voice Live Comment

音声認識でYouTube Liveのチャットにコメントを入力・投稿するChrome拡張機能です。
視聴ページとYouTube Studioの両方で使えます。

## 主な機能

- 拡張機能アイコンから音声認識を開始・停止
- 話した内容をテキスト化してYouTube Liveチャット欄へ入力
- 自動投稿と手動確認を切り替え
- 日本語、英語、韓国語、中国語などの言語設定
- ブラウザ標準STT、Google Cloud STT、Grok STTを切り替え
- 音声区間検出（VAD）で外部APIのコストを削減

## 動作環境

- Google Chrome（Manifest V3対応ブラウザ）

### 対応ページ

| ページ | URL |
|--------|-----|
| YouTube Live | `youtube.com/live/*`、`youtube.com/watch*` |
| YouTube Studio | `studio.youtube.com/*` |

## インストール（通常利用）

通常利用では `npm install` や `npm run build` は不要です。

1. [GitHub Releases](https://github.com/mizucopo/voice-live-comment/releases) から `voice-live-comment-vX.Y.Z.zip` をダウンロードします。
2. zipファイルを展開します。
3. Chromeで `chrome://extensions/` を開きます。
4. 右上の「デベロッパーモード」をONにします。
5. 「パッケージ化されていない拡張機能を読み込む」をクリックします。
6. 展開した `voice-live-comment-vX.Y.Z` フォルダを選択します。

## 開発中の動作検証

開発中にローカルの変更を動作検証する場合は、依存パッケージをインストールしてビルドします。

```bash
git clone https://github.com/mizucopo/voice-live-comment.git
cd voice-live-comment
npm install
npm run build
```

ビルド後、Chromeで `chrome://extensions/` を開き、「パッケージ化されていない拡張機能を読み込む」からリポジトリのフォルダを選択します。

`src/content.js` またはそこから読み込まれるファイルを変更した場合は、動作確認前に再度ビルドしてください。

```bash
npm run build
```

テストを実行する場合:

```bash
npm run test:run
```

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
| STTプロバイダー | ブラウザ標準 | 音声をテキスト化するSTTプロバイダーを選択します。 |
| 認識音量しきい値 | 0.05 | 値を上げるほど小さい声を拾いにくくなります。`0.00` にすると音量による除外を行いません。 |
| ワードブースト | （なし） | 認識優先度を上げたい言葉を1行に1つ入力します。ブラウザのオンデバイスモデル、Grok STTで使用されます。 |
| カスタム辞書 | （なし） | `誤認識→正しい表記` の形式で、認識後のテキストを置換します。 |
| Google APIキー | （なし） | Google Cloud STT使用時のAPIキー |
| xAI APIキー | （なし） | Grok STT使用時のAPIキー |

## ライセンス

MIT License
