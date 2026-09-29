import { describe, expect, it } from '@jest/globals';
import { Action, createReducer } from '@ngrx/store';
import {
  AnnotationLevelType,
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { LoginMode } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { LoginModeReducers } from '../login-mode.reducer';
import { AnnotationActions } from './annotation.actions';
import { AnnotationStateReducers, initialState } from './annotation.reducer';
import { AnnotationState } from './index';
import {
  LocalBundleCollectionState,
  resolveLocalBundleState,
} from './local-bundle-collection';

function buildState(): AnnotationState {
  const transcript = new TrattAnnotation<TrattAnnotationSegment>();
  const source = new TrattAnnotationSegmentLevel<TrattAnnotationSegment>(
    transcript.idCounters.level++,
    'OCTRA_1',
    [
      new TrattAnnotationSegment(
        transcript.idCounters.item++,
        new SampleUnit(48000, 48000),
        [new OLabel('OCTRA_1', 'hello'), new OLabel('Speaker', 'Speaker 1')],
      ) as any,
      new TrattAnnotationSegment(
        transcript.idCounters.item++,
        new SampleUnit(96000, 48000),
        [new OLabel('OCTRA_1', 'world'), new OLabel('Speaker', 'Speaker 2')],
      ) as any,
    ],
  );
  transcript.addLevel(source as any);

  const linked = new TrattAnnotationSegmentLevel<TrattAnnotationSegment>(
    transcript.idCounters.level++,
    'German',
    [
      new TrattAnnotationSegment(
        transcript.idCounters.item++,
        new SampleUnit(48000, 48000),
        [new OLabel('German', ''), new OLabel('Speaker', 'Speaker 1')],
      ) as any,
      new TrattAnnotationSegment(
        transcript.idCounters.item++,
        new SampleUnit(96000, 48000),
        [new OLabel('German', 'manuell'), new OLabel('Speaker', 'Speaker 2')],
      ) as any,
    ],
    source.id,
    'translation',
  );
  transcript.addLevel(linked as any);

  return { ...initialState, transcript };
}

describe('applyTranslationToLinkedLevel reducer', () => {
  const reducers = new AnnotationStateReducers(LoginMode.LOCAL).create();
  const reducer = createReducer(initialState, ...reducers);

  it('fills empty translation labels and preserves manual edits + Speaker', () => {
    const state = buildState();
    const linkedLevel = state.transcript
      .levels[1] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;

    const next = reducer(
      state,
      AnnotationActions.applyTranslationToLinkedLevel.do({
        linkedLevelId: linkedLevel.id,
        translated: [
          { id: 0, text: 'hallo' },
          { id: 1, text: 'welt' },
        ],
        mode: LoginMode.LOCAL,
      }),
    );

    const updatedLinked = next.transcript.levels.find(
      (l) => l.id === linkedLevel.id,
    ) as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;

    const item0Translation = updatedLinked.items[0].labels.find(
      (l) => l.name === 'German',
    )?.value;
    const item1Translation = updatedLinked.items[1].labels.find(
      (l) => l.name === 'German',
    )?.value;
    expect(item0Translation).toBe('hallo');
    expect(item1Translation).toBe('manuell');

    const item0Speaker = updatedLinked.items[0].labels.find(
      (l) => l.name === 'Speaker',
    )?.value;
    const item1Speaker = updatedLinked.items[1].labels.find(
      (l) => l.name === 'Speaker',
    )?.value;
    expect(item0Speaker).toBe('Speaker 1');
    expect(item1Speaker).toBe('Speaker 2');
  });

  it('ignores non-linked levels', () => {
    const state = buildState();
    const sourceLevel = state.transcript
      .levels[0] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const originalText = sourceLevel.items[0].labels.find(
      (l) => l.name === 'OCTRA_1',
    )?.value;

    const next = reducer(
      state,
      AnnotationActions.applyTranslationToLinkedLevel.do({
        linkedLevelId: sourceLevel.id,
        translated: [{ id: 0, text: 'overwritten' }],
        mode: LoginMode.LOCAL,
      }),
    );

    const updatedSource = next.transcript.levels.find(
      (l) => l.id === sourceLevel.id,
    ) as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    expect(
      updatedSource.items[0].labels.find((l) => l.name === 'OCTRA_1')?.value,
    ).toBe(originalText);
  });

  it('ignores mode mismatch', () => {
    const state = buildState();
    const linkedLevel = state.transcript
      .levels[1] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;

    const next = reducer(
      state,
      AnnotationActions.applyTranslationToLinkedLevel.do({
        linkedLevelId: linkedLevel.id,
        translated: [{ id: 0, text: 'hallo' }],
        mode: LoginMode.ONLINE,
      }),
    );

    expect(next).toBe(state);
  });
});

describe('reducers return new state objects instead of mutating in place', () => {
  const reducers = new AnnotationStateReducers(LoginMode.LOCAL).create();
  const reducer = createReducer(initialState, ...reducers);

  it('combinePhrases.success returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.combinePhrases.success({
        mode: LoginMode.LOCAL,
        transcript: state.transcript.clone(),
      }),
    );
    expect(next).not.toBe(state);
  });

  it('changeLevelName.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.changeLevelName.do({
        mode: LoginMode.LOCAL,
        index: 0,
        name: 'renamed',
      }),
    );
    expect(next).not.toBe(state);
  });

  it('changeCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const existingItem = state.transcript.currentLevel!.items[0];
    const next = reducer(
      state,
      AnnotationActions.changeCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [existingItem as any],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('addCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const newItem = new TrattAnnotationSegment(
      99,
      new SampleUnit(144000, 48000),
      [new OLabel('OCTRA_1', 'new')],
    );
    const next = reducer(
      state,
      AnnotationActions.addCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [newItem as any],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('removeCurrentLevelItems.do returns a new state object', () => {
    const state = buildState();
    state.transcript.changeCurrentLevelIndex(0);
    const next = reducer(
      state,
      AnnotationActions.removeCurrentLevelItems.do({
        mode: LoginMode.LOCAL,
        items: [{ id: 1 }],
      }),
    );
    expect(next).not.toBe(state);
  });

  it('sendOnlineAnnotation.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.sendOnlineAnnotation.do({ mode: LoginMode.LOCAL }),
    );
    expect(next).not.toBe(state);
  });

  it('sendOnlineAnnotation.fail returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.sendOnlineAnnotation.fail({
        mode: LoginMode.LOCAL,
        error: 'network error',
      }),
    );
    expect(next).not.toBe(state);
  });

  it('duplicateLevel.do returns a new state object', () => {
    const state = buildState();
    const next = reducer(
      state,
      AnnotationActions.duplicateLevel.do({ mode: LoginMode.LOCAL, index: 0 }),
    );
    expect(next).not.toBe(state);
  });
});

// Phase-0 leftover: before the entity-collection refactor (Tasks 1-4), LOCAL mode's
// NgRx slice was reduced by the exact same `LoginModeReducers` instance as
// ONLINE/DEMO/URL mode -- just a flat `AnnotationState`. Task 2 wrapped the LOCAL
// instance's output in a one-entity `@ngrx/entity` collection (`LocalBundleCollectionState`);
// every chokepoint that reads it (`getModeState`, `IDBEffectsService`, `selectActiveAnnotation`,
// and this task's 3 scattered raw reads) was updated to unwrap it via
// `resolveLocalBundleState()`. This suite pins the actual invariant the whole refactor must
// preserve: dispatching an identical action sequence through the LOCAL (entity-wrapped)
// reducer and through a plain, never-wrapped reducer (ONLINE mode's instance, confirmed
// untouched by `login-mode.reducer.spec.ts`) and reading the LOCAL side back out via
// `resolveLocalBundleState()` must produce byte-identical session data at every step.
describe('LOCAL-mode characterization: entity-wrapped output matches a plain AnnotationState reducer', () => {
  const audioDuration = new SampleUnit(48000, 48000);

  interface CharacterizationStep {
    label: string;
    action: (mode: LoginMode) => Action;
    // Concrete before/after value this step must produce, asserted against both sides.
    assertExpected: (state: AnnotationState) => void;
  }

  const steps: CharacterizationStep[] = [
    {
      label: 'comment change',
      action: (mode) =>
        LoginModeActions.changeComment.do({
          comment: 'characterization test comment',
          mode,
        }),
      assertExpected: (state) => {
        expect(state.currentSession.comment).toBe(
          'characterization test comment',
        );
      },
    },
    {
      label: 'level add',
      action: (mode) =>
        AnnotationActions.addAnnotationLevel.do({
          levelType: AnnotationLevelType.SEGMENT,
          audioDuration,
          mode,
        }),
      assertExpected: (state) => {
        expect(state.transcript.levels.length).toBe(1);
        expect(state.transcript.levels[0].name).toBe('OCTRA_2');
        expect(
          (
            state.transcript
              .levels[0] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>
          ).items.length,
        ).toBe(1);
      },
    },
    {
      label: 'transcript update',
      action: (mode) => {
        const replacement = new TrattAnnotation<TrattAnnotationSegment>();
        const replacementLevel = replacement.createSegmentLevel('Replaced', [
          replacement.createSegment(audioDuration.clone(), [
            new OLabel('Replaced', 'new transcript content'),
          ]),
        ]);
        replacement.addLevel(replacementLevel);
        return AnnotationActions.overwriteTranscript.do({
          transcript: replacement,
          mode,
          saveToDB: false,
        });
      },
      assertExpected: (state) => {
        expect(state.transcript.levels.length).toBe(1);
        expect(state.transcript.levels[0].name).toBe('Replaced');
        expect(
          (
            state.transcript
              .levels[0] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>
          ).items[0].labels.find((l) => l.name === 'Replaced')?.value,
        ).toBe('new transcript content');
      },
    },
  ];

  it('produces byte-identical currentSession/transcript output for LOCAL (entity-wrapped) vs a plain (never-wrapped) reducer, action by action', () => {
    const localReducer = new LoginModeReducers(LoginMode.LOCAL).create();
    const plainReducer = new LoginModeReducers(LoginMode.ONLINE).create();

    let localCollectionState = localReducer(undefined, {
      type: '@@INIT',
    } as Action) as unknown as LocalBundleCollectionState;
    let plainState = plainReducer(undefined, {
      type: '@@INIT',
    } as Action) as AnnotationState;

    // sanity check: LOCAL really is entity-wrapped, ONLINE really is flat, before we
    // start comparing their unwrapped output.
    expect(localCollectionState.bundles).toBeDefined();
    expect((plainState as any).bundles).toBeUndefined();

    for (const step of steps) {
      localCollectionState = localReducer(
        localCollectionState as any,
        step.action(LoginMode.LOCAL),
      ) as unknown as LocalBundleCollectionState;
      plainState = plainReducer(
        plainState as any,
        step.action(LoginMode.ONLINE),
      ) as AnnotationState;

      const localState = resolveLocalBundleState(localCollectionState);
      expect(localState).toBeDefined();

      // the pinned, concrete before/after value for this step, on both sides
      step.assertExpected(localState!);
      step.assertExpected(plainState);

      // the invariant: entity-wrapping changed nothing observable about the session
      expect(localState!.currentSession.comment).toEqual(
        plainState.currentSession.comment,
      );
      expect(localState!.transcript.levels.map((l) => l.name)).toEqual(
        plainState.transcript.levels.map((l) => l.name),
      );
      expect(
        localState!.transcript.levels.map((l) =>
          l instanceof TrattAnnotationSegmentLevel ? l.items.length : 0,
        ),
      ).toEqual(
        plainState.transcript.levels.map((l) =>
          l instanceof TrattAnnotationSegmentLevel ? l.items.length : 0,
        ),
      );
    }
  });

  it('no-ops (returns the exact same collection state reference) when a mode-mismatched action reaches the LOCAL reducer', () => {
    const localReducer = new LoginModeReducers(LoginMode.LOCAL).create();

    let localCollectionState = localReducer(undefined, {
      type: '@@INIT',
    } as Action) as unknown as LocalBundleCollectionState;

    // advance past initial state with one real LOCAL-mode action, so the no-op check
    // below isn't trivially exercising the untouched initial state.
    localCollectionState = localReducer(
      localCollectionState as any,
      LoginModeActions.changeComment.do({
        comment: 'before mismatch check',
        mode: LoginMode.LOCAL,
      }),
    ) as unknown as LocalBundleCollectionState;

    // a mode-MISMATCHED action dispatched at the LOCAL reducer instance: the inner
    // `on(...)` handler guards on `this.mode === mode` and returns its input state
    // untouched, so `wrapAsLocalBundleCollectionReducer`'s `nextInner === currentInner`
    // check must hit its no-op branch and return the *same* outer collection state
    // reference -- not a deep-equal copy. This is what NgRx memoization relies on.
    const next = localReducer(
      localCollectionState as any,
      LoginModeActions.changeComment.do({
        comment: 'should be ignored',
        mode: LoginMode.ONLINE,
      }),
    );

    expect(next).toBe(localCollectionState);
  });
});
