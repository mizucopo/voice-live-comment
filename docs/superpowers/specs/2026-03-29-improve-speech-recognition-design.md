# 音声認識精度改善デザイン

## 目的

YouTube Live配信用の音声認識Chrome拡張機能「Voice Live Comment」の音声認識精度を、参考プロジェクト「字幕ちゃん」(jimakuChan) の手法を取り入れて改善する。

現在の主な課題: 認識結果が間違っている（誤変換・聞き間違い）。

## 背景

### 現在の実装の問題点

- **単一インスタンス**: `webkitSpeechRecognition` を1つだけ使用
- **`continuous = true`**: 長時間の認識セッションで文脈が蓄積し、精度が劣化する
- **認識ギャップ**: `onend` → 再起動の間に1〜2秒の空白が発生
- **オンデバイス未対応**: クラウド認識のみ
- **カスタム辞書なし**: 誤認識を手動補正する手段がない

### 字幕ちゃんの優位性

- デュアルバッファリング（2インスタンスの交互切り替え）
- `continuous = false` で発話単位の高精度認識
- オンデバイスモデル対応（Chrome 138+）
- ワードブースト（`SpeechRecognitionPhrase` API）
- カスタム辞書（置換ルール）

## 設計

### 1. デュアルバッファリング認識エンジン

`content.js` の音声認識を2インスタンスのデュアルバッファリングに変更する。

```
現在:  [認識A] ──終了──→ [再起動A] ──終了──→ [再起動A]
                           ↑ 1-2秒のギャップ

改善後: [認識A] ──終了──→ [認識B] ──終了──→ [認識A] ...
              [認識Bを先行起動]   [認識Aを先行起動]
              ↑ ギャップなし
```

**仕組み:**

- 2つの `webkitSpeechRecognition` インスタンス（`recognitions[0]` / `recognitions[1]`）を用意
- `continuous = false` に設定（1発話＝1セッション、APIが文境界を自動検出）
- 現在のインスタンスの `onresult` で最終結果を受け取ったら、もう一方を先行起動（`preStart`）
- 現在のインスタンスの `onend` で、既に起動済みのインデックスに切り替え
- これにより認識ギャップをほぼゼロにする

**ステート管理:**

```javascript
const recognitions = [null, null];
let activeIndex = 0;
let isPreStarted = false;
let isActive = false;
```

**インスタンス設定:**

```javascript
rec.lang = settings.language;
rec.continuous = false;       // true → false に変更
rec.interimResults = true;
rec.maxAlternatives = 1;
```

**先行起動の流れ:**

1. `onresult` で `isFinal` の結果を取得
2. `preStartNextInstance()` で相手インスタンスを起動
3. `onend` で `activeIndex` を切り替え、既に起動済みのインスタンスをアクティブに

**停止時の処理:**

- 両インスタンスを停止
- タイマーをクリア
- ステートをリセット

### 2. オンデバイスモデル + ワードブースト

#### オンデバイス認識 (`processLocally`)

- Chrome 138+ で利用可能。音声データをローカルで処理する
- 初回は言語モデル（~1.5-2GB）のダウンロードが必要
- 利点: ネットワーク遅延なし、プライバシー保護、クラウドより安定
- フォールバック: オンデバイスが利用できない場合は自動的にクラウド認識に戻す

```javascript
// オンデバイス利用可能かチェック
if (recognition.processLocally !== undefined) {
  recognition.processLocally = settings.useLocalModel;
}
```

#### ワードブースト (`SpeechRecognitionPhrase`)

- 特定の単語・フレーズの認識優先度を上げる
- ユーザーがカスタムフレーズを設定可能
- 強度: 1.0〜20.0（デフォルト 10.0）
- オンデバイスモデル使用時のみ有効

```javascript
if (typeof SpeechRecognitionPhrase !== 'undefined' && settings.useLocalModel) {
  recognition.phrases = settings.boostPhrases.map(
    phrase => new SpeechRecognitionPhrase(phrase, 10.0)
  );
}
```

#### 設定画面への追加項目

- 「オンデバイスモデルを使用」チェックボックス（デフォルト: オフ）
- 「ワードブースト」テキストエリア（1行に1フレーズ、デフォルト: 空）

### 3. カスタム辞書（置換ルール）

#### 仕組み

- ユーザーが「誤認識 → 正しい表記」の置換ルールを設定可能
- 音声認識結果をチャットに投稿する前にテキスト置換を適用
- 例: `にしむら→西村`、`じまく→字幕`

#### 設定フォーマット

```
誤認識語→正しい表記
```

1行に1ルール。`→`で区切る。`#`で始まる行はコメントとして無視。空行は無視。

#### テキスト処理パイプライン

```
音声認識結果 → trimText() → applyDictionary() → チャット投稿
```

既存の `trimText()` の後に置換処理を挟む。既存機能への影響は最小限。

#### 実装

```javascript
function applyDictionary(text, rules) {
  for (const rule of rules) {
    text = text.replaceAll(rule.from, rule.to);
  }
  return text;
}

function parseDictionaryRules(text) {
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
```

#### 設定画面

- テキストエリアで編集
- ヘルプテキスト: `誤認識→正しい表記 の形式で1行に1つ入力してください`
- デフォルトは空（ユーザーが自由に追加）

## 設定項目のまとめ

| 項目 | キー | 型 | デフォルト | 追加/変更 |
|------|------|------|-----------|----------|
| 自動投稿 | `autoPost` | boolean | `true` | 変更なし |
| 言語 | `language` | string | `'ja-JP'` | 変更なし |
| オンデバイスモデル | `useLocalModel` | boolean | `false` | **追加** |
| ワードブースト | `boostPhrases` | string[] | `[]` | **追加** |
| カスタム辞書 | `dictionary` | string | `''` | **追加** |

## 変更対象ファイル

| ファイル | 変更内容 |
|----------|----------|
| `src/content.js` | デュアルバッファリング + 設定読み込み変更 |
| `src/utils/text.js` | `applyDictionary()` / `parseDictionaryRules()` を追加 |
| `options.html` | 設定フォームに新項目を追加 |
| `src/options.js` | 新設定の保存・読み込みロジック |
| `test/content.test.js` | デュアルバッファリングのテスト更新 |
| `test/options.test.js` | 新設定のテスト追加 |
| `test/utils/text.test.js` | 辞書置換のテスト追加 |
| `manifest.json` | 変更なし |

## 制約事項

- Chrome 138+ でないとオンデバイスモデルとワードブーストは利用不可（フォールバックあり）
- デュアルバッファリングとカスタム辞書は全バージョンで動作
- テストは既存のVitest + モック構成を踏襲
