import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserSttProvider } from '../../src/stt/browser-stt-provider.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('BrowserSttProvider', () => {
  let provider;
  let settings;
  let monitorInstances;

  class FakeSpeechVolumeMonitor {
    constructor(options) {
      this.options = options;
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.hasRecentTargetSpeech = vi.fn().mockReturnValue(true);
      this.consumeRecentTargetSpeech = vi.fn().mockReturnValue(true);
      monitorInstances.push(this);
    }
  }

  function createProvider() {
    return new BrowserSttProvider(settings, {
      SpeechVolumeMonitorClass: FakeSpeechVolumeMonitor
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.MockSpeechRecognition._instances.length = 0;
    global.MockSpeechRecognition._startShouldThrow = null;
    monitorInstances = [];

    settings = {
      language: 'ja-JP',
      useLocalModel: false,
      boostPhrases: [],
      recognitionVolumeThreshold: 0.08
    };
    provider = createProvider();
  });

  it('start() でSpeechRecognitionインスタンスを1つ作成する', async () => {
    await provider.start();
    expect(global.webkitSpeechRecognition).toHaveBeenCalled();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances.length).toBe(1);
  });

  it('start() で言語設定が反映される', async () => {
    settings.language = 'en-US';
    provider = createProvider();
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances[0].lang).toBe('en-US');
  });

  it('useLocalModel=true でprocessLocallyが設定される', async () => {
    settings.useLocalModel = true;
    provider = createProvider();
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances[0].processLocally).toBe(true);
  });

  it('start() で音量監視を開始する', async () => {
    settings.recognitionVolumeThreshold = 0.12;
    provider = createProvider();

    await provider.start();

    expect(monitorInstances[0].options).toEqual({ recognitionVolumeThreshold: 0.12 });
    expect(monitorInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it('音量監視の開始中にstopされたらSpeechRecognitionを開始しない', async () => {
    const monitorStart = createDeferred();

    class SlowSpeechVolumeMonitor {
      constructor() {
        this.start = vi.fn().mockReturnValue(monitorStart.promise);
        this.stop = vi.fn().mockResolvedValue(undefined);
        this.consumeRecentTargetSpeech = vi.fn().mockReturnValue(true);
        monitorInstances.push(this);
      }
    }

    provider = new BrowserSttProvider(settings, {
      SpeechVolumeMonitorClass: SlowSpeechVolumeMonitor
    });

    const startPromise = provider.start();
    await Promise.resolve();

    expect(monitorInstances[0].start).toHaveBeenCalledTimes(1);

    const stopPromise = provider.stop();
    monitorStart.resolve();
    await startPromise;
    await stopPromise;

    expect(global.webkitSpeechRecognition).not.toHaveBeenCalled();
    expect(monitorInstances[0].stop).toHaveBeenCalledTimes(1);
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

  it('認識対象発話が直近にない結果は通知しない', async () => {
    const onResult = vi.fn();
    provider.onResult(onResult);
    await provider.start();
    monitorInstances[0].consumeRecentTargetSpeech.mockReturnValue(false);

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: 'ボソボソ' } }
      ]
    });

    expect(onResult).not.toHaveBeenCalled();
  });

  it('認識結果を通知したら認識対象発話を消費する', async () => {
    const onResult = vi.fn();
    provider.onResult(onResult);
    await provider.start();
    monitorInstances[0].consumeRecentTargetSpeech
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: 'しっかり発話' } }
      ]
    });
    instances[0].onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: 'ボソボソ' } }
      ]
    });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('しっかり発話');
    expect(monitorInstances[0].consumeRecentTargetSpeech).toHaveBeenCalledTimes(2);
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
    provider = createProvider();
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
    provider = createProvider();
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
    provider = createProvider();
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onerror({ error: 'not-allowed' });

    expect(onError).toHaveBeenCalled();
    const errorMessage = onError.mock.calls[0][0].message;
    expect(errorMessage).toContain('not-allowed');
  });

  it('stop() 後の aborted エラーは通知されない', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();

    await provider.stop();
    instances[0].onerror({ error: 'aborted' });

    expect(onError).not.toHaveBeenCalled();
  });

  it('startInstance による差し替え後の旧インスタンスの aborted は通知されない', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();
    const oldRec = instances[0];

    provider.startInstance(0);

    oldRec.onerror({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('fallbackToCloud 後の旧インスタンスの aborted は通知されない', async () => {
    settings.useLocalModel = true;
    provider = createProvider();
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();

    // preStartNextInstance → instances[1] 作成
    instances[0].onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'テスト' } }]
    });
    expect(instances.length).toBe(2);

    // instances[0] 終了 → activeIndex = 1
    instances[0].onend();

    // instances[1] でエラー → fallbackToCloud
    instances[1].onerror({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledTimes(1);

    // fallbackToCloud で stop() された旧インスタンスの aborted
    instances[1].onerror({ error: 'aborted' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stop() 中に同期的に発火する aborted エラーは通知されない', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();
    const rec = instances[0];
    rec.stop = () => { rec.onerror({ error: 'aborted' }); };

    await provider.stop();
    expect(onError).not.toHaveBeenCalled();
  });

  it('startInstance() 中に同期的に発火する aborted エラーは通知されない', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();
    const oldRec = instances[0];
    oldRec.stop = () => { oldRec.onerror({ error: 'aborted' }); };

    provider.startInstance(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fallbackToCloud() 中に同期的に発火する aborted エラーは通知されない', async () => {
    settings.useLocalModel = true;
    provider = createProvider();
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();

    // preStartNextInstance → instances[1] 作成
    instances[0].onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'テスト' } }]
    });
    expect(instances.length).toBe(2);

    // instances[0] 終了 → activeIndex = 1
    instances[0].onend();

    // instances[1].stop を同期 onerror 発火に上書き
    instances[1].stop = () => { instances[1].onerror({ error: 'aborted' }); };

    // instances[1] でエラー → fallbackToCloud（内部で stop() が同期 onerror を発火）
    instances[1].onerror({ error: 'not-allowed' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('no-speech エラーは通知されず認識が再起動する', async () => {
    const onError = vi.fn();
    provider.onError(onError);
    await provider.start();

    const instances = global.MockSpeechRecognition._instances;
    instances[0].onstart();

    instances[0].onerror({ error: 'no-speech' });
    expect(onError).not.toHaveBeenCalled();

    instances[0].onend();
    expect(instances.length).toBe(2);
  });

  it('stop() で全インスタンスが停止する', async () => {
    await provider.start();
    const instances = global.MockSpeechRecognition._instances;
    expect(instances.length).toBe(1);

    await provider.stop();
    expect(monitorInstances[0].stop).toHaveBeenCalledTimes(1);
    // stop後にonendが呼ばれても再起動しない
    instances[0].onend();
    // 新しいインスタンスは作成されない
    expect(instances.length).toBe(1);
  });
});
