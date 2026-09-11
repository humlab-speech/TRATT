import { describe, expect, it } from '@jest/globals';
import { getModeState, LoginMode, RootState } from './index';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from './login-mode/annotation/local-bundle-collection';

describe('getModeState', () => {
  it('LOCAL mode: resolves the flat AnnotationState from the entity collection', () => {
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
    } as unknown as RootState;

    expect(getModeState(state)).toBe(fakeAnnotation);
  });

  it('ONLINE mode: unchanged, returns the flat onlineMode slice directly', () => {
    const fakeOnline = { savingNeeded: false } as any;
    const state = {
      application: { mode: LoginMode.ONLINE },
      onlineMode: fakeOnline,
    } as unknown as RootState;

    expect(getModeState(state)).toBe(fakeOnline);
  });
});
