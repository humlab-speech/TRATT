import { describe, expect, it } from '@jest/globals';
import { strToU8, zipSync } from 'fflate';
import { archiveGroupOf, filesFromExportZip } from './catalogue-import';

describe('filesFromExportZip', () => {
  it('returns audio then its _annot.json, then audio-less annotations, skipping output-only files', () => {
    const zip = zipSync({
      'bundles/a/a.wav': strToU8('RIFF'),
      'bundles/a/a_annot.json': strToU8('{}'),
      'bundles/a/a.srt': strToU8('x'),
      'bundles/b/b_annot.json': strToU8('{}'),
      'manifest.json': strToU8(
        JSON.stringify([
          { audioPath: 'bundles/a/a.wav', audioType: 'audio/wav' },
        ]),
      ),
    });
    const files = filesFromExportZip(zip);
    expect(files.map((f) => f.name)).toEqual([
      'a.wav',
      'a_annot.json',
      'b_annot.json',
    ]);
    expect(archiveGroupOf(files[2])).toBeUndefined();
    expect(files[0].type).toBe('audio/wav');
  });

  it('keeps recordings that differ only by extension apart, by folder', () => {
    const zip = zipSync({
      'bundles/take/take.wav': strToU8('RIFF'),
      'bundles/take/take_annot.json': strToU8('{"a":1}'),
      'bundles/take-2/take.wma': strToU8('WMA'),
      'bundles/take-2/take_annot.json': strToU8('{"a":2}'),
    });
    const files = filesFromExportZip(zip);
    expect(files.map((f) => f.name).sort()).toEqual([
      'take.wav',
      'take.wma',
      'take_annot.json',
      'take_annot.json',
    ]);
    const groups = (name: string) => files.filter((f) => f.name === name);
    const [wav] = groups('take.wav');
    const [wma] = groups('take.wma');
    expect(archiveGroupOf(wav)).not.toBe(archiveGroupOf(wma));
    expect(groups('take_annot.json').map(archiveGroupOf).sort()).toEqual(
      [archiveGroupOf(wav), archiveGroupOf(wma)].sort(),
    );
  });

  it('pairs a renamed lone annotation in the recording folder', () => {
    const zip = zipSync({
      'bundles/a/a.wav': strToU8('RIFF'),
      'bundles/a/other_annot.json': strToU8('{}'),
    });
    expect(filesFromExportZip(zip).map((f) => f.name)).toEqual([
      'a.wav',
      'other_annot.json',
    ]);
  });
});
