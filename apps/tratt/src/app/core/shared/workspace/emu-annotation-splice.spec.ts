import { ISegmentLevel } from '@tratt/annotation';
import {
  allowedLabelNames,
  hasContent,
  ownedLevelKey,
  toPlainOwnedLevel,
} from './emu-annotation-splice';

const level = (
  items: [number, number, number, string][],
  name = 'Transcription',
): ISegmentLevel => ({
  name,
  type: 'SEGMENT' as ISegmentLevel['type'],
  items: items.map(([id, sampleStart, sampleDur, value]) => ({
    id,
    sampleStart,
    sampleDur,
    labels: [{ name, value }],
  })),
});

describe('allowedLabelNames', () => {
  it('uses the declared attributes, else the level name', () => {
    const config = {
      levelDefinitions: [
        {
          name: 'Transcription',
          type: 'SEGMENT',
          attributeDefinitions: [{ name: 'Transcription' }, { name: 'Speaker' }],
        },
        { name: 'Phonetic', type: 'SEGMENT' },
      ],
    };
    expect(allowedLabelNames(config, 'Transcription')).toEqual([
      'Transcription',
      'Speaker',
    ]);
    expect(allowedLabelNames(config, 'Phonetic')).toEqual(['Phonetic']);
  });
});

describe('toPlainOwnedLevel', () => {
  it('drops serializer fields and maps the break marker to an empty label', () => {
    const edited = level([[1, 0, 100, '<P>']]);
    (edited.items[0] as any).type = 'item';
    (edited.items[0] as any).verified = false;
    expect(toPlainOwnedLevel(edited, { breakMarker: '<P>' }).items).toEqual([
      {
        id: 1,
        sampleStart: 0,
        sampleDur: 100,
        labels: [{ name: 'Transcription', value: '' }],
      },
    ]);
  });

  it('keeps a marker inside real text', () => {
    const plain = toPlainOwnedLevel(level([[1, 0, 100, 'yes <P> no']]), {
      breakMarker: '<P>',
    });
    expect(plain.items[0].labels[0].value).toBe('yes <P> no');
  });

  it('keeps declared extra labels and names the text label after the level', () => {
    const edited = level([[1, 0, 100, 'hi']]);
    edited.items[0].labels = [
      { name: 'OCTRA_1', value: 'hi' },
      { name: 'Speaker', value: 'S1' },
      { name: 'Undeclared', value: 'x' },
    ];
    expect(
      toPlainOwnedLevel(edited, {
        allowedLabels: ['Transcription', 'Speaker'],
      }).items[0].labels,
    ).toEqual([
      { name: 'Transcription', value: 'hi' },
      { name: 'Speaker', value: 'S1' },
    ]);
  });
});

describe('ownedLevelKey / hasContent', () => {
  it('treats any content-free level as empty', () => {
    expect(hasContent(level([[1, 0, 64000, '']]))).toBe(false);
    expect(hasContent(undefined)).toBe(false);
    expect(ownedLevelKey(level([[1, 0, 64000, '']]))).toBe(
      ownedLevelKey(level([])),
    );
  });

  it('sees boundaries and text, and only those', () => {
    const a = level([
      [1, 0, 100, 'a'],
      [2, 100, 100, 'b'],
    ]);
    const noisy = JSON.parse(JSON.stringify(a)) as ISegmentLevel;
    (noisy.items[0] as any).verified = false;
    expect(ownedLevelKey(toPlainOwnedLevel(noisy))).toBe(ownedLevelKey(a));
    const moved = JSON.parse(JSON.stringify(a)) as ISegmentLevel;
    moved.items[1].sampleStart = 101;
    expect(ownedLevelKey(moved)).not.toBe(ownedLevelKey(a));
    const typed = JSON.parse(JSON.stringify(a)) as ISegmentLevel;
    typed.items[0].labels[0].value = 'A';
    expect(ownedLevelKey(typed)).not.toBe(ownedLevelKey(a));
  });

  it('counts several segments as content even without text', () => {
    expect(
      hasContent(
        level([
          [1, 0, 100, ''],
          [2, 100, 100, ''],
        ]),
      ),
    ).toBe(true);
  });
});
