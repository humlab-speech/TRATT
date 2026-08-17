import { describe, expect, it } from '@jest/globals';
import { createReducer } from '@ngrx/store';
import {
  ASRContext,
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { LoginMode } from '../../index';
import { AnnotationActions } from './annotation.actions';
import { AnnotationStateReducers, initialState } from './annotation.reducer';
import { AnnotationState } from './index';

function buildState(): AnnotationState {
  const transcript = new TrattAnnotation<
    ASRContext,
    TrattAnnotationSegment<ASRContext>
  >();
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
