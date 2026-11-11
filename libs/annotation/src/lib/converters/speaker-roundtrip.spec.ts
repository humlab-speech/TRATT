/**
 * Every time-aligned text format must write speakers as `[Name] ` (with
 * addSpeakerId) and read them back as a Speaker label with the default
 * import options.
 */
import { describe, expect, it } from 'vitest';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { Converter } from './Converter';
import { CTMConverter } from './CTMConverter';
import { PartiturConverter } from './PartiturConverter';
import { PraatTableConverter } from './PraatTableConverter';
import { PraatTextgridConverter } from './PraatTextgridConverter';
import { SRTConverter } from './SRTConverter';
import { TextConverter } from './TextConverter';
import { WebVTTConverter } from './WebVTTConverter';

const sr = 48000;
const audio = { name: 'spk.wav', size: 1, duration: sr * 10, sampleRate: sr };
const units: [string, string, number, number][] = [
  ['Anna', 'hello world', 0, 2],
  ['Bo', 'second line', 2, 3],
  ['Anna', 'third part', 5, 5],
];

const source = () =>
  new OAnnotJSON('spk.wav', 'spk', sr, [
    new OSegmentLevel<OSegment>(
      'OCTRA_1',
      units.map(
        ([speaker, text, start, dur], i) =>
          new OSegment(
            i + 1,
            start * sr,
            dur * sr,
            [new OLabel('OCTRA_1', text), new OLabel('Speaker', speaker)],
            true,
          ),
      ),
    ),
  ]);

const cases: [Converter, string][] = [
  [new SRTConverter(), 'spk.srt'],
  [new WebVTTConverter(), 'spk.vtt'],
  [new TextConverter(), 'spk.txt'],
  [new PraatTextgridConverter(), 'spk.TextGrid'],
  [new PraatTableConverter(), 'spk.Table'],
  [new CTMConverter(), 'spk.ctm'],
  [new PartiturConverter(), 'spk.par'],
];

describe('speaker IDs round-trip in time-aligned formats', () => {
  it.each(cases)('%s', (converter, fileName) => {
    converter.options = {
      ...converter.options,
      addSpeakerId: true,
      showTimestampString: true,
    };
    const exported = converter.export(source(), audio as any, 0);
    expect(exported.error).toBeFalsy();
    expect(exported.file!.content).toContain('<v Anna>');

    const imported = converter.import(
      {
        name: fileName,
        type: 'text/plain',
        content: exported.file!.content,
        encoding: 'UTF-8',
      },
      audio as any,
    );
    expect(imported.error).toBe('');

    const got = imported
      .annotjson!.levels[0].items.map((item) => {
        const labels = (item as OSegment).labels;
        return [
          labels.find((l) => l.name === 'Speaker')?.value,
          labels.find((l) => l.name !== 'Speaker')?.value,
        ];
      })
      .filter(([, text]) => text);
    expect(got).toEqual(units.map(([speaker, text]) => [speaker, text]));
  });
});

describe('import without speaker prefixes', () => {
  it.each(cases)(
    '%s imports silently without Speaker labels',
    (converter, fileName) => {
      converter.options = {
        ...converter.options,
        addSpeakerId: false,
        showTimestampString: true,
      };
      const exported = converter.export(source(), audio as any, 0);
      const imported = converter.import(
        {
          name: fileName,
          type: 'text/plain',
          content: exported.file!.content,
          encoding: 'UTF-8',
        },
        audio as any,
      );
      expect(imported.error).toBe('');
      const speakers = imported
        .annotjson!.levels.flatMap((l) => l.items as OSegment[])
        .flatMap((i) => i.labels)
        .filter((l) => l.name === 'Speaker');
      // WebVTT always writes <v Name>; every other format has no marker here
      expect(speakers.length > 0).toBe(converter.name === 'WebVTT');
    },
  );
});

describe('legacy [Name] prefix', () => {
  it('is still read on import', () => {
    const srt = new SRTConverter();
    const res = srt.import(
      {
        name: 'spk.srt',
        type: 'text/plain',
        content: '1\n00:00:00,000 --> 00:00:02,000\n[Anna]: hello\n\n',
        encoding: 'UTF-8',
      },
      audio as any,
    );
    const seg = res.annotjson!.levels[0].items[0] as OSegment;
    expect(seg.labels.find((l) => l.name === 'Speaker')?.value).toBe('Anna');
    expect(seg.getFirstLabelWithoutName('Speaker')?.value).toBe('hello');
  });
});
