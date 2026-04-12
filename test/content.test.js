import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('content.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('onMessage handler', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      vi.clearAllMocks();
    });

    it('TOGGLE_RECOGNITIONでstart/stopを切り替える', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({ isActive: false });
    });

    it('SETTINGS_UPDATEDで設定を再読み込み', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });

    it('ブラウザProviderで開始時にSpeechRecognitionインスタンスを作成', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(global.webkitSpeechRecognition).toHaveBeenCalled();
    });

    it('連続切替: 開始→停止→開始が動作する', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sendResponse).toHaveBeenCalledTimes(3);
    });

    it('stop→即startのレースコンディションでcurrentProviderが消失しない', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 1) 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 50));

      // SpeechRecognition インスタンスを取得し onstart を発火させて isActive = true にする
      const srInstance = global.MockSpeechRecognition._instances.at(-1);
      expect(srInstance).toBeDefined();
      srInstance.onstart();
      await new Promise(resolve => setTimeout(resolve, 10));

      // 2) 停止→即開始（レースコンディションを誘発）
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      // stopの await を待たずに即座に開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 50));

      // 新しい SpeechRecognition インスタンスの onstart を発火
      const newSrInstance = global.MockSpeechRecognition._instances.at(-1);
      if (newSrInstance && newSrInstance !== srInstance) {
        newSrInstance.onstart();
      }
      await new Promise(resolve => setTimeout(resolve, 50));

      // 3) 最後の停止が正常に動作することを確認（currentProviderがnullでないことの間接確認）
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 50));

      // 最後の stop 呼び出しがエラーなく完了していることを確認
      // エラーがあれば chrome.runtime.sendMessage に SHOW_ERROR が送られる
      const errorCalls = chrome.runtime.sendMessage.mock.calls.filter(
        call => call[0] && call[0].type === 'SHOW_ERROR'
      );
      expect(errorCalls).toHaveLength(0);
    });

    it('SETTINGS_UPDATED再起動中のトグルが並行起動を引き起こさない', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 1) 開始してアクティブにする
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 50));
      global.MockSpeechRecognition._instances.at(-1).onstart();
      await new Promise(r => setTimeout(r, 10));

      // 2) SETTINGS_UPDATED で再起動 → 即座にトグル（並行起動を試みる）
      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());
      await new Promise(r => setTimeout(r, 10));
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(r => setTimeout(r, 100));

      // 新しい onstart を発火
      const newInstance = global.MockSpeechRecognition._instances.at(-1);
      if (newInstance) newInstance.onstart();
      await new Promise(r => setTimeout(r, 50));

      // 3) エラーなく完了することを確認
      const errorCalls = chrome.runtime.sendMessage.mock.calls.filter(
        call => call[0] && call[0].type === 'SHOW_ERROR'
      );
      expect(errorCalls).toHaveLength(0);
    });

    it('外部プロバイダー start() 失敗時に audioCapture/vad がクリーンアップされる', async () => {
      // GoogleSttProvider の start() が例外を投げるようにモック
      vi.doMock('../src/stt/google-stt-provider.js', () => {
        return {
          GoogleSttProvider: class {
            constructor() { this._startCallbacks = []; this._resultCallbacks = []; this._errorCallbacks = []; }
            onStart(cb) { this._startCallbacks.push(cb); }
            onResult(cb) { this._resultCallbacks.push(cb); }
            onError(cb) { this._errorCallbacks.push(cb); }
            async start() { throw new Error('接続テスト失敗'); }
            async stop() {}
          }
        };
      });

      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'google',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: 'test-key'
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(r => setTimeout(r, 100));

      // エラーが通知されることを確認
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR', message: expect.stringContaining('接続テスト失敗') })
      );

      // getUserMedia が呼ばれた（AudioCapture が初期化された）ことを確認
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();

      // 再度 start できることを確認（audioCapture/vad がクリーンアップされていればリソース競合しない）
      vi.doUnmock('../src/stt/google-stt-provider.js');
      vi.resetModules();

      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener2 = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener2({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());
      await new Promise(r => setTimeout(r, 50));

      // 追加のエラーが発生していないことを確認
      const errorCalls = chrome.runtime.sendMessage.mock.calls.filter(
        call => call[0] && call[0].type === 'SHOW_ERROR'
      );
      // 初回の '接続テスト失敗' エラーのみ（1件）であることを確認
      expect(errorCalls).toHaveLength(1);
    });

    it('isStarting→isActiveギャップ中のトグルで二重起動しない', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'browser',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // 1) 開始 — startRecognition が完了するまで待つが、onstart は発火させない
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());
      await new Promise(r => setTimeout(r, 50));

      // この時点で startRecognition() は完了しているが isActive はまだ false
      // 旧コードでは isStarting も false に戻っている（finally のため）
      // もう一度トグル → 旧コードなら二つ目の startRecognition が走る
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());
      await new Promise(r => setTimeout(r, 50));

      // SpeechRecognition コンストラクタの呼び出し回数を確認
      // バグあり: 2 回以上（二重起動）
      // 修正済: 1 回（ギャップ中も isStarting ガードが有効）
      expect(global.webkitSpeechRecognition).toHaveBeenCalledTimes(1);
    });

    it('未実装プロバイダー選択時にエラー通知', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        sttProvider: 'speechmatics',
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: '',
        googleApiKey: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR' })
      );
    });
  });
});
