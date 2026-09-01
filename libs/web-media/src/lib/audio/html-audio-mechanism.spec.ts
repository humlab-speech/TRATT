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
