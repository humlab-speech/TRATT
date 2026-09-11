import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
  resolveLocalBundleState,
  LocalBundleCollectionState,
} from './local-bundle-collection';
import { AnnotationState } from './index';

describe('local-bundle-collection', () => {
  it('resolveLocalBundleState returns the entity at selectedBundleId', () => {
    const fakeAnnotationState = {
      savingNeeded: true,
    } as unknown as AnnotationState;
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

  it('localBundleAdapter.setOne always writes to DEFAULT_BUNDLE_ID regardless of input', () => {
    const a = { savingNeeded: true } as unknown as AnnotationState;
    const b = { savingNeeded: false } as unknown as AnnotationState;
    let bundles = localBundleAdapter.setOne(
      a,
      localBundleAdapter.getInitialState(),
    );
    bundles = localBundleAdapter.setOne(b, bundles);
    expect(Object.keys(bundles.entities)).toEqual([DEFAULT_BUNDLE_ID]);
    expect(bundles.entities[DEFAULT_BUNDLE_ID]).toBe(b);
  });
});
