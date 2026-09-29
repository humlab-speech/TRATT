import { describe, it, expect } from '@jest/globals';
import { computeAudioEnvelope } from './audio-envelope';

describe('computeAudioEnvelope', () => {
  it('produces columns*2 interleaved min/max values, within [-1, 1]', async () => {
    const channel = new Float32Array(16000); // 1s of "audio" at 16kHz
    for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.sin((i / channel.length) * Math.PI * 4) * 0.8;
    }

    const envelope = await computeAudioEnvelope(channel, 100);

    expect(envelope.columns).toBe(100);
    expect(envelope.minMax.length).toBe(200);
    for (const v of envelope.minMax) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('defaults to 4000 columns when not specified', async () => {
    const channel = new Float32Array(8000).fill(0.1);
    const envelope = await computeAudioEnvelope(channel);
    expect(envelope.columns).toBe(4000);
    expect(envelope.minMax.length).toBe(8000);
  });

  it('handles a channel shorter than the requested column count without throwing', async () => {
    const channel = new Float32Array(10).fill(0.5);
    const envelope = await computeAudioEnvelope(channel, 4000);
    expect(envelope.columns).toBe(4000);
    expect(envelope.minMax.length).toBe(8000);
  });
});
