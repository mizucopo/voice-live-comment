import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateBadge, setBadgeError, showNotification } from '../src/background.js';

// background.jsはインポート時にonMessageリスナーを登録する。
// beforeEachでvi.clearAllMocks()が呼ばれるとmock.callsもクリアされるため、
// テスト内でリスナーを参照するにはリインポートが必要。
async function importBackground() {
  vi.resetModules();
  return await import('../src/background.js');
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
      expect(chrome.notifications.create).toHaveBeenCalledWith({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
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
  });
});
