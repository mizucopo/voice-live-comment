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
