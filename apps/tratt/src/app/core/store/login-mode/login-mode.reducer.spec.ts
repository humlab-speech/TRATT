import { describe, expect, it } from '@jest/globals';
import { LoginMode } from '../index';
import {
  DEFAULT_BUNDLE_ID,
  LocalBundleCollectionState,
} from './annotation/local-bundle-collection';
import { LoginModeActions } from './login-mode.actions';
import { LoginModeReducers } from './login-mode.reducer';

describe('LoginModeReducers — local mode entity wrapping', () => {
  it('LOCAL mode reducer produces a LocalBundleCollectionState with one entity at DEFAULT_BUNDLE_ID', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const state = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    expect(state.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(Object.keys(state.bundles.entities)).toEqual([DEFAULT_BUNDLE_ID]);
  });

  it('LOCAL mode: dispatching an action updates the single entity, not a sibling key', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const next = reducer(
      initial as any,
      LoginModeActions.changeComment.do({
        comment: 'hello',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(
      next.bundles.entities[DEFAULT_BUNDLE_ID]?.currentSession?.comment,
    ).toBe('hello');
    expect(Object.keys(next.bundles.entities)).toEqual([DEFAULT_BUNDLE_ID]);
  });

  it('ONLINE mode reducer is completely unaffected — still produces a flat AnnotationState', () => {
    const reducer = new LoginModeReducers(LoginMode.ONLINE).create();
    const state = reducer(undefined, { type: '@@INIT' } as any);

    expect((state as any).bundles).toBeUndefined();
    expect((state as any).currentSession).toBeDefined();
  });
});
