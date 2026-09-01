// @vitest-environment jsdom
//
// AudioDecoder's constructor (before the fix) reads `window.AudioContext`,
// and its real constructor also spins up TsWorker instances, which need
// `URL.createObjectURL` and a `Worker` constructor — none of which jsdom
// implements. Both are polyfilled locally below, scoped to this file only,
// the same pattern as the AudioContext polyfill in
// html-audio-mechanism.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { AudioDecoder } from './audio-decoder';

class FakeWorker {
  onmessage: ((ev: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(_url: string) {
    /* noop */
  }
}

(globalThis as any).Worker = FakeWorker;
(globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:fake');

describe('AudioDecoder does not create an unused AudioContext (B1)', () => {
  it('never constructs an AudioContext', () => {
    const ctorSpy = vi.fn();
    class SpyAudioContext {
      constructor() {
        ctorSpy();
      }
    }
    (globalThis as any).AudioContext = SpyAudioContext;

    new AudioDecoder(
      'wav' as any,
      { sampleRate: 48000, duration: { samples: 100 } } as any,
      new ArrayBuffer(8),
    );

    expect(ctorSpy).not.toHaveBeenCalled();
  });
});

describe('AudioDecoder 8-bit WAV decoding (B9)', () => {
  it('decodes 8-bit silence (byte value 128) to near-zero, not an alternating square wave', async () => {
    // Create 8-bit silence data: 128 for each byte (silence midpoint in unsigned)
    const silenceData = new Uint8Array(100).fill(128);

    const decoder = new AudioDecoder(
      'wav' as any,
      { sampleRate: 48000, duration: { samples: 100 } } as any,
      new ArrayBuffer(8),
    );

    // Call the private getChannelData method
    const channelData = await (decoder as any).getChannelData(
      silenceData,
      100,
      8, // 8-bit per sample
    );

    // Silence should decode to near-zero, not alternating ±0.5
    const tolerance = 0.01;
    for (let i = 0; i < channelData.length; i++) {
      expect(Math.abs(channelData[i])).toBeLessThan(tolerance);
    }
  });
});
