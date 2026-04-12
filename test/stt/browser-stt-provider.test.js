import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserSttProvider } from '../../src/stt/browser-stt-provider.js';

describe('BrowserSttProvider', () => {
  let provider;
  let settings;

  beforeEach(() => {
    vi.clearAllMocks();
    global.MockSpeechRecognition._instances.length = 0;
    global.MockSpeechRecognition._startShouldThrow = null;

    settings = {
      language: 'ja-JP',
      useLocalModel: false,
      boostPhrases: []
    };
    provider = new BrowserSttProvider(settings);
  });

  it('start() でSpeechRecognitionインスタンスを1つ作成する', async () => {
    await provider.start();
    expect(global.webkitSpeechRecognition).toHaveBeenCalled();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances.length).toBe(1);
  });

  it('start() で言語設定が反映される', async () => {
    settings.language = 'en-US';
    provider = new BrowserSttProvider(settings);
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances[0].lang).toBe('en-US');
  });

  it('useLocalModel=true でprocessLocallyが設定される', async () => {
    settings.useLocalModel = true;
    provider = new BrowserSttProvider(settings);
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances[0].processLocally).toBe(true);
  });

  it('onResult で認識結果が通知される', async () => {
    const onResult = vi.fn();
    provider.onResult(onResult);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: 'こんにちは' } }
      ]
    });

    expect(onResult).toHaveBeenCalledWith('こんにちは');
  });

  it('onStart で開始通知がされる', async () => {
    const onStart = vi.fn();
    provider.onStart(onStart);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();
    expect(onStart).toHaveBeenCalled();
  });

  it('onError でエラー通知がされる', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onerror({ error: 'network' });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('not-allowedエラー時にuseLocalModel=trueならフォールバックする', async () => {
    settings.useLocalModel = true;
    provider = new BrowserSttProvider(settings);
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    expect(instances[0].processLocally).toBe(true);
    instances[0].onerror({ error: 'not-allowed' });

    // フォールバックで新しいインスタンスが作成される
    expect(instances.length).toBeGreaterThanOrEqual(2);
    expect(instances[1].processLocally).not.toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it('旧インスタンスのonresultで結果が通知されない（鮮度ガード）', async () => {
    const onResult = vi.fn();
    provider.onResult(onResult);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    const oldRec = instances[0];

    // インスタンス0を startInstance(0) で差し替え
    // startInstance内で recognitions[0] が新しいrecに置き換わる
    provider.recognitions[0] = null;
    provider.startInstance(0);
    const newRec = instances[instances.length - 1];
    expect(newRec).not.toBe(oldRec);

    // 旧インスタンスのonresultが発火しても結果は通知されない
    oldRec.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'ゴミデータ' } }]
    });
    expect(onResult).not.toHaveBeenCalled();

    // 新インスタンスのonresultは正常に通知される
    newRec.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: '正常データ' } }]
    });
    expect(onResult).toHaveBeenCalledWith('正常データ');
  });

  it('fallbackToCloud() 後に旧インスタンスのonendでゴーストが生成されない', async () => {
    settings.useLocalModel = true;
    provider = new BrowserSttProvider(settings);
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;

    // インスタンス0開始
    instances[0].onstart();

    // インスタンス0で最終結果 → preStartNextInstance → インスタンス1開始
    instances[0].onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'テスト' } }]
    });
    expect(instances.length).toBe(2);

    // インスタンス0終了 → activeIndex = 1 に切り替え
    instances[0].onend();

    // インスタンス1でエラー発生 → フォールバック (index=1から)
    instances[1].onerror({ error: 'not-allowed' });

    const countAfterFallback = instances.length;
    expect(countAfterFallback).toBeGreaterThanOrEqual(3);

    // 旧インスタンス1のonendが発火してもゴーストが生成されないこと
    instances[1].onend();
    expect(instances.length).toBe(countAfterFallback);
  });

  it('fallbackToCloud のエラーメッセージに理由が含まれる', async () => {
    settings.useLocalModel = true;
    provider = new BrowserSttProvider(settings);
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onerror({ error: 'not-allowed' });

    expect(onError).toHaveBeenCalled();
    const errorMessage = onError.mock.calls[0][0].message;
    expect(errorMessage).toContain('not-allowed');
  });

  it('stop() で全インスタンスが停止する', async () => {
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances.length).toBe(1);

    await provider.stop();
    // stop後にonendが呼ばれても再起動しない
    instances[0].onend();
    // 新しいインスタンスは作成されない
    expect(instances.length).toBe(1);
  });
});
