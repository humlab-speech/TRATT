import { describe, it, expect } from '@jest/globals';
import { selectActiveAnnotation } from './annotation.selectors';
import { LoginMode } from '../../index';
import { localBundleAdapter, DEFAULT_BUNDLE_ID } from './local-bundle-collection';

describe('selectActiveAnnotation', () => {
  it('LOCAL mode: resolves through the bundle collection to the flat AnnotationState', () => {
    const fakeAnnotation = { savingNeeded: true } as any;
    const state = {
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.setOne(
          fakeAnnotation,
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      },
      onlineMode: {},
      demoMode: {},
      urlMode: {},
    } as any;

    expect(
      selectActiveAnnotation.projector(
        LoginMode.LOCAL,
        state.onlineMode,
        state.demoMode,
        state.localMode,
        state.urlMode,
      ),
    ).toBe(fakeAnnotation);
  });

  it('ONLINE mode: unchanged, returns the flat slice directly', () => {
    const fakeOnline = { savingNeeded: false } as any;
    expect(
      selectActiveAnnotation.projector(
        LoginMode.ONLINE,
        fakeOnline,
        {},
        {
          bundles: localBundleAdapter.getInitialState(),
          selectedBundleId: DEFAULT_BUNDLE_ID,
        },
        {},
      ),
    ).toBe(fakeOnline);
  });
});
