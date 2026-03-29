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
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
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
        autoPost: false,
        language: 'en-US',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });

    it('デュアルバッファリング: 開始時にインスタンスを1つ作成', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      // 少し待ってコンストラクタ呼び出しを確認
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(global.webkitSpeechRecognition).toHaveBeenCalled();
    });

    it('連続切替: 開始→停止→開始が動作する', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 停止
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 再開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(sendResponse).toHaveBeenCalledTimes(3);
    });

    it('processLocally=trueでnot-allowedエラー時にクラウド認識へフォールバック', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));

      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBeGreaterThanOrEqual(1);
      expect(instances[0].processLocally).toBe(true);

      // not-allowedエラーをシミュレート
      instances[0].onerror({ error: 'not-allowed' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバックで新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(instances[1].processLocally).not.toBe(true);

      // エラー通知が送信される
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR', message: expect.stringContaining('クラウド') })
      );
    });

    it('processLocally=trueでstart()が例外を投げた場合クラウド認識へフォールバック', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });

      // 最初のstart()呼び出しで例外を投げる
      global.MockSpeechRecognition._startShouldThrow = new Error('start failed');

      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック確認: 2つ以上のインスタンスが作成されている
      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBeGreaterThanOrEqual(2);

      // エラー通知が送信される
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SHOW_ERROR' })
      );
    });

    it('processLocally=trueでonstartが発火しない場合タイムアウトでフォールバック', async () => {
      vi.useFakeTimers();
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());

      await vi.advanceTimersByTimeAsync(10);

      const instances = global.MockSpeechRecognition._instances;
      expect(instances.length).toBe(1);

      // 3秒経過（タイムアウト発火）
      await vi.advanceTimersByTimeAsync(3000);

      // フォールバック確認
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(instances[1].processLocally).not.toBe(true);

      vi.useRealTimers();
    });

    it('フォールバック後に停止→再開でフォールバックフラグがリセットされる', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック発生
      const instances = global.MockSpeechRecognition._instances;
      instances[0].onerror({ error: 'not-allowed' });
      await new Promise(resolve => setTimeout(resolve, 10));

      const instanceCountAfterFallback = instances.length;
      expect(instanceCountAfterFallback).toBeGreaterThanOrEqual(2);

      // 停止
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 再開（フォールバックフラグがリセットされているため再度フォールバック可能）
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);
      await new Promise(resolve => setTimeout(resolve, 10));

      // 新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThan(instanceCountAfterFallback);
    });

    it('SETTINGS_UPDATEDでフォールバック後に設定変更で再起動される', async () => {
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // 開始
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, vi.fn());
      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック発生 → onstartを発火させてisActive=trueにする
      const instances = global.MockSpeechRecognition._instances;
      instances[0].onerror({ error: 'not-allowed' });
      await new Promise(resolve => setTimeout(resolve, 10));

      // フォールバック後のインスタンスでonstartを発火
      const fallbackInstance = instances[instances.length - 1];
      if (fallbackInstance.onstart) fallbackInstance.onstart();

      const instanceCountAfterFallback = instances.length;

      // 設定更新（useLocalModelをtrueのまま）
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: [],
        dictionary: ''
      });
      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());
      await new Promise(resolve => setTimeout(resolve, 50));

      // 設定更新後、再起動により新しいインスタンスが作成される
      expect(instances.length).toBeGreaterThan(instanceCountAfterFallback);
    });
  });
});
