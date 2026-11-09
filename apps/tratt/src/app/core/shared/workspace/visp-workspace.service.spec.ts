import { ISegmentLevel, TrattAnnotation } from '@tratt/annotation';
import {
  annotationFromOwnedLevel,
  ownedLevelOf,
} from './visp-workspace.service';

const ref = { session: '0000', name: 'b1' };
const level: ISegmentLevel = {
  name: 'Transcription',
  type: 'SEGMENT' as ISegmentLevel['type'],
  items: [
    {
      id: 5,
      sampleStart: 0,
      sampleDur: 32000,
      labels: [{ name: 'Transcription', value: 'hello' }],
    },
    {
      id: 6,
      sampleStart: 32000,
      sampleDur: 32000,
      labels: [{ name: 'Transcription', value: 'world' }],
    },
  ],
};

describe('owned level ⇄ editor annotation', () => {
  it('round-trips through the editor model without padding or drift', () => {
    const annotation = annotationFromOwnedLevel(ref, level, 16000);
    const transcript = TrattAnnotation.deserialize(annotation);
    const back = ownedLevelOf(transcript, 'Transcription', 16000)!;
    expect(back.items.map((i) => [i.sampleStart, i.sampleDur])).toEqual([
      [0, 32000],
      [32000, 32000],
    ]);
    expect(back.items.map((i) => i.labels[0].value)).toEqual([
      'hello',
      'world',
    ]);
  });

  it('returns undefined when the level is absent', () => {
    const transcript = TrattAnnotation.deserialize(
      annotationFromOwnedLevel(ref, level, 16000),
    );
    expect(ownedLevelOf(transcript, 'Other', 16000)).toBeUndefined();
  });
});
