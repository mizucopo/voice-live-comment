import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GrokSttProvider } from '../../src/stt/grok-stt-provider.js';

describe('GrokSttProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new GrokSttProvider('test-xai-key', 'ja-JP', ['配信名', 'コメント']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sendAudio でservice workerへGrok STT変換を依頼する', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: true,
      text: 'こんにちは'
    });

    const onResult = vi.fn();
    provider.onResult(onResult);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/l16;rate=16000' });
    await provider.sendAudio(audioBlob);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'GROK_STT_RECOGNIZE',
      apiKey: 'test-xai-key',
      audioBase64: btoa('fake-audio'),
      language: 'ja-JP',
      boostPhrases: ['配信名', 'コメント']
    });
    expect(onResult).toHaveBeenCalledWith('こんにちは');
  });

  it('APIキー未設定でsendAudio呼び出し時にエラー', async () => {
    provider = new GrokSttProvider('', 'ja-JP', []);
    const onError = vi.fn();
    provider.onError(onError);

    await provider.sendAudio(new Blob(['fake-audio'], { type: 'audio/webm' }));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('service workerが返したエラーでonErrorを呼び出す', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({
      ok: false,
      error: 'Grok STT API error 400: unsupported audio'
    });

    const onError = vi.fn();
    provider.onError(onError);

    await provider.sendAudio(new Blob(['fake-audio'], { type: 'audio/webm' }));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('unsupported audio') })
    );
  });

  it('start / stop はno-op（外部APIはsendAudioのみ使用）', async () => {
    await expect(provider.start()).resolves.toBeUndefined();
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
