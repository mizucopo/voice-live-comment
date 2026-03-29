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
      <input type="checkbox" id="useLocalModel" />
      <textarea id="boostPhrases"></textarea>
      <textarea id="dictionary"></textarea>
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
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(true);
      expect(languageInput.value).toBe('ja-JP');
    });

    it('保存済み設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({
        autoPost: false,
        language: 'en-US',
        useLocalModel: true,
        boostPhrases: ['配信', 'コメント'],
        dictionary: 'とーきょー→東京'
      });

      await loadSettings();

      expect(autoPostCheckbox.checked).toBe(false);
      expect(languageInput.value).toBe('en-US');
      expect(document.getElementById('useLocalModel').checked).toBe(true);
      expect(document.getElementById('boostPhrases').value).toBe('配信\nコメント');
      expect(document.getElementById('dictionary').value).toBe('とーきょー→東京');
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
        language: 'en-US',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
    });

    it('空の言語はデフォルト値にする', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = '   ';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: false,
        boostPhrases: [],
        dictionary: ''
      });
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

    it('新設定を保存する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      document.getElementById('useLocalModel').checked = true;
      document.getElementById('boostPhrases').value = '配信\nコメント';
      document.getElementById('dictionary').value = 'とーきょー→東京';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith({
        autoPost: true,
        language: 'ja-JP',
        useLocalModel: true,
        boostPhrases: ['配信', 'コメント'],
        dictionary: 'とーきょー→東京'
      });
    });

    it('boostPhrasesの空行を除外して保存する', async () => {
      autoPostCheckbox.checked = true;
      languageInput.value = 'ja-JP';
      document.getElementById('boostPhrases').value = '配信\n\nコメント\n';
      chrome.tabs.query.mockResolvedValue([]);

      const result = await saveSettings();

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({ boostPhrases: ['配信', 'コメント'] })
      );
    });
  });
});
