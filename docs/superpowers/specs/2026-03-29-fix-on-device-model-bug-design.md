# オンデバイスモデル使用時の音声入力不能バグ修正

**日付**: 2026-03-29
**ステータス**: Draft

## 背景

オプション設定で「オンデバイスモデルを使用する」を有効にすると、拡張機能をONにしてもバッジが変化せず、音声入力が一切できないバグが発生する。

## 根本原因

### 診断結果

Chrome 146（arm64 Mac）でYouTube LiveページのDevToolsコンソールにて診断スクリプトを実行した結果:

- `processLocally` プロパティ: 存在する
- `SpeechRecognition.available()`: `"available"` を返す（モデルはインストール済み）
- `rec.start()` 呼び出し: 例外なく成功
- **その後**: `not-allowed` エラー（"The requesting agent type is not allowed to use speech recognition"）が発生

### 原因

オンデバイスモデル自体は利用可能だが、Chromeが`processLocally = true`での認識開始を「要求エージェントタイプが許可されていない」としてブロックしている。

### 現在のコードの問題点

1. **`startInstance()`にtry-catchがない** - `rec.start()`が例外を投げた場合、イベントハンドラも発火せず完全に無反応になる
2. **`onerror`のメッセージが不正確** - `not-allowed`を一律「マイクへのアクセスが拒否されました」としているが、実際はエージェントタイプ制限の場合もある
3. **フォールバックがない** - `processLocally`が失敗した場合、クラウド認識へのフォールバックを行わず停止する
4. **タイムアウトがない** - イベントが一切発火しない「ゾンビ状態」を検知できない

## 修正設計

### 1. `startInstance()`へのtry-catch追加

`content.js`の`startInstance()`で`rec.start()`をtry-catchで包む。例外発生時、`processLocally`が有効ならフォールバックを実行。

### 2. processLocallyフォールバック機構

`processLocally = true`で`not-allowed`エラーが発生した場合、自動的にクラウド認識にフォールバックして再起動する。

- `hasFallbackFromLocal`フラグで無限ループを防止
- フォールバック時にユーザーへ通知（「オンデバイス認識が利用できないため、クラウド認識に切り替えました」）
- フォールバック時は`settings.useLocalModel = false`に変更してから`startInstance()`を呼び出す

### 3. タイムアウトセーフティネット

`start()`呼び出し後、3秒以内に`onstart`が発火しない場合、`processLocally`が有効ならフォールバックを実行。

- `startTimeoutId`でタイムアウトを管理
- `onstart`ハンドラでタイムアウトをクリア
- `stopRecognition()`でタイムアウトをクリア

### 4. `onerror`ハンドラの改善

- `processLocally`が有効な状態での`not-allowed`エラー → フォールバック実行
- `processLocally`が無効な状態での`not-allowed`エラー → 従来通り「マイクへのアクセスが拒否されました」
- その他のエラー → ログ出力（従来は無視していた）

### 5. クリーンアップ処理

`stopRecognition()`で以下を追加:
- `hasFallbackFromLocal`フラグのリセット
- `startTimeoutId`のクリア

`SETTINGS_UPDATED`ハンドラで:
- `hasFallbackFromLocal`フラグのリセット（設定変更時に再試行可能にする）

## 変更対象ファイル

- `src/content.js` - メインの修正箇所

## テスト方針

- 既存のテスト（`test/content.test.js`）が通ることを確認
- フォールバック時の動作をシミュレートするテストを追加
- タイムアウト発火時の動作をシミュレートするテストを追加
