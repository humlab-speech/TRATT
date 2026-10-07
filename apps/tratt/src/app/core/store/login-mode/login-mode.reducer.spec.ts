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

  it('setBundleTranscript writes to the NAMED bundle, not the selected one', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const withTwo = reducer(
      reducer(undefined, { type: '@@INIT' } as any) as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        sessionFile: new SessionFile(
          'b.wav',
          2,
          new Date(2024, 0, 1),
          'audio/wav',
        ),
      }),
    ) as unknown as LocalBundleCollectionState;
    // createBundle selects the new bundle; select bundle-1 back so the
    // target of this write is explicitly NOT the selected bundle.
    const selectedIsOne = reducer(
      withTwo as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
      }),
    ) as unknown as LocalBundleCollectionState;
    const transcript = { marker: 'queued-result' } as any;

    const state = reducer(
      selectedIsOne as any,
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        transcript,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(state.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(state.bundles.entities['bundle-2']!.transcript).toBe(transcript);
    expect(state.bundles.entities[DEFAULT_BUNDLE_ID]!.transcript).not.toBe(
      transcript,
    );
    // Stronger than the transcript-only check above: the selected bundle's
    // entity is the exact same object reference post-write, not merely a
    // different transcript — proving nothing about it was touched at all.
    expect(state.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      selectedIsOne.bundles.entities[DEFAULT_BUNDLE_ID],
    );
  });

  it('setBundleTranscript clears the bundle undo history (no Ctrl+Z to the pre-run transcript)', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const init = reducer(undefined, { type: '@@INIT' } as any) as any;
    const seeded = {
      ...init,
      bundles: localBundleAdapter.updateOne(
        {
          id: DEFAULT_BUNDLE_ID,
          changes: { histories: { x: { past: [1] } } as any },
        },
        init.bundles,
      ),
    };
    const state = reducer(
      seeded,
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
        transcript: { marker: 'rerun' } as any,
      }),
    ) as unknown as LocalBundleCollectionState;
    expect(state.bundles.entities[DEFAULT_BUNDLE_ID]!.histories).toEqual({});
  });

  it('setBundleTranscript is a no-op for a bundle id that does not exist', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const before = reducer(undefined, { type: '@@INIT' } as any);
    const state = reducer(
      before as any,
      LoginModeActions.setBundleTranscript({
        mode: LoginMode.LOCAL,
        bundleId: 'ghost',
        transcript: {} as any,
      }),
    );
    expect(state).toBe(before);
  });

  it('createBundle leaves selectedBundleId unchanged when selectAfterCreate is false', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const seeded = reducer(undefined, {
      type: '@ngrx/store/init',
    } as any) as unknown as LocalBundleCollectionState;

    const result = reducer(
      seeded as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        sessionFile: new SessionFile('b.wav', 1, new Date(), 'audio/wav'),
        selectAfterCreate: false,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(result.selectedBundleId).toBe(seeded.selectedBundleId);
    expect(result.bundles.entities['bundle-2']).toBeDefined();
  });

  it('createBundle still selects the new bundle when selectAfterCreate is omitted (existing behaviour)', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const seeded = reducer(undefined, {
      type: '@ngrx/store/init',
    } as any) as unknown as LocalBundleCollectionState;

    const result = reducer(
      seeded as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-2',
        sessionFile: new SessionFile('b.wav', 1, new Date(), 'audio/wav'),
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(result.selectedBundleId).toBe('bundle-2');
  });
});

describe('LoginModeReducers — removeBundles', () => {
  const sessionFile = new SessionFile('b2.wav', 123, new Date(), 'audio/wav');

  it('removes the given bundles and leaves the rest untouched', () => {
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
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [DEFAULT_BUNDLE_ID],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBeUndefined();
    expect(next.bundles.entities['b2']).toBe(withB2.bundles.entities['b2']);
  });

  it('reselects a remaining bundle when the selected one is removed', () => {
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
    // createBundle selects the new bundle — confirm the starting point.
    expect(withB2.selectedBundleId).toBe('b2');

    const next = reducer(
      withB2 as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: ['b2'],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
  });

  it('never leaves the collection empty — removing every bundle restores the default sentinel', () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const next = reducer(
      initial as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [DEFAULT_BUNDLE_ID],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.ids.length).toBe(1);
    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(
      next.bundles.entities[DEFAULT_BUNDLE_ID]?.sessionFile,
    ).toBeUndefined();
  });

  it('removing a non-selected bundle leaves selectedBundleId untouched', () => {
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
    const reselected = reducer(
      withB2 as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: DEFAULT_BUNDLE_ID,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      reselected as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: ['b2'],
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe(DEFAULT_BUNDLE_ID);
    expect(next.bundles.entities['b2']).toBeUndefined();
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

  it("Minor 2: createBundle with BOTH restoredOptions and restoredAnnotation set (BundleRestoreEffects' actual shape) applies both independently", () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;

    const restoredOptions: IIDBModeOptions = { comment: 'hello' };
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
        restoredOptions,
        restoredAnnotation,
      }),
    ) as unknown as LocalBundleCollectionState;

    const entity = next.bundles.entities['b2'];

    // writeOptionToStore's mapping still applied...
    expect(entity?.currentSession?.comment).toBe('hello');
    // ...and the annotation-deserialize block still applied — the two code
    // paths are structurally independent (writeOptionToStore never touches
    // .transcript; the annotation-deserialize block touches nothing else).
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

// Regression (workbench, manual testing): the login chain writes guidelines,
// project config and task into the bundle selected at that moment only. A
// second file opened without them — the 2D editor's segment popup threw on
// `guidelines!.selected!` and the overview listed no transcription units.
describe('LoginModeReducers — session scope is shared across bundles', () => {
  const sessionFile = new SessionFile('b2.wav', 123, new Date(), 'audio/wav');
  const selectedGuidelines = {
    filename: 'guidelines_en.json',
    json: { markers: [{ type: 'break', code: '<P>' }] },
  };
  const startSuccess = () =>
    LoginModeActions.startAnnotation.success({
      mode: LoginMode.LOCAL,
      project: { id: '7329', name: 'Local' } as any,
      task: { id: '1', status: 'BUSY' } as any,
      projectSettings: { logging: {} } as any,
      guidelines: [selectedGuidelines] as any,
      selectedGuidelines: selectedGuidelines as any,
    });
  const init = () => {
    const reducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const initial = reducer(undefined, {
      type: '@@INIT',
    } as any) as unknown as LocalBundleCollectionState;
    return { reducer, initial };
  };

  it('startAnnotation.success on the selected bundle propagates guidelines, project config and task to every other bundle', () => {
    const { reducer, initial } = init();
    const withB2 = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
        selectAfterCreate: false,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      withB2 as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;

    const selected = next.bundles.entities[DEFAULT_BUNDLE_ID]!;
    const sibling = next.bundles.entities['b2']!;
    expect(selected.guidelines?.selected).toBe(selectedGuidelines);
    expect(sibling.guidelines).toBe(selected.guidelines);
    expect(sibling.projectConfig).toBe(selected.projectConfig);
    expect(sibling.currentSession.task).toBe(selected.currentSession.task);
    expect(sibling.currentSession.currentProject).toBe(
      selected.currentSession.currentProject,
    );
    // Per-recording state stays the sibling's own.
    expect(sibling.sessionFile).toBe(sessionFile);
    expect(sibling.transcript).toBe(withB2.bundles.entities['b2']!.transcript);
    expect(sibling.logging).toBe(withB2.bundles.entities['b2']!.logging);
  });

  it('a bundle created into a running session joins it (guidelines, project config, task)', () => {
    const { reducer, initial } = init();
    const inSession = reducer(
      initial as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      inSession as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    const source = inSession.bundles.entities[DEFAULT_BUNDLE_ID]!;
    const created = next.bundles.entities['b2']!;
    expect(created.guidelines).toBe(source.guidelines);
    expect(created.projectConfig).toBe(source.projectConfig);
    expect(created.currentSession.task).toBe(source.currentSession.task);
    // The source bundle itself is not rewritten.
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(source);
  });

  it('createBundle records the media file name used for IDB saves', () => {
    const { reducer, initial } = init();
    const next = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b2',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b2']?.audio.fileName).toBe('b2.wav');
  });

  // Regression (manual testing): "Select all -> Remove" fell back to an
  // empty placeholder bundle WITHOUT the session scope, and every file
  // dropped afterwards copied its (missing) scope: the Dictaphone editor and
  // the overview showed no transcript, the segment popup had no markers.
  it('removing every bundle keeps the session scope on the placeholder, so files dropped next still get it', () => {
    const { reducer, initial } = init();
    const inSession = reducer(
      reducer(
        initial as any,
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'b2',
          sessionFile,
        }),
      ) as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;
    const source = inSession.bundles.entities['b2']!;

    const emptied = reducer(
      inSession as any,
      LoginModeActions.removeBundles({
        mode: LoginMode.LOCAL,
        bundleIds: [DEFAULT_BUNDLE_ID, 'b2'],
      }),
    ) as unknown as LocalBundleCollectionState;
    const placeholder = emptied.bundles.entities[DEFAULT_BUNDLE_ID]!;
    expect(placeholder.guidelines).toBe(source.guidelines);
    expect(placeholder.projectConfig).toBe(source.projectConfig);
    expect(placeholder.transcript?.levels ?? []).toHaveLength(0);

    const next = reducer(
      emptied as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b3',
        sessionFile,
        selectAfterCreate: false,
      }),
    ) as unknown as LocalBundleCollectionState;
    expect(next.bundles.entities['b3']?.guidelines).toBe(source.guidelines);
    expect(next.bundles.entities['b3']?.projectConfig).toBe(
      source.projectConfig,
    );
  });

  it('createBundle takes the scope from another bundle when the selected one has none', () => {
    const { reducer, initial } = init();
    // bundle-1 (selected) gets the scope, then b2 is created and selected,
    // then b2 is stripped of it (a bundle created before scope sharing).
    const inSession = reducer(
      initial as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;
    const stripped: LocalBundleCollectionState = {
      ...inSession,
      bundles: localBundleAdapter.addOne(
        {
          ...inSession.bundles.entities[DEFAULT_BUNDLE_ID]!,
          bundleId: 'bare',
          guidelines: undefined,
          projectConfig: undefined,
        } as any,
        inSession.bundles,
      ),
      selectedBundleId: 'bare',
    };

    const next = reducer(
      stripped as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'b3',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b3']?.guidelines).toBe(
      inSession.bundles.entities[DEFAULT_BUNDLE_ID]!.guidelines,
    );
  });

  it('selecting a bundle that missed the session scope heals it', () => {
    const { reducer, initial } = init();
    const inSession = reducer(
      initial as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;
    const withBare: LocalBundleCollectionState = {
      ...inSession,
      bundles: localBundleAdapter.addOne(
        {
          ...inSession.bundles.entities[DEFAULT_BUNDLE_ID]!,
          bundleId: 'bare',
          guidelines: undefined,
          projectConfig: undefined,
        } as any,
        inSession.bundles,
      ),
    };

    const next = reducer(
      withBare as any,
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bare',
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.selectedBundleId).toBe('bare');
    expect(next.bundles.entities['bare']?.guidelines).toBe(
      inSession.bundles.entities[DEFAULT_BUNDLE_ID]!.guidelines,
    );
    expect(next.bundles.entities['bare']?.projectConfig).toBe(
      inSession.bundles.entities[DEFAULT_BUNDLE_ID]!.projectConfig,
    );
  });

  it('createBundle marks the audio loaded only when the caller registered it', () => {
    const { reducer, initial } = init();
    const dropped = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'dropped',
        sessionFile,
        audioLoaded: true,
      }),
    ) as unknown as LocalBundleCollectionState;
    const restored = reducer(
      dropped as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'restored',
        sessionFile,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(restored.bundles.entities['dropped']?.audio.loaded).toBe(true);
    expect(restored.bundles.entities['restored']?.audio.loaded).toBe(false);
  });

  it('bundleAudioAttached marks that bundle loaded and nothing else', () => {
    const { reducer, initial } = init();
    const withRestored = reducer(
      initial as any,
      LoginModeActions.createBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'r1',
        sessionFile,
        selectAfterCreate: false,
      }),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      withRestored as any,
      LoginModeActions.bundleAudioAttached({
        mode: LoginMode.LOCAL,
        bundleId: 'r1',
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['r1']?.audio.loaded).toBe(true);
    expect(next.bundles.entities['r1']?.transcript).toBe(
      withRestored.bundles.entities['r1']?.transcript,
    );
    expect(next.selectedBundleId).toBe(withRestored.selectedBundleId);
    expect(next.bundles.entities[DEFAULT_BUNDLE_ID]).toBe(
      withRestored.bundles.entities[DEFAULT_BUNDLE_ID],
    );
  });

  it('an ordinary edit on the selected bundle leaves sibling entities untouched', () => {
    const { reducer, initial } = init();
    const inSession = reducer(
      reducer(
        initial as any,
        LoginModeActions.createBundle({
          mode: LoginMode.LOCAL,
          bundleId: 'b2',
          sessionFile,
          selectAfterCreate: false,
        }),
      ) as any,
      startSuccess(),
    ) as unknown as LocalBundleCollectionState;

    const next = reducer(
      inSession as any,
      LoginModeActions.changeComment.do({
        comment: 'only here',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;

    expect(next.bundles.entities['b2']).toBe(inSession.bundles.entities['b2']);
    expect(
      next.bundles.entities[DEFAULT_BUNDLE_ID]?.currentSession.comment,
    ).toBe('only here');
  });
});
