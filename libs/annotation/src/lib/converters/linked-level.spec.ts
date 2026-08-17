/**
 * Linked level round-trip + speaker label survival tests + source→linked sync.
 */
import { SampleUnit } from '@tratt/media';
import { describe, expect, it, vi } from 'vitest';
import { TrattAnnotation, TrattAnnotationSegmentLevel } from '../annotation';
import {
  IAnnotJSON,
  OAnnotJSON,
  OLabel,
  OSegment,
  OSegmentLevel,
} from '../annotjson';
import { ASRContext, TrattAnnotationSegment } from '../trattAnnotationSegment';

function makeAnnot(): OAnnotJSON {
  const sourceLevel = new OSegmentLevel<OSegment>('OCTRA_1', [
    new OSegment(1, 0, 48000, [
      new OLabel('OCTRA_1', 'hello'),
      new OLabel('Speaker', 'Speaker 1'),
    ]),
    new OSegment(2, 48000, 48000, [
      new OLabel('OCTRA_1', 'world'),
      new OLabel('Speaker', 'Speaker 2'),
    ]),
  ]);
  const linkedLevel = new OSegmentLevel<OSegment>(
    'OCTRA_1_en',
    [
      new OSegment(3, 0, 48000, [
        new OLabel('OCTRA_1_en', 'hallo'),
        new OLabel('Speaker', 'Speaker 1'),
      ]),
      new OSegment(4, 48000, 48000, [
        new OLabel('OCTRA_1_en', 'welt'),
        new OLabel('Speaker', 'Speaker 2'),
      ]),
    ],
    'OCTRA_1',
    'translation',
  );
  return new OAnnotJSON('audio.wav', 'audio', 48000, [
    sourceLevel as any,
    linkedLevel as any,
  ]);
}

describe('linked levels', () => {
  it('serializes linkedToLevelName + linkedKind on segment levels', () => {
    const annot = makeAnnot();
    const json: IAnnotJSON = annot.serialize();
    const linked = json.levels[1] as any;
    expect(linked.linkedToLevelName).toBe('OCTRA_1');
    expect(linked.linkedKind).toBe('translation');
  });

  it('round-trip: deserialize → serialize preserves link metadata', () => {
    const annot = makeAnnot();
    const json = annot.serialize();
    const restored = OAnnotJSON.deserialize(json)!;
    const reJson = restored.serialize();
    const linked = reJson.levels[1] as any;
    expect(linked.linkedToLevelName).toBe('OCTRA_1');
    expect(linked.linkedKind).toBe('translation');
  });

  it('source level has no link metadata', () => {
    const annot = makeAnnot();
    const json = annot.serialize();
    const source = json.levels[0] as any;
    expect(source.linkedToLevelName).toBeUndefined();
    expect(source.linkedKind).toBeUndefined();
  });

  it('Speaker labels present on both source and linked level segments', () => {
    const annot = makeAnnot();
    const sourceItems = (annot.levels[0] as OSegmentLevel<OSegment>).items;
    const linkedItems = (annot.levels[1] as OSegmentLevel<OSegment>).items;
    for (let i = 0; i < sourceItems.length; i++) {
      const sSpeaker = sourceItems[i].labels.find((l) => l.name === 'Speaker');
      const lSpeaker = linkedItems[i].labels.find((l) => l.name === 'Speaker');
      expect(sSpeaker?.value).toBeDefined();
      expect(lSpeaker?.value).toBe(sSpeaker?.value);
    }
  });

  it('source boundary edit mirrors to linked tier; labels preserved', () => {
    const json = makeAnnot().serialize();
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(json);
    const sourceIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId === undefined,
    );
    const linkedIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId !== undefined,
    );
    transcript.changeCurrentLevelIndex(sourceIdx);

    const source =
      transcript.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const linked = transcript.levels[
      linkedIdx
    ] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const sourceItem = source.items[0] as TrattAnnotationSegment;
    const linkedLabelBefore = linked.items[0].labels.find(
      (l) => l.name === 'OCTRA_1_en',
    )?.value;

    const moved = sourceItem.clone();
    moved.time = new SampleUnit(36000, 48000);
    transcript.changeCurrentItemByIndex(0, moved);

    expect(source.items[0].time.samples).toBe(36000);
    expect(linked.items[0].time.samples).toBe(36000);
    const linkedLabelAfter = linked.items[0].labels.find(
      (l) => l.name === 'OCTRA_1_en',
    )?.value;
    expect(linkedLabelAfter).toBe(linkedLabelBefore);
  });

  it('source add mirrors to linked tier with paired item count', () => {
    const json = makeAnnot().serialize();
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(json);
    const sourceIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId === undefined,
    );
    const linkedIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId !== undefined,
    );
    transcript.changeCurrentLevelIndex(sourceIdx);

    const source =
      transcript.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const linked = transcript.levels[
      linkedIdx
    ] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    expect(source.items.length).toBe(2);
    expect(linked.items.length).toBe(2);

    transcript.addItemToCurrentLevel(new SampleUnit(24000, 48000));

    expect(source.items.length).toBe(3);
    expect(linked.items.length).toBe(3);
    const sourceTimes = source.items.map((i) => i.time.samples);
    const linkedTimes = linked.items.map((i) => i.time.samples);
    expect(linkedTimes).toEqual(sourceTimes);
  });

  it('source remove mirrors to linked tier; merge concats translation', () => {
    const json = makeAnnot().serialize();
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(json);
    const sourceIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId === undefined,
    );
    const linkedIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId !== undefined,
    );
    transcript.changeCurrentLevelIndex(sourceIdx);

    const source =
      transcript.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const linked = transcript.levels[
      linkedIdx
    ] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;

    transcript.removeItemByIndex(0, undefined, true);

    expect(source.items.length).toBe(1);
    expect(linked.items.length).toBe(1);
    const linkedText =
      linked.items[0].getFirstLabelWithoutName('Speaker')?.value;
    expect(linkedText).toBe('hallo welt');
  });

  it('linked tier boundary drag is blocked', () => {
    const json = makeAnnot().serialize();
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(json);
    const linkedIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId !== undefined,
    );
    transcript.changeCurrentLevelIndex(linkedIdx);
    const linked =
      transcript.currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
    const before = linked.items[0].time.samples;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const moved = (linked.items[0] as TrattAnnotationSegment).clone();
    moved.time = new SampleUnit(12000, 48000);
    transcript.changeCurrentItemByIndex(0, moved);
    expect(linked.items[0].time.samples).toBe(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('secondary (unlinked) tier is unaffected by edits on unrelated levels', () => {
    const annot = new OAnnotJSON('audio.wav', 'audio', 48000, [
      new OSegmentLevel<OSegment>('SRC', [
        new OSegment(1, 0, 48000, [new OLabel('SRC', 'a')]),
        new OSegment(2, 48000, 48000, [new OLabel('SRC', 'b')]),
      ]) as any,
      new OSegmentLevel<OSegment>('NOTES', [
        new OSegment(10, 0, 96000, [new OLabel('NOTES', 'free')]),
      ]) as any,
    ]);
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(annot.serialize() as any);
    const srcIdx = transcript.levels.findIndex((l) => l.name === 'SRC');
    const notesIdx = transcript.levels.findIndex((l) => l.name === 'NOTES');
    transcript.changeCurrentLevelIndex(srcIdx);

    transcript.addItemToCurrentLevel(new SampleUnit(24000, 48000));

    expect(
      (
        transcript.levels[
          notesIdx
        ] as TrattAnnotationSegmentLevel<TrattAnnotationSegment>
      ).items.length,
    ).toBe(1);
  });

  it('blocks add/remove on linked level via TrattAnnotation guard', () => {
    const json = makeAnnot().serialize();
    const transcript = TrattAnnotation.deserialize<
      ASRContext,
      TrattAnnotationSegment
    >(json);
    expect(transcript).toBeDefined();
    const linkedIdx = transcript.levels.findIndex(
      (l: any) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId !== undefined,
    );
    expect(linkedIdx).toBeGreaterThan(-1);
    transcript.changeCurrentLevelIndex(linkedIdx);

    const before = transcript.currentLevel!.items.length;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    transcript.addItemToCurrentLevel(new SampleUnit(24000, 48000));
    expect(transcript.currentLevel!.items.length).toBe(before);
    transcript.removeItemByIndex(0);
    expect(transcript.currentLevel!.items.length).toBe(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
