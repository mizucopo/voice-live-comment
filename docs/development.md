# 開発者向けガイド

[利用者向けREADMEへ戻る](../README.md)

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

### 構成とテンプレート更新

- TypeScriptのソース、`manifest.json`、オプション画面、スタイル、アイコンは `src/` に置きます。テストは `tests/` に置き、可能な範囲でソースの構成に揃えます。
- `npm run build` はTypeScriptのコンパイル後、Rollupでcontent scriptをバンドルし、画面・アイコン等のアセットとMITライセンスを `dist/` にコピーします。
- 共通の構成、TypeScript・Lint設定、Node.jsのバージョン、品質チェック、採番・公開は `mizucopo/repo-template` のChrome拡張テンプレートを基本にします。Copier更新時は生成ファイルを基本として受け入れ、製品コードを適合させます。
- YouTubeコメントの動作、STTプロバイダー、音声パイプライン、依存パッケージ、Rollupでのバンドル、オプション画面、アイコン、振る舞いのテストは製品固有の要件として維持します。テンプレートと異なる構成が必要な場合は、その理由となるVoice Live Commentの要件を明示します。

### Google Cloud STTの再試行

Google Cloud STTはHTTP 429の応答に限り、1秒・2秒待機して最大2回再試行します。それ以外のHTTPエラー、通信エラー、応答の解析エラーは再試行せず通知します。エラーメッセージや応答本文に「429」が含まれるだけでは再試行しません。

## 配布とリリース

公開時の分類は [CONTRIBUTING.md](../CONTRIBUTING.md#リリース分類)、採番・公開の設定と復旧は [リリース手順](release.md) を参照してください。`package.json` と `src/manifest.json` のバージョンは一致させます。PRでの手動採番は不要です。

配布ZIP名は `voice-live-comment-X.Y.Z.zip` です。実行を起動したpush時点のリポジトリ名とバージョンから生成するため、改名後の再実行でも同じ名前を使います。過去のリリースにある `chrome-extension-X.Y.Z.zip` の名前は変更しません。
