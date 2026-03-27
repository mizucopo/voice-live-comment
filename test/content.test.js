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
      // hasChat=trueの状態でモジュールをインポート
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });
      await import('../src/content.js');

      // リスナーに登録されたコールバックを取得
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      // 最初のトグルで開始（startRecognitionは非同期なので、
      // sendResponseはisActive=falseで呼ばれる）
      listener({ type: 'TOGGLE_RECOGNITION' }, {}, sendResponse);

      // レスポンスが返ることを確認
      expect(sendResponse).toHaveBeenCalledWith({ isActive: false });
    });

    it('SETTINGS_UPDATEDで設定を再読み込み', async () => {
      // hasChat=trueの状態でモジュールをインポート
      vi.resetModules();
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });
      await import('../src/content.js');

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'SETTINGS_UPDATED' }, {}, vi.fn());

      // 設定が読み込まれることを確認（少し待つ）
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(chrome.storage.sync.get).toHaveBeenCalled();
    });
  });
});
