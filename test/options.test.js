import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSettings, saveSettings } from '../src/options.js';

describe('options.js', () => {
  let autoPostCheckbox;
  let languageInput;
  let statusElement;

  beforeEach(() => {
    // DOM構築
    document.body.innerHTML = `
      <input type="checkbox" id="autoPost" />
      <input type="text" id="language" />
      <div id="status"></div>
      <button id="save">保存</button>
    `;
    autoPostCheckbox = document.getElementById('autoPost');
    languageInput = document.getElementById('language');
    statusElement = document.getElementById('status');

    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadSettings', () => {
    it('デフォルト値で設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(true);
      expect(languageInput.value).toBe('ja-JP');
    });

    it('保存済み設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(false);
      expect(languageInput.value).toBe('en-US');
    });
  });

  describe('saveSettings', () => {
    it('設定を保存する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'en-US';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'en-US'
      });
      expect(result).toEqual({ autoPost: true, language: 'en-US' });
    });

    it('空の言語はデフォルト値にする', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = '   ';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'ja-JP'
      });
      expect(result).toEqual({ autoPost: true, language: 'ja-JP' });
    });

    it('保存後にステータスを表示する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      chrome.tabs.query.mockResolvedValue([]);

      await saveSettings();

      expect(statusElement.textContent).toBe('保存しました');

      vi.advanceTimersByTime(2000);
      expect(statusElement.textContent).toBe('');
    });

    it('YouTubeタブに設定更新を通知する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      chrome.tabs.query.mockResolvedValue([
        { id: 1, url: 'https://www.youtube.com/watch?v=test' }
      ]);

      await saveSettings();

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'SETTINGS_UPDATED' });
    });
  });
});
