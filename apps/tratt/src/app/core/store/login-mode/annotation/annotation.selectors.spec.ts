import { describe, expect, it } from '@jest/globals';
import { LoginMode } from '../../index';
import {
  selectActiveAnnotation,
  selectAllBundleSummaries,
  selectSelectedBundleId,
} from './annotation.selectors';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from './local-bundle-collection';
import { SessionFile } from '../../../obj/SessionFile';

describe('selectActiveAnnotation', () => {
  it('LOCAL mode: resolves through the bundle collection to the flat AnnotationState', () => {
    const fakeAnnotation = {
      savingNeeded: true,
      bundleId: DEFAULT_BUNDLE_ID,
    } as any;
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
        {} as any,
        {
          bundles: localBundleAdapter.getInitialState(),
          selectedBundleId: DEFAULT_BUNDLE_ID,
        },
        {} as any,
      ),
    ).toBe(fakeOnline);
  });
});

describe('selectSelectedBundleId', () => {
  it("reads local mode's selectedBundleId", () => {
    const state = {
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.getInitialState(),
        selectedBundleId: 'some-bundle-id',
      },
      onlineMode: {},
      demoMode: {},
      urlMode: {},
    } as any;

    expect(selectSelectedBundleId.projector(state.localMode)).toBe(
      'some-bundle-id',
    );
  });
});

describe('selectAllBundleSummaries', () => {
  it('returns a summary per bundle with correct selected flags', () => {
    const bundleA = {
      bundleId: 'bundle-a',
      sessionFile: new SessionFile('a.wav', 1, new Date(), 'audio/wav'),
    } as any;
    const bundleB = {
      bundleId: 'bundle-b',
      sessionFile: new SessionFile('b.wav', 2, new Date(), 'audio/wav'),
    } as any;
    const local = {
      bundles: localBundleAdapter.setAll(
        [bundleA, bundleB],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'bundle-b',
    };

    expect(selectAllBundleSummaries.projector(local)).toEqual([
      { bundleId: 'bundle-a', name: 'a.wav', selected: false },
      { bundleId: 'bundle-b', name: 'b.wav', selected: true },
    ]);
  });
});
