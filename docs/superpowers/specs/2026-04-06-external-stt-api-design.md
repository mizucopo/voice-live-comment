# External STT API Support Design

## Overview

ブラウザ音声認識（Web Speech API）に加えて、外部STT APIを利用した音声認識をサポートする。設定画面でSTTプロバイダーを切り替え可能にし、コスト削減のためブラウザ側でVADを行い音声区間のみをAPIに送信する。

## Requirements

- 設定でブラウザ音声認識 / 外部APIを切り替え可能
- 外部API候補: Speechmatics, Deepgram, Google Cloud Speech-to-Text
- Google Cloud STTのみ実装、Speechmatics/Deepgramは未実装スタブ
- ブラウザ側でVADを行い、音声区間のみをASRに送信してコスト削減
- VADはSilero VAD（MLベース）を使用、拡張内にバンドル

## Decisions

| 項目 | 決定 | 理由 |
|------|------|------|
| アーキテクチャ | Strategyパターン | 将来のプロバイダー追加に対応 |
| 音声キャプチャ | MediaRecorder (WEBM/Opus) | ブラウザ標準API、実装シンプル |
| VAD | Silero VAD (ONNX Runtime Web) | 高精度、ブラウザで動作 |
| VADバンドル | 拡張内バンドル | オフライン動作、CDN依存なし |
| STT API | Google Cloud STT Batch API | 発話単位の一括送信で十分 |
| 認証 | APIキー | 実装が最もシンプル |
| 音声フォーマット | WEBM/Opus | Google Cloud STTがネイティブ対応 |
| 設定UI | プルダウンでProvider選択 | 直感的で拡張しやすい |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  content.js                  │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │ AudioCapture │───▶│      VAD          │  │
│  │ (MediaRecorder)   │  (Silero/ONNX)    │  │
│  └──────────────┘    └────────┬──────────┘  │
│                               │ speech chunks│
│                               ▼              │
│                     ┌───────────────────┐    │
│                     │   SttProvider      │    │
│                     │  (interface)       │    │
│                     ├───────────────────┤    │
│                     │ • BrowserStt      │    │
│                     │ • GoogleStt       │    │
│                     │ • SpeechmaticsStt │    │
│                     │ • DeepgramStt     │    │
│                     └────────┬──────────┘    │
│                              │ text          │
│                              ▼               │
│                     ┌───────────────────┐    │
│                     │  ChatInput (既存)  │    │
│                     └───────────────────┘    │
└─────────────────────────────────────────────┘
```

ブラウザProvider選択時は AudioCapture/VAD は使用しない（Web Speech APIが内蔵VADを持つため）。外部API選択時のみ `AudioCapture → VAD → SttProvider` パイプラインが有効化される。

## Components

### SttProvider Interface (`src/stt/stt-provider.js`)

共通インターフェース。各プロバイダーはこのインターフェースを実装する。

```
start()                    — 認識開始
stop()                     — 認識停止
sendAudio(audioBlob)       — 音声データを送信（外部API用。BrowserSttではno-op）
onResult(cb)               — 結果コールバック: (text: string) => void
onError(cb)                — エラーコールバック: (error: Error) => void
```

BrowserSttProviderはWeb Speech APIが直接マイクにアクセスするため、`sendAudio` は空実装（no-op）。GoogleSttProviderはVADから呼ばれて音声をAPIに送信する。

### BrowserSttProvider (`src/stt/browser-stt-provider.js`)

既存のWeb Speech APIロジック（デュアルバッファリング含む）を移行。動作は既存と全く同じ。

### GoogleSttProvider (`src/stt/google-stt-provider.js`)

VADから発話区間の音声データ（WEBM/Opus）を受信し、Google Cloud STT Batch APIに送信。

```
POST https://speech.googleapis.com/v1/speech:recognize?key={API_KEY}
Content-Type: application/json

{
  "audio": { "content": "<base64_encoded_webm>" },
  "config": {
    "encoding": "WEBM_OPUS",
    "sampleRateHertz": 48000,
    "languageCode": "ja-JP"
  }
}
```

### SpeechmaticsSttProvider / DeepgramSttProvider

未実装スタブ。コンストラクタで未実装エラーをthrow。設定画面では選択可能だが選択時に未実装メッセージを表示。

### AudioCapture (`src/audio-capture.js`)

MediaRecorderでマイク音声を録音し、チャンクをVADに渡す。

- `getUserMedia({ audio: true })` でマイク取得
- MediaRecorder起動（`timeslice: 250`）
- チャンクをVADにフィード
- VADが発話終了を検知したら、その区間の録音データを結合してProviderに送信

### VAD (`src/vad.js`)

Silero VADモデルで音声区間を検出。

依存:
- `onnxruntime-web` — ONNX Runtimeのブラウザ版
- `silero-vad.onnx` — Silero VADモデルファイル

API:
- `init()` — モデルのロード（初回のみ、以降キャッシュ）
- `processChunk(audioData)` — 音声チャンクを処理
- `onSpeechStart(callback)` / `onSpeechEnd(callback)` — イベント通知

発話区間の判定:
- 音声フレームを16kHz PCMにリサンプリング
- Silero VADで確率計算
- 閾値0.5を超えたら `speechStart`、下回って300ms継続で `speechEnd`

## Settings UI (`options.html` / `options.js`)

Providerに応じて設定項目を切り替え:

**ブラウザ音声認識選択時:**
- オート投稿 (共通)
- 言語 (共通)
- オンデバイス (ブラウザ専用)
- ブーストフレーズ (ブラウザ専用)
- カスタム辞書 (ブラウザ専用)

**Google Cloud STT選択時:**
- オート投稿 (共通)
- 言語 (共通)
- API Key (Google専用)

**Speechmatics / Deepgram選択時:**
- 未実装メッセージを表示

## content.js Changes

音声認識の開始/停止をProviderインターフェース経由に変更:

1. アイコンクリック → 設定からProvider取得
2. Provider.start() / stop() で認識制御
3. 外部API選択時は AudioCapture + VAD を初期化
4. チャット入力部分（inputAndSubmit等）は既存のまま変更なし

## Error Handling

| エラー種別 | 対応 |
|-----------|------|
| APIキー未設定 | バッジにエラー表示（✕）、通知で設定画面へ誘導 |
| ONNXモデル読み込み失敗 | フォールバックメッセージ、設定画面でエラー詳細表示 |
| マイクアクセス拒否 | 既存通りバッジエラー + 通知 |
| Google API 4xxエラー | 通知でエラーメッセージ表示 |
| Google API 429 (Rate Limit) | 最大2回リトライ（指数バックオフ） |
| ネットワークエラー | 通知でオフラインであることを表示 |
| VAD初期化失敗 | 外部API使用不可、通知でブラウザProviderへの切り替えを提案 |

## Testing

新規テスト:
- `test/audio-capture.test.js` — MediaRecorderモックで録画・チャンク分割をテスト
- `test/vad.test.js` — Silero VADモックで発話区間検出をテスト
- `test/stt/google-stt-provider.test.js` — fetchモックでAPI呼び出し・レスポンス処理をテスト
- `test/stt/browser-stt-provider.test.js` — 既存のWeb Speech APIテストを移行
- `test/options.test.js` — Provider切り替えUIのテストを追加

## File Structure

```
src/
├── background.js                # 変更なし
├── content.js                   # Provider切り替えロジックに変更
├── options.js                   # Provider設定UI追加
├── audio-capture.js             # 新規: MediaRecorder音声キャプチャ
├── vad.js                       # 新規: Silero VADラッパー
├── stt/
│   ├── stt-provider.js          # 新規: 共通インターフェース
│   ├── browser-stt-provider.js  # 新規: 既存ロジックを移行
│   ├── google-stt-provider.js   # 新規: Google Cloud STT
│   ├── speechmatics-stt-provider.js  # 新規: 未実装スタブ
│   └── deepgram-stt-provider.js      # 新規: 未実装スタブ
├── utils/
│   ├── url.js                   # 変更なし
│   └── text.js                  # 変更なし
models/
└── silero-vad.onnx              # 新規: Silero VADモデルファイル
test/
├── audio-capture.test.js        # 新規
├── vad.test.js                  # 新規
├── stt/
│   ├── google-stt-provider.test.js     # 新規
│   └── browser-stt-provider.test.js   # 新規 (既存テスト移行)
├── options.test.js              # Provider切り替えテスト追加
└── ...                          # 既存テスト変更なし
```

## Dependencies (New)

- `onnxruntime-web` — ONNX Runtimeのブラウザ版（Silero VAD用）
- `silero-vad.onnx` — Silero VADモデルファイル（バンドル）
