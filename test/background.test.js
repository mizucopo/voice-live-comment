import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateBadge, setBadgeError, showNotification } from '../src/background.js';

// background.jsはインポート時にonMessageリスナーを登録する。
// beforeEachでvi.clearAllMocks()が呼ばれるとmock.callsもクリアされるため、
// テスト内でリスナーを参照するにはリインポートが必要。
async function importBackground() {
  vi.resetModules();
  return await import('../src/background.js');
}

function createGrokMessage(overrides = {}) {
  return {
    type: 'GROK_STT_RECOGNIZE',
    apiKey: 'test-xai-key',
    audioBase64: btoa('fake-audio'),
    language: 'ja-JP',
    boostPhrases: ['配信名', 'コメント'],
    ...overrides
  };
}

describe('background.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateBadge', () => {
    it('アクティブ時に緑のバッジを設定する', () => {
      updateBadge(true);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#4CAF50' });
    });

    it('非アクティブ時にバッジをクリアする', () => {
      updateBadge(false);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });

  describe('setBadgeError', () => {
    it('エラー時に赤い×バッジを設定する', () => {
      setBadgeError();
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '×' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#F44336' });
    });
  });

  describe('showNotification', () => {
    it('通知を作成する', () => {
      showNotification('テストタイトル', 'テストメッセージ');
      expect(chrome.runtime.getURL).toHaveBeenCalledWith('icons/icon128.png');
      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'chrome-extension://test-id/icons/icon128.png',
        title: 'テストタイトル',
        message: 'テストメッセージ'
      });
    });
  });

  describe('onMessage handler', () => {
    it('UPDATE_BADGEメッセージでupdateBadgeを呼ぶ', async () => {
      await importBackground();

      // リスナーに登録されたコールバックを取得
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // コールバックを実行
      listener({ type: 'UPDATE_BADGE', isActive: true }, {}, vi.fn());

      // 検証
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
    });

    it('SHOW_ERRORメッセージでエラーバッジと通知を表示', async () => {
      await importBackground();

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      listener({ type: 'SHOW_ERROR', message: 'テストエラー' }, {}, vi.fn());

      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '×' });
      expect(chrome.notifications.create).toHaveBeenCalled();
    });

    it('GROK_STT_RECOGNIZEメッセージでxAI APIをservice workerから呼び出す', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'こんにちは' })
      });
      await importBackground();

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage(), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        text: 'こんにちは'
      }));
      expect(fetch).toHaveBeenCalledWith(
        'https://api.x.ai/v1/stt',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-xai-key' }
        })
      );

      const body = fetch.mock.calls[0][1].body;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('format')).toBe('true');
      expect(body.get('language')).toBe('ja');
      expect(body.get('audio_format')).toBe('pcm');
      expect(body.get('sample_rate')).toBe('16000');
      expect(body.getAll('keyterm')).toEqual(['配信名', 'コメント']);
      expect(body.get('file')).toBeInstanceOf(File);
      expect(body.get('file').name).toBe('audio.pcm');
      await expect(body.get('file').text()).resolves.toBe('fake-audio');
    });

    it('GROK_STT_RECOGNIZEはAPI 429でリトライする', async () => {
      vi.useFakeTimers();
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '' })
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ text: 'テスト' })
        });
      await importBackground();

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage(), {}, sendResponse);

      expect(result).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        text: 'テスト'
      }));
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('GROK_STT_RECOGNIZEは設定言語と異なる短い結果を返さない', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: '啊！',
          language: 'Chinese',
          words: [{ text: '啊！', start: 0, end: 0.2 }]
        })
      });
      await importBackground();

      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      const sendResponse = vi.fn();

      const result = listener(createGrokMessage({ language: 'ja-JP' }), {}, sendResponse);

      expect(result).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        text: ''
      }));
    });
  });
});
