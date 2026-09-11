import { describe, it, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_BUNDLE_ID,
  generateBundleId,
  IdentifiedAnnotationState,
  localBundleAdapter,
  resolveLocalBundleState,
  LocalBundleCollectionState,
} from './local-bundle-collection';

// The jsdom version bundled with jest-environment-jsdom implements
// window.crypto.getRandomValues but not crypto.randomUUID (unlike real
// browsers, which have supported it since 2022). Polyfill it with Node's
// implementation so generateBundleId can call it as it would in production.
if (typeof (globalThis.crypto as { randomUUID?: unknown })?.randomUUID !== 'function') {
  (
    globalThis.crypto as unknown as { randomUUID: typeof randomUUID }
  ).randomUUID = randomUUID;
}

describe('local-bundle-collection', () => {
  it('resolveLocalBundleState returns the entity at selectedBundleId', () => {
    const fakeAnnotationState = {
      savingNeeded: true,
      bundleId: DEFAULT_BUNDLE_ID,
    } as unknown as IdentifiedAnnotationState;
    const state: LocalBundleCollectionState = {
      bundles: localBundleAdapter.setOne(
        fakeAnnotationState,
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };

    expect(resolveLocalBundleState(state)).toBe(fakeAnnotationState);
  });

  it('resolveLocalBundleState returns undefined for undefined state', () => {
    expect(resolveLocalBundleState(undefined)).toBeUndefined();
  });

  it('resolveLocalBundleState returns undefined when no entity is stored at selectedBundleId', () => {
    const state: LocalBundleCollectionState = {
      bundles: localBundleAdapter.getInitialState(),
      selectedBundleId: DEFAULT_BUNDLE_ID,
    };
    expect(resolveLocalBundleState(state)).toBeUndefined();
  });

  it('generateBundleId produces distinct ids on successive calls', () => {
    const a = generateBundleId();
    const b = generateBundleId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('localBundleAdapter stores two distinct entities at their own bundleId keys', () => {
    const a = {
      savingNeeded: true,
      bundleId: 'bundle-a',
    } as unknown as IdentifiedAnnotationState;
    const b = {
      savingNeeded: false,
      bundleId: 'bundle-b',
    } as unknown as IdentifiedAnnotationState;

    let bundles = localBundleAdapter.setOne(a, localBundleAdapter.getInitialState());
    bundles = localBundleAdapter.setOne(b, bundles);

    expect(Object.keys(bundles.entities).sort()).toEqual(['bundle-a', 'bundle-b']);
    expect(bundles.entities['bundle-a']).toBe(a);
    expect(bundles.entities['bundle-b']).toBe(b);
  });
});
