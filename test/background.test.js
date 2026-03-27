import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateBadge, setBadgeError, showNotification } from '../src/background.js';

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
        iconUrl: 'icons/icon48.png',
        title: 'テストタイトル',
        message: 'テストメッセージ'
      });
    });
  });
});
