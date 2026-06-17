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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sendAudio でxAI Grok STT APIへ16k PCMをmultipart/form-dataで呼び出す', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'こんにちは' })
    });

    const onResult = vi.fn();
    provider.onResult(onResult);

    const audioBlob = new Blob(['fake-audio'], { type: 'audio/l16;rate=16000' });
    await provider.sendAudio(audioBlob);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.x.ai/v1/stt',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-xai-key' }
      })
    );

    const body = mockFetch.mock.calls[0][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('format')).toBe('true');
    expect(body.get('language')).toBe('ja');
    expect(body.get('audio_format')).toBe('pcm');
    expect(body.get('sample_rate')).toBe('16000');
    expect(body.getAll('keyterm')).toEqual(['配信名', 'コメント']);
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('file').name).toBe('audio.pcm');

    expect(onResult).toHaveBeenCalledWith('こんにちは');
  });

  it('APIキー未設定でsendAudio呼び出し時にエラー', async () => {
    provider = new GrokSttProvider('', 'ja-JP', []);
    const onError = vi.fn();
    provider.onError(onError);

    await provider.sendAudio(new Blob(['fake-audio'], { type: 'audio/webm' }));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('API 4xxエラー時にonErrorを呼び出す', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'unsupported audio'
    });

    const onError = vi.fn();
    provider.onError(onError);

    await provider.sendAudio(new Blob(['fake-audio'], { type: 'audio/webm' }));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('unsupported audio') })
    );
  });

  it('API 429エラー時にリトライする（最大2回）', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '' })
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'テスト' })
      });

    const onResult = vi.fn();
    provider.onResult(onResult);

    const promise = provider.sendAudio(new Blob(['fake-audio'], { type: 'audio/webm' }));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenCalledWith('テスト');
  });

  it('start / stop はno-op（外部APIはsendAudioのみ使用）', async () => {
    await expect(provider.start()).resolves.toBeUndefined();
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
