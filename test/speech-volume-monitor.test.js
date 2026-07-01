import { describe, expect, it } from 'vitest';
import { SpeechVolumeMonitor } from '../src/speech-volume-monitor.js';

describe('SpeechVolumeMonitor', () => {
  it('認識音量ゲート無効時はマイク監視なしで認識結果を通す', async () => {
    const monitor = new SpeechVolumeMonitor({
      recognitionVolumeThreshold: 0
    });

    await monitor.start();

    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(monitor.hasRecentTargetSpeech()).toBe(true);
    expect(monitor.consumeRecentTargetSpeech()).toBe(true);
  });
});
