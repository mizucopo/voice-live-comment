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

| ページ         | URL                                        |
| -------------- | ------------------------------------------ |
| YouTube Live   | `youtube.com/live/*`、`youtube.com/watch*` |
| YouTube Studio | `studio.youtube.com/*`                     |

## インストール（通常利用）

通常利用では `npm install` や `npm run build` は不要です。

1. [GitHub Releases](https://github.com/mizucopo/voice-live-comment/releases) から `chrome-extension-X.Y.Z.zip` をダウンロードします。
2. zipファイルを展開します。
3. Chromeで `chrome://extensions/` を開きます。
4. 右上の「デベロッパーモード」をONにします。
5. 「パッケージ化されていない拡張機能を読み込む」をクリックします。
6. 展開先にある `manifest.json` と同じフォルダを選択します。

## 開発中の動作検証

開発中にローカルの変更を動作検証する場合は、依存パッケージをインストールしてビルドします。

```bash
git clone https://github.com/mizucopo/voice-live-comment.git
cd voice-live-comment
npm install
npm run build
```

ビルド後、Chromeで `chrome://extensions/` を開き、「パッケージ化されていない拡張機能を読み込む」からリポジトリ内の `dist/` を選択します。

`src/` または配布アセットを変更した場合は、動作確認前に再度ビルドしてください。

```bash
npm run build
```

型チェック、Lint、フォーマット、テスト、ビルドをまとめて確認する場合:

```bash
npm run check
```

個別には `npm run typecheck`、`npm run lint`、`npm run test:run`、`npm run build` を利用できます。生成された `dist/` は直接編集しません。

開発ツールはNode.js 24、TypeScript 7、Oxlint、Prettier、Vitestを使用します。`npm run lint` は型情報を使ったOxlintの検査を実行します。

## バージョンとリリース

- `package.json` と `src/manifest.json` のバージョンは常に一致させます。
- `main` を対象にするすべてのPull Requestは、Dependabotを含め、新しいバージョンへ更新します。
- `main` へのマージごとに `X.Y.Z` タグと配布版が作成されます。
- 配布ZIP名は `chrome-extension-X.Y.Z.zip` です。
- 完了済みリリースのうち、`main` の履歴で最も新しいものをGitHub ReleasesのLatestに指定します。古いリリースの再実行ではLatestを巻き戻しません。

## 設計資料

- [テンプレート優先のChrome拡張レイアウト](docs/adr/0002-adopt-template-first-chrome-extension-layout.md)

## 使い方

1. YouTube Live配信ページまたはYouTube Studioを開きます。
2. ツールバーの拡張機能アイコンをクリックして音声認識を開始します。
3. マイクに向かって話すと、認識テキストがチャット入力欄に入ります。
4. 自動投稿がONの場合は、そのままチャットに投稿されます。
5. もう一度アイコンをクリックすると音声認識を停止します。

### バッジ状態

| 状態   | バッジ   | 色     |
| ------ | -------- | ------ |
| 停止中 | （なし） | グレー |
| 認識中 | ●        | 緑     |
| エラー | ✕        | 赤     |

## 設定

ツールバーの拡張機能アイコンを右クリックし、「オプション」から設定画面を開きます。

| 設定項目         | デフォルト   | 説明                                                                                                 |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| 自動投稿する     | ON           | ONの場合は認識テキストを即座に送信し、OFFの場合は入力欄への反映のみ行います。                        |
| 言語コード       | ja-JP        | 音声認識の言語（例: `en-US`, `ko-KR`, `zh-CN`）                                                      |
| STTプロバイダー  | ブラウザ標準 | 音声をテキスト化するSTTプロバイダーを選択します。                                                    |
| 認識音量しきい値 | 0.05         | 値を上げるほど小さい声を拾いにくくなります。`0.00` にすると音量による除外を行いません。              |
| ワードブースト   | （なし）     | 認識優先度を上げたい言葉を1行に1つ入力します。ブラウザのオンデバイスモデル、Grok STTで使用されます。 |
| カスタム辞書     | （なし）     | `誤認識→正しい表記` の形式で、認識後のテキストを置換します。                                         |
| Google APIキー   | （なし）     | Google Cloud STT使用時のAPIキー                                                                      |
| xAI APIキー      | （なし）     | Grok STT使用時のAPIキー                                                                              |

### Grok STTの認識を調整する

- 日本語で使う場合は、言語コードを `ja-JP` にします。Grokから返された検出言語が設定と異なる結果は、長さに関係なく入力・投稿から除外します。意図的に外国語でコメントする場合は言語コードを変更してください。
- Grok APIの言語指定は数値などの表記整形用で、認識言語を固定するものではありません。検出言語がない場合、日本語設定では日本語を含まない韓国語などの表記や、一部の既知の中国語短文も除外します。漢字だけの文章や英字の固有名詞は判別が難しく、すべての外国語結果を除外できるわけではありません。
- ワードブーストには、配信名・人名・ゲーム用語など、実際に使う言葉を1行に1つ登録します。Grokでは最大100件、1件50文字までです。たとえば `Voice Live Comment` と `Grok` は別の行に入力します。
- 同じ誤変換を繰り返す場合は、カスタム辞書に `誤認識→正しい表記` を登録します。辞書は認識後の文字列を置換するため、短すぎる置換元は別の単語も変えてしまうことがあります。実際の誤変換に絞って登録してください。
- 調整中は自動投稿をOFFにし、普段の声で短文・固有名詞を含む文章を話して確認できます。小さい声が拾われない場合は、認識音量しきい値を少しずつ下げて確認してください。

音声変換時の歪みを抑える処理は自動で適用されます。

参考: [xAI Speech to Textの公式仕様](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)

## ライセンス

MIT License
