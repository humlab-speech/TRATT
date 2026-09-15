import { describe, expect, it } from '@jest/globals';
import {
  AnnotationLevelType,
  IAnnotJSON,
  TrattAnnotation,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { randomUUID } from 'node:crypto';
import { SessionFile } from '../../obj/SessionFile';
import { IIDBModeOptions } from '../../shared/tratt-database';
import { LoginMode } from '../index';
import { AnnotationActions } from './annotation/annotation.actions';
import {
  DEFAULT_BUNDLE_ID,
  generateBundleId,
  localBundleAdapter,
  LocalBundleCollectionState,
} from './annotation/local-bundle-collection';
import { LoginModeActions } from './login-mode.actions';
import { LoginModeReducers } from './login-mode.reducer';

// The jsdom version bundled with jest-environment-jsdom implements
// window.crypto.getRandomValues but not crypto.randomUUID (unlike real
// browsers, which have supported it since 2022). Polyfill it with Node's
// implementation so generateBundleId can call it as it would in production.
// (Same polyfill as local-bundle-collection.spec.ts, needed here too since
// this spec now calls generateBundleId directly.)
if (
  typeof (globalThis.crypto as { randomUUID?: unknown })?.randomUUID !==
  'function'
) {
  (
    globalThis.crypto as unknown as { randomUUID: typeof randomUUID }
  ).randomUUID = randomUUID;
}

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

describe('LoginModeReducers — per-bundle undo isolation', () => {
  // Deviation from the task brief's literal test sketch: `changeComment.do` is
  // NOT in login-mode.reducer.ts's `undoRedo({ allowedActionTypes: [...] })`
  // list (only the AnnotationActions.* level/item-editing actions are), so an
  // UNDO after a changeComment is a no-op — asserting on undone comments would
  // be vacuous. `addAnnotationLevel.do` IS in `allowedActionTypes`, so it's
  // used here as the actual undo-tracked edit. `changeComment.do` is kept
  // alongside it purely as an independent isolation marker (untouched by
  // undo either way) to also prove ordinary per-bundle field isolation, as
  // the two earlier tests in this file already do for a single entity.
  const audioDuration = new SampleUnit(48000, 48000);
  const addLevel = (mode: LoginMode) =>
    AnnotationActions.addAnnotationLevel.do({
      levelType: AnnotationLevelType.SEGMENT,
      audioDuration,
      mode,
    });

  it('editing bundle A, editing bundle B, then undoing while B is selected does not affect A', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();

    // Bootstrap bundle A as the initial entity (step 2.1/2.2 Task 1 behavior).
    let state = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const bundleAId = state.selectedBundleId; // DEFAULT_BUNDLE_ID today

    // Edit A: an undo-tracked structural edit (adds a transcript level) plus
    // a comment change as an independent isolation marker.
    state = reducer(
      state as any,
      addLevel(LoginMode.LOCAL),
    ) as unknown as LocalBundleCollectionState;
    state = reducer(
      state as any,
      LoginModeActions.changeComment.do({
        comment: 'comment on A',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;
    expect(state.bundles.entities[bundleAId]?.transcript.levels.length).toBe(1);
    expect(state.bundles.entities[bundleAId]?.currentSession?.comment).toBe(
      'comment on A',
    );

    // Manually introduce a second bundle B by cloning a fresh initial inner
    // AnnotationState (complete with its own empty ngrx-wieder `histories`)
    // under a new id, and switch selection to it — there is no "create bundle"
    // action yet (that's step 2.7); this directly exercises the
    // reducer/adapter machinery Task 1 built.
    //
    // Note: LoginModeReducers(LOCAL).create() returns the *wrapped*
    // LocalBundleCollectionState reducer (per Task 1), not a bare
    // AnnotationState reducer — so the fresh inner entity has to be pulled
    // back out of that collection's single bootstrap entity, not used as-is.
    const bundleBId = generateBundleId();
    const freshCollectionState = new LoginModeReducers(
      LoginMode.LOCAL,
    ).create()(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const freshInner =
      freshCollectionState.bundles.entities[
        freshCollectionState.selectedBundleId
      ];
    state = {
      bundles: localBundleAdapter.setOne(
        { ...(freshInner as any), bundleId: bundleBId },
        state.bundles,
      ),
      selectedBundleId: bundleBId,
    };

    // Edit B: same kind of undo-tracked structural edit plus its own comment.
    state = reducer(
      state as any,
      addLevel(LoginMode.LOCAL),
    ) as unknown as LocalBundleCollectionState;
    state = reducer(
      state as any,
      LoginModeActions.changeComment.do({
        comment: 'comment on B',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;
    expect(state.bundles.entities[bundleBId]?.transcript.levels.length).toBe(1);
    expect(state.bundles.entities[bundleBId]?.currentSession?.comment).toBe(
      'comment on B',
    );
    // A must be completely untouched by B's edits.
    expect(state.bundles.entities[bundleAId]?.transcript.levels.length).toBe(1);
    expect(state.bundles.entities[bundleAId]?.currentSession?.comment).toBe(
      'comment on A',
    );

    // Undo while B is selected. ngrx-wieder's undoRedo() defaults
    // `undoActionType` to the literal string 'UNDO' (see
    // node_modules/ngrx-wieder/fesm2022/ngrx-wieder.mjs's defaultConfig),
    // and login-mode.reducer.ts's undoRedo({...}) call does not override it,
    // so dispatching { type: 'UNDO' } is the correct trigger.
    state = reducer(
      state as any,
      {
        type: 'UNDO',
      } as any,
    ) as unknown as LocalBundleCollectionState;

    // B's structural edit is undone (its added level is gone).
    expect(state.bundles.entities[bundleBId]?.transcript.levels.length).toBe(0);
    // A is STILL untouched — this is the critical assertion the plan's risk
    // register demanded: undoing B's history must not reach into A's state.
    expect(state.bundles.entities[bundleAId]?.transcript.levels.length).toBe(1);
    expect(state.bundles.entities[bundleAId]?.currentSession?.comment).toBe(
      'comment on A',
    );
  });
});

describe('LoginModeReducers — createBundle / selectBundle', () => {
  const sessionFile = new SessionFile('b2.wav', 123, new Date(), 'audio/wav');

  it('createBundle adds a new entity, leaves the existing one untouched, and selects the new one', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const next = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b2']?.sessionFile).toBe(sessionFile);
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      initial.bundles.entities[DEFAULT_BUNDLE_ID],
    );
    expect(next.selectedBundleId).toBe('b2');
  });

  it('selectBundle switches selectedBundleId back to an existing entity without altering either entity', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      withB2 as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      withB2.bundles.entities[DEFAULT_BUNDLE_ID],
    );
    expect(next.bundles.entities['b2']).toBe(withB2.bundles.entities['b2']);
  });

  it('selectBundle is a no-op when the target bundle does not exist', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const next = reducer(
      initial as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'does-not-exist',
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(initial.selectedBundleId);
    expect(next).toBe(initial);
  });

  it('an unrelated action still writes through to whichever bundle is currently selected', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      withB2 as any,
      LoginModeActions.changeComment.do({
        comment: 'hello b2',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b2']?.currentSession?.comment).toBe(
      'hello b2',
    );
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      withB2.bundles.entities[DEFAULT_BUNDLE_ID],
    );
  });
});

describe('LoginModeReducers — createBundle with restored content (step 2.8)', () => {
  const sessionFile = new SessionFile('b2.wav', 123, new Date(), 'audio/wav');

  it("createBundle with restoredOptions routes the value through writeOptionToStore's field mapping, leaving everything else at initialInner", () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const restoredOptions: IIDBModeOptions = { comment: 'hello' };

    const next = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
        restoredOptions,
      }),
    ) as unknown as LocalBundleCollectionState;

    const entity = next.bundles.entities['b2'];
    const initialInner = initial.bundles.entities[DEFAULT_BUNDLE_ID];

    // The mapped field landed exactly where writeOptionToStore's 'comment'
    // case puts it.
    expect(entity?.currentSession?.comment).toBe('hello');
    // Everything else still matches the fresh initialInner entity — no
    // reimplementation/shortcut bypassing writeOptionToStore's mapping.
    expect(entity?.transcript).toEqual(initialInner?.transcript);
    expect(entity?.importOptions).toEqual(initialInner?.importOptions);
    expect(entity?.importConverter).toEqual(initialInner?.importConverter);
    expect(entity?.previousSession).toEqual(initialInner?.previousSession);
    // Explicit params still win over anything restoredOptions could imply.
    expect(entity?.bundleId).toBe('b2');
    expect(entity?.sessionFile).toBe(sessionFile);
  });

  it('createBundle with restoredAnnotation produces a real deserialized TrattAnnotation, not the raw JSON', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const restoredAnnotation: IAnnotJSON = {
      name: 'restored',
      annotates: 'b2.wav',
      sampleRate: 16000,
      levels: [],
      links: [],
    };

    const next = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
        restoredAnnotation,
      }),
    ) as unknown as LocalBundleCollectionState;

    const entity = next.bundles.entities['b2'];

    expect(entity?.transcript).toBeInstanceOf(TrattAnnotation);
    expect(entity?.transcript).not.toBe(restoredAnnotation);
    expect(entity?.transcript?.levels).toEqual([]);
  });

  it('createBundle with neither restoredOptions nor restoredAnnotation (step 2.7 usage) still produces exactly the same result as before this task', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const next = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b2']?.sessionFile).toBe(sessionFile);
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      initial.bundles.entities[DEFAULT_BUNDLE_ID],
    );
    expect(next.selectedBundleId).toBe('b2');
  });
});
