/**
 * Regression coverage added while type-auditing annotation.ts (S8, Task 18).
 *
 * These tests target two latent bugs that were hidden behind `any` casts:
 *
 * 1. `addItemToCurrentLevel()` on an EVENT level used to construct a raw
 *    `OEvent` (numeric `samplePoint`) instead of a `TrattAnnotationEvent`
 *    (SampleUnit `samplePoint`), even though `TrattAnnotationEventLevel`'s
 *    items are typed and consumed elsewhere (e.g. `serialize()`) as
 *    `TrattAnnotationEvent`. Tightening the types surfaced the mismatch.
 * 2. `TrattAnnotation.serialize()` padded a trailing gap with
 *    `this.createSegment(...)` (a `TrattAnnotationSegment`, with `.time`)
 *    even though `result.items` at that point is `ISegment[]`
 *    (`OSegment`-shaped, with `.sampleStart`/`.sampleDur`). Tightening the
 *    return type of `TrattAnnotationSegmentLevel.serialize()` from `any` to
 *    `ISegmentLevel` surfaced the shape mismatch.
 */
import { SampleUnit } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import {
  TrattAnnotation,
  TrattAnnotationEventLevel,
  TrattAnnotationSegmentLevel,
} from './annotation';
import { ISegmentLevel, OLabel } from './annotjson';
import {
  ASRContext,
  TrattAnnotationEvent,
  TrattAnnotationSegment,
} from './trattAnnotationSegment';

function makeAnnotation() {
  return new TrattAnnotation<ASRContext, TrattAnnotationSegment<ASRContext>>();
}

describe('TrattAnnotation.addItemToCurrentLevel on an EVENT level', () => {
  it('creates a TrattAnnotationEvent with a SampleUnit samplePoint (not a raw OEvent)', () => {
    const annotation = makeAnnotation();
    const level = annotation.createEventLevel('events', []);
    annotation.addLevel(level);
    annotation.changeCurrentLevelIndex(0);

    annotation.addItemToCurrentLevel(new SampleUnit(1000, 48000), [
      new OLabel('events', 'a'),
    ]);

    const current = annotation.currentLevel as TrattAnnotationEventLevel;
    expect(current.items).toHaveLength(1);
    expect(current.items[0]).toBeInstanceOf(TrattAnnotationEvent);
    expect(current.items[0].samplePoint).toBeInstanceOf(SampleUnit);
    expect(current.items[0].samplePoint.samples).toBe(1000);
  });

  it('sorts multiple events by sample position', () => {
    const annotation = makeAnnotation();
    const level = annotation.createEventLevel('events', []);
    annotation.addLevel(level);
    annotation.changeCurrentLevelIndex(0);

    annotation.addItemToCurrentLevel(new SampleUnit(2000, 48000));
    annotation.addItemToCurrentLevel(new SampleUnit(1000, 48000));

    const current = annotation.currentLevel as TrattAnnotationEventLevel;
    expect(current.items.map((a) => a.samplePoint.samples)).toEqual([
      1000, 2000,
    ]);
  });

  it('serializes to an OEventLevel with a numeric samplePoint', () => {
    const annotation = makeAnnotation();
    const level = annotation.createEventLevel('events', []);
    annotation.addLevel(level);
    annotation.changeCurrentLevelIndex(0);

    annotation.addItemToCurrentLevel(new SampleUnit(1000, 48000), [
      new OLabel('events', 'a'),
    ]);

    const current = annotation.currentLevel as TrattAnnotationEventLevel;
    const serialized = current.serialize();
    expect(serialized.items[0].samplePoint).toBe(1000);
  });
});

describe('TrattAnnotation.serialize() padding of the final segment', () => {
  it('appends an ISegment-shaped item (sampleStart/sampleDur) when the last item ends before lastSegmentTime', () => {
    const annotation = makeAnnotation();
    const segment = new TrattAnnotationSegment<ASRContext>(
      1,
      new SampleUnit(1000, 48000),
      [new OLabel('tier', 'hello')],
    );
    const level = annotation.createSegmentLevel('tier', [segment]);
    annotation.addLevel(level);
    annotation.updateIDCounters();

    const json = annotation.serialize(
      'audio.wav',
      48000,
      new SampleUnit(2000, 48000),
    );
    const segmentLevel = json.levels[0] as ISegmentLevel;

    expect(segmentLevel.items).toHaveLength(2);
    const padding = segmentLevel.items[1];
    expect(padding.sampleStart).toBe(1000);
    expect(padding.sampleDur).toBe(1000);
    expect(typeof padding.id).toBe('number');
    expect(padding.labels[0].name).toBe('tier');
    expect(padding.labels[0].value).toBe('');
  });

  it('does not pad when the last item already reaches lastSegmentTime', () => {
    const annotation = makeAnnotation();
    const segment = new TrattAnnotationSegment<ASRContext>(
      1,
      new SampleUnit(2000, 48000),
      [new OLabel('tier', 'hello')],
    );
    const level = annotation.createSegmentLevel('tier', [segment]);
    annotation.addLevel(level);
    annotation.updateIDCounters();

    const json = annotation.serialize(
      'audio.wav',
      48000,
      new SampleUnit(2000, 48000),
    );
    const segmentLevel = json.levels[0] as ISegmentLevel;

    expect(segmentLevel.items).toHaveLength(1);
  });
});

describe('TrattAnnotation.changeCurrentItemByIndex on a SEGMENT level', () => {
  it('replaces the item in place', () => {
    const annotation = makeAnnotation();
    const segment = new TrattAnnotationSegment<ASRContext>(
      1,
      new SampleUnit(1000, 48000),
      [new OLabel('tier', 'hello')],
    );
    const level = annotation.createSegmentLevel('tier', [segment]);
    annotation.addLevel(level);
    annotation.changeCurrentLevelIndex(0);

    const updated = segment.clone();
    updated.changeLabel('tier', 'world');
    annotation.changeCurrentItemByIndex(0, updated);

    const current = annotation.currentLevel as TrattAnnotationSegmentLevel<
      TrattAnnotationSegment<ASRContext>
    >;
    expect(current.items[0].getLabel('tier')?.value).toBe('world');
  });
});
