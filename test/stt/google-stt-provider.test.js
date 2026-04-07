import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleSttProvider } from '../../src/stt/google-stt-provider.js';

describe('GoogleSttProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    provider = new GoogleSttProvider('test-api-key', 'ja-JP');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sendAudio でGoogle Cloud STT APIを呼び出す', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        results: [{ alternatives: [{ transcript: 'こんにちは' }] }]
      })
    };
    mockFetch.mockResolvedValue(mockResponse);

    const onResult = vi.fn();
    provider.onResult(onResult);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm;codecs=opus' });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode('fake-audio').buffer);
    await provider.sendAudio(audioBlob);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://speech.googleapis.com/v1/speech:recognize?key=test-api-key',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.config.encoding).toBe('WEBM_OPUS');
    expect(body.config.languageCode).toBe('ja-JP');
    expect(body.audio.content).toBeDefined();

    expect(onResult).toHaveBeenCalledWith('こんにちは');
  });

  it('APIキー未設定でsendAudio呼び出し時にエラー', async () => {
    provider = new GoogleSttProvider('', 'ja-JP');
    const onError = vi.fn();
    provider.onError(onError);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode('fake-audio').buffer);
    await provider.sendAudio(audioBlob);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('API 4xxエラー時にonErrorを呼び出す', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request'
    });

    const onError = vi.fn();
    provider.onError(onError);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode('fake-audio').buffer);
    await provider.sendAudio(audioBlob);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('API 429エラー時にリトライする（最大2回）', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ alternatives: [{ transcript: 'テスト' }] }]
        })
      });

    const onResult = vi.fn();
    provider.onResult(onResult);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' });
    audioBlob.arrayBuffer = () => Promise.resolve(new TextEncoder().encode('fake-audio').buffer);
    await provider.sendAudio(audioBlob);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenCalledWith('テスト');
  });

  it('start / stop はno-op（外部APIはsendAudioのみ使用）', async () => {
    await expect(provider.start()).resolves.toBeUndefined();
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
