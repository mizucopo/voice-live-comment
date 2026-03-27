import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findChatInput, findSendButton, inputAndSubmit, loadSettings } from '../src/content.js';

describe('content.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('findChatInput', () => {
    it('yt-live-chat-text-input-field-renderer内のdiv#inputを取得する', () => {
      document.body.innerHTML = `
        <yt-live-chat-text-input-field-renderer>
          <div id="input" contenteditable="true"></div>
        </yt-live-chat-text-input-field-renderer>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.id).toBe('input');
    });

    it('tp-yt-paper-input内のinputを取得する', () => {
      document.body.innerHTML = `
        <tp-yt-paper-input>
          <input type="text" />
        </tp-yt-paper-input>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.tagName).toBe('INPUT');
    });

    it('#chat内のcontenteditableを取得する', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div contenteditable="true"></div>
        </div>
      `;
      const result = findChatInput();
      expect(result).not.toBeNull();
      expect(result.hasAttribute('contenteditable')).toBe(true);
    });

    it('チャット入力欄がない場合はnullを返す', () => {
      document.body.innerHTML = '<div>no chat here</div>';
      const result = findChatInput();
      expect(result).toBeNull();
    });
  });

  describe('findSendButton', () => {
    it('#send-buttonを取得する', () => {
      document.body.innerHTML = '<button id="send-button">送信</button>';
      const result = findSendButton();
      expect(result).not.toBeNull();
      expect(result.id).toBe('send-button');
    });

    it('aria-label="送信"のボタンを取得する', () => {
      document.body.innerHTML = '<button aria-label="送信">Send</button>';
      const result = findSendButton();
      expect(result).not.toBeNull();
    });

    it('送信ボタンがない場合はnullを返す', () => {
      document.body.innerHTML = '<div>no button</div>';
      const result = findSendButton();
      expect(result).toBeNull();
    });
  });

  describe('inputAndSubmit', () => {
    it('トリム処理を適用する', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      const input = document.getElementById('input');
      input.focus = vi.fn();

      inputAndSubmit('  hello   world  ');

      expect(input.textContent).toBe('hello world');
    });

    it('空文字の場合は何もしない', () => {
      document.body.innerHTML = `
        <div id="chat">
          <div id="input" contenteditable="true"></div>
        </div>
      `;
      const input = document.getElementById('input');
      input.focus = vi.fn();
      input.textContent = 'existing';

      inputAndSubmit('   ');

      expect(input.textContent).toBe('existing');
    });

    it('チャット入力欄がない場合はエラーを送信する', () => {
      document.body.innerHTML = '';
      inputAndSubmit('test');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SHOW_ERROR',
        message: 'チャット入力欄が見つかりません'
      });
    });
  });

  describe('loadSettings', () => {
    it('デフォルト値で設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: true, language: 'ja-JP' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: true, language: 'ja-JP' });
    });

    it('保存済み設定を読み込む', async () => {
      chrome.storage.sync.get.mockResolvedValue({ autoPost: false, language: 'en-US' });
      const result = await loadSettings();
      expect(result).toEqual({ autoPost: false, language: 'en-US' });
    });
  });
});
