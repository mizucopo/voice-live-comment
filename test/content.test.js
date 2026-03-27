import { describe, it, expect, vi, beforeEach } from 'vitest';

// content.jsはモジュール読み込み時にDOMをチェックするため、
// 各テストグループでvi.resetModules()と動的importを使って再評価する
async function importContentWithDOM(html) {
  vi.resetModules();
  document.body.innerHTML = html;
  return await import('../src/content.js');
}

describe('content.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('findChatInput', () => {
    it('yt-live-chat-text-input-field-renderer内のdiv#inputを取得する', async () => {
      const { findChatInput } = await importContentWithDOM(`
        <yt-live-chat-text-input-field-renderer>
          <div id="input" contenteditable="true"></div>
        </yt-live-chat-text-input-field-renderer>
      `);
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.id).toBe('input');
    });

    it('tp-yt-paper-input内のinputを取得する', async () => {
      const { findChatInput } = await importContentWithDOM(`
        <tp-yt-paper-input>
          <input type="text" />
        </tp-yt-paper-input>
      `);
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.tagName).toBe('INPUT');
    });

    it('#chat内のcontenteditableを取得する', async () => {
      const { findChatInput } = await importContentWithDOM(`
        <div id="chat">
          <div contenteditable="true"></div>
        </div>
      `);
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.hasAttribute('contenteditable')).toBe(true);
    });

    it('チャット入力欄がない場合はnullを返す', async () => {
      const { findChatInput } = await importContentWithDOM('<div>no chat here</div>');
      const result = findChatInput();
      expect(result).toBeNull();
    });
  });

  describe('findSendButton', () => {
    it('#send-buttonを取得する', async () => {
      const { findSendButton } = await importContentWithDOM('<button id="send-button">送信</button>');
      const result = findSendButton();
      expect(result).not.toBeNull();
      expect(result.id).toBe('send-button');
    });

    it('aria-label="送信"のボタンを取得する', async () => {
      const { findSendButton } = await importContentWithDOM('<button aria-label="送信">Send</button>');
      const result = findSendButton();
      expect(result).not.toBeNull();
    });

    it('送信ボタンがない場合はnullを返す', async () => {
      const { findSendButton } = await importContentWithDOM('<div>no button</div>');
      const result = findSendButton();
      expect(result).toBeNull();
    });
  });

  describe('inputAndSubmit', () => {
    it('トリム処理を適用する', async () => {
      const { inputAndSubmit } = await importContentWithDOM(`
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `);
      const input = document.getElementById('input');
      input.focus = vi.fn();

      inputAndSubmit('  hello   world  ');

      expect(input.textContent).toBe('hello world');
    });

    it('空文字の場合は何もしない', async () => {
      const { inputAndSubmit } = await importContentWithDOM(`
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `);
      const input = document.getElementById('input');
      input.focus = vi.fn();
      input.textContent = 'existing';

      inputAndSubmit('   ');

      expect(input.textContent).toBe('existing');
    });

    it('チャット入力欄がない場合はエラーを送信する', async () => {
      const { inputAndSubmit } = await importContentWithDOM('');
      inputAndSubmit('test');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SHOW_ERROR',
        message: 'チャット入力欄が見つかりません'
      });
    });
  });

  describe('loadSettings', () => {
    it('デフォルト値で設定を読み込む', async () => {
      const { loadSettings } = await importContentWithDOM('');
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: true, language: 'ja-JP' });
    });

    it('保存済み設定を読み込む', async () => {
      const { loadSettings } = await importContentWithDOM('');
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: false, language: 'en-US' });
    });
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
      // hasChat=trueの状態でモジュールを再インポート
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
      // hasChat=trueの状態でモジュールを再インポート
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
