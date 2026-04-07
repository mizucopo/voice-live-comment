import { describe, it, expect, vi } from 'vitest';
import { SttProvider } from '../../src/stt/stt-provider.js';

class ConcreteProvider extends SttProvider {
  async start() {}
  async stop() {}
}

describe('SttProvider', () => {
  it('onResult / onError コールバックを登録できる', () => {
    const provider = new ConcreteProvider();
    const onResult = vi.fn();
    const onError = vi.fn();
    provider.onResult(onResult);
    provider.onError(onError);
    provider._emitResult('hello');
    provider._emitError(new Error('test'));
    expect(onResult).toHaveBeenCalledWith('hello');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('sendAudio はデフォルトでno-op', async () => {
    const provider = new ConcreteProvider();
    await expect(provider.sendAudio(new Blob())).resolves.toBeUndefined();
  });

  it('start / stop は基底クラスでErrorをthrow', async () => {
    const provider = new SttProvider();
    await expect(provider.start()).rejects.toThrow('start() must be implemented');
    await expect(provider.stop()).rejects.toThrow('stop() must be implemented');
  });
});
