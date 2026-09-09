// @vitest-environment jsdom
//
// This spec touches `window.AudioContext` (initAudioContext() reads it off
// `window`) — the rest of this lib's suite runs in vitest's default 'node'
// environment (see vite.config.ts); this docblock comment overrides the
// environment for just this file, same pattern as
// audio-viewer-renderer.service.spec.ts in ngx-components.
//
// jsdom does not implement AudioContext at all, so we polyfill it locally,
// scoped to this file only, the same way authentication.effects.spec.ts
// polyfills BroadcastChannel/crypto.randomUUID.
import { describe, expect, it, vi } from 'vitest';
import { PlayBackStatus } from '@tratt/media';
import { HtmlAudioMechanism } from './html-audio-mechanism';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'running' | 'closed' = 'running';
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  close = vi.fn(() => {
    this.state = 'closed';
    return Promise.resolve();
  });
  resume = vi.fn(() => Promise.resolve());
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
}

describe('AudioMechanism.initAudioContext reuses an open context (B1)', () => {
  it('does not leak a second AudioContext when called twice in a row', () => {
    FakeAudioContext.instances = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    const mechanism = new HtmlAudioMechanism();

    (mechanism as any).initAudioContext();
    (mechanism as any).initAudioContext();

    const openInstances = FakeAudioContext.instances.filter(
      (i) => i.state !== 'closed',
    );
    expect(openInstances.length).toBe(1);
  });

  it('does create a fresh context if the previous one was closed', () => {
    FakeAudioContext.instances = [];
    (globalThis as any).AudioContext = FakeAudioContext;
    const mechanism = new HtmlAudioMechanism();

    (mechanism as any).initAudioContext();
    (mechanism as any)._audioContext.state = 'closed';
    (mechanism as any).initAudioContext();

    expect(FakeAudioContext.instances.length).toBe(2);
  });
});

describe('HtmlAudioMechanism.initPlayback unsubscribes the prior end-checker (C3)', () => {
  it('closes the first _playbackEndChecker subscription when canplay re-fires', () => {
    const mechanism = new HtmlAudioMechanism();
    // Satisfy initPlayback's guards without going through the full play() flow.
    (mechanism as any)._audio = {};
    (mechanism as any).audioSelection = { duration: { unix: 10000 } };
    (mechanism as any)._playbackRate = 1;

    (mechanism as any).initPlayback();
    const firstChecker = (mechanism as any)._playbackEndChecker;
    expect(firstChecker.closed).toBe(false);

    (mechanism as any).initPlayback();

    expect(firstChecker.closed).toBe(true);
  });
});

describe('HtmlAudioMechanism.stop cancels a pending play() before canplay fires', () => {
  it('pauses the underlying audio element even when stop() is called before canplay fires (pending-play race)', async () => {
    const audioEl = document.createElement('audio');
    const pauseSpy = vi.spyOn(audioEl, 'pause').mockImplementation(() => {});
    // Simulate play() still pending: never resolves canplay, mimic browser
    // returning a play() promise that stays pending until pause() is called.
    let rejectPlay: (err: any) => void;
    const pendingPlay = new Promise((_resolve, reject) => {
      rejectPlay = reject;
    });
    // This test only exercises stop() (mechanism.play() is never called, so
    // nothing else ever attaches to this promise) — pre-attach a no-op catch
    // so rejecting it below doesn't surface as an unhandled rejection.
    pendingPlay.catch(() => {});
    vi.spyOn(audioEl, 'play').mockReturnValue(pendingPlay);

    const mechanism = new HtmlAudioMechanism();
    (mechanism as any)._audio = audioEl;
    (mechanism as any)._state = PlayBackStatus.INITIALIZED;

    // stop() while _state is still INITIALIZED (play() promise unresolved).
    const stopPromise = mechanism.stop();
    rejectPlay!(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await stopPromise;
    expect(pauseSpy).toHaveBeenCalled();
  });
});

describe('HtmlAudioMechanism.play swallows an AbortError caused by a stop()-cancelled play()', () => {
  it('resolves without surfacing an error when the native play() promise rejects with AbortError', async () => {
    const audioEl = document.createElement('audio');
    vi.spyOn(audioEl, 'play').mockImplementation(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );

    const mechanism = new HtmlAudioMechanism();
    (mechanism as any)._audio = audioEl;
    // Pre-seed a running "audio context" so play()'s super.play() and
    // afterAudioContextResumed() short-circuit their real AudioContext/
    // GainNode/MediaElementSource wiring, the same minimal-stub pattern the
    // initPlayback test above uses for _audio/_playbackRate.
    (mechanism as any)._audioContext = {
      state: 'running',
      resume: vi.fn(() => Promise.resolve()),
      createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      destination: {},
    };

    const statechangeErrorSpy = vi.spyOn(mechanism.statechange, 'error');
    const missingPermissionSpy = vi.spyOn(mechanism.missingPermission, 'next');

    const audioSelection = { start: { clone: () => ({ seconds: 0 }) } } as any;

    await expect(
      mechanism.play(
        audioSelection,
        1,
        1,
        false,
        () => {},
        () => {},
        () => {},
      ),
    ).resolves.toBeUndefined();

    // Contrast with NotAllowedError (permission denial), which SHOULD still
    // surface via missingPermission/statechange.error — AbortError must not.
    expect(missingPermissionSpy).not.toHaveBeenCalled();
    expect(statechangeErrorSpy).not.toHaveBeenCalled();
  });
});

describe('HtmlAudioMechanism.play still surfaces a NotAllowedError (pins the AbortError-only boundary)', () => {
  it('rejects and reports missingPermission/statechange.error when the native play() promise rejects with NotAllowedError', async () => {
    const audioEl = document.createElement('audio');
    vi.spyOn(audioEl, 'play').mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('permission denied'), {
          name: 'NotAllowedError',
        }),
      ),
    );

    const mechanism = new HtmlAudioMechanism();
    (mechanism as any)._audio = audioEl;
    (mechanism as any)._audioContext = {
      state: 'running',
      resume: vi.fn(() => Promise.resolve()),
      createGain: vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() })),
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      destination: {},
    };

    const statechangeErrorSpy = vi.spyOn(mechanism.statechange, 'error');
    const missingPermissionSpy = vi.spyOn(mechanism.missingPermission, 'next');

    const audioSelection = { start: { clone: () => ({ seconds: 0 }) } } as any;

    await expect(
      mechanism.play(
        audioSelection,
        1,
        1,
        false, // playOnHover: false, so the NotAllowedError branch runs
        () => {},
        () => {},
        () => {},
      ),
    ).rejects.toThrow();

    expect(missingPermissionSpy).toHaveBeenCalled();
    expect(statechangeErrorSpy).toHaveBeenCalled();
  });
});
