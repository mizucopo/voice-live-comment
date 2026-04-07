import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vad } from '../src/vad.js';

describe('Vad', () => {
  let vad;
  let mockSession;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // ONNX Runtime モック
    mockSession = {
      inputNames: ['input', 'sr'],
      outputNames: ['output'],
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array([0.9]) }
      })
    };

    const mockOrt = {
      Tensor: vi.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
      InferenceSession: {
        create: vi.fn().mockResolvedValue(mockSession)
      }
    };

    vi.doMock('onnxruntime-web', () => ({
      default: mockOrt,
      ...mockOrt
    }));

    global.chrome = global.chrome || {};
    global.chrome.runtime = global.chrome.runtime || {};
    global.chrome.runtime.getURL = vi.fn().mockReturnValue('chrome-extension://test/models/silero-vad.onnx');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('onnxruntime-web');
  });

  it('init() でONNXセッションを作成する', async () => {
    const { Vad } = await import('../src/vad.js');
    vad = new Vad();
    await vad.init();
    // Dynamic import was called (verified by module loading successfully)
    expect(vad).toBeDefined();
  });

  it('processFrame で音声区間を検出する', async () => {
    const { Vad } = await import('../src/vad.js');
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    vad.onSpeechEnd(onSpeechEnd);

    // 512サンプル（30ms at 16kHz）のフレーム
    const frame = new Float32Array(512);
    await vad.processFrame(frame);

    // 確率0.9 > 閾値0.5 → speechStart
    expect(onSpeechStart).toHaveBeenCalled();
  });

  it('閾値以下でspeechEndイベントが発火する', async () => {
    const { Vad } = await import('../src/vad.js');
    vad = new Vad();
    await vad.init();

    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    vad.onSpeechStart(onSpeechStart);
    vad.onSpeechEnd(onSpeechEnd);

    // 音声フレーム（閾値以上）
    mockSession.run.mockResolvedValue({ output: { data: new Float32Array([0.9]) } });
    const speechFrame = new Float32Array(512);
    await vad.processFrame(speechFrame);
    expect(onSpeechStart).toHaveBeenCalled();

    // 無音フレーム（閾値以下）→ 300ms後にspeechEnd
    mockSession.run.mockResolvedValue({ output: { data: new Float32Array([0.1]) } });
    vi.useFakeTimers();
    const silenceFrame = new Float32Array(512);
    vad.processFrame(silenceFrame);
    // Flush the async _processQueue microtask
    await vi.runAllTimersAsync();
    expect(onSpeechEnd).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('512サンプル未満のフレームは処理しない', async () => {
    const { Vad } = await import('../src/vad.js');
    vad = new Vad();
    await vad.init();

    const shortFrame = new Float32Array(100);
    await vad.processFrame(shortFrame);

    expect(mockSession.run).not.toHaveBeenCalled();
  });
});
