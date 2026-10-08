import { describe, expect, it } from '@jest/globals';
import { strToU8, zipSync } from 'fflate';
import { filesFromExportZip } from './catalogue-import';

describe('filesFromExportZip', () => {
  it('returns audio then its _annot.json, skipping output-only files and orphan annotations', () => {
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
    expect(files.map((f) => f.name)).toEqual(['a.wav', 'a_annot.json']);
    expect(files[0].type).toBe('audio/wav');
  });
});
