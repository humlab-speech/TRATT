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
  constructor(_url: string) {}
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
