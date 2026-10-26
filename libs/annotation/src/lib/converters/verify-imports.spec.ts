import { describe, it, expect } from 'vitest';
import { TextConverter } from './TextConverter';
import { PraatTextgridConverter } from './PraatTextgridConverter';
import { PraatTableConverter } from './PraatTableConverter';
import { ELANConverter } from './ELANConverter';
import { SRTConverter } from './SRTConverter';
import { WebVTTConverter } from './WebVTTConverter';
import { AnnotJSONConverter } from './AnnotJSONConverter';
import { BASE, HAS_FIXTURES, readFile, audiofile } from './spec-helpers';

describe.skipIf(!HAS_FIXTURES)('annotation import fixes', () => {
  it('TextConverter: imports <ts="..."> timestamps (Bug #1)', () => {
    const converter = new TextConverter();
    const content = readFile(`${BASE}.txt`);
    const result = converter.import(
      { name: `${BASE}.txt`, type: 'text/plain', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels.length).toBeGreaterThan(0);
    expect(result.annotjson!.levels[0].items.length).toBeGreaterThan(0);
  });

  it('PraatTextgridConverter: imports TextGrid', () => {
    const converter = new PraatTextgridConverter();
    const content = readFile(`${BASE}.TextGrid`);
    const result = converter.import(
      { name: `${BASE}.TextGrid`, type: 'text/plain', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBe(924);
  });

  it('PraatTableConverter: imports Table', () => {
    const converter = new PraatTableConverter();
    const content = readFile(`${BASE}.Table`);
    const result = converter.import(
      { name: `${BASE}.Table`, type: 'text/plain', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBeGreaterThan(0);
  });

  it('ELANConverter: imports EAF', () => {
    const converter = new ELANConverter();
    const content = readFile(`${BASE}.eaf`);
    const result = converter.import(
      { name: `${BASE}.eaf`, type: 'text/xml', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBeGreaterThan(0);
  });

  it('SRTConverter: imports SRT', () => {
    const converter = new SRTConverter();
    const content = readFile(`${BASE}.srt`);
    const result = converter.import(
      { name: `${BASE}.srt`, type: 'text/plain', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBeGreaterThan(0);
  });

  it('WebVTTConverter: imports VTT', () => {
    const converter = new WebVTTConverter();
    const content = readFile(`${BASE}.vtt`);
    // last VTT cue ends at 2692s = 129216000 samples, slightly past the actual
    // WAV duration (129210690); the converter now clamps rather than rejecting.
    const result = converter.import(
      { name: `${BASE}.vtt`, type: 'text/vtt', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBeGreaterThan(0);
  });

  it('AnnotJSONConverter: imports _annot.json', () => {
    const converter = new AnnotJSONConverter();
    const content = readFile(`${BASE}_annot.json`);
    // _annot.json was created from .mp4 at 16000 Hz
    const annotAudio = { ...audiofile, name: `${BASE}.mp4`, sampleRate: 16000 };
    const result = converter.import(
      { name: `${BASE}_annot.json`, type: 'application/json', content, encoding: 'UTF-8' },
      annotAudio,
    );
    expect(result.error).toBeFalsy();
    expect(result.annotjson).toBeDefined();
  });

  it('PraatTextgridConverter: export encoding is UTF-8 (Bug #2)', () => {
    const converter = new PraatTextgridConverter();
    const content = readFile(`${BASE}.TextGrid`);
    const importResult = converter.import(
      { name: `${BASE}.TextGrid`, type: 'text/plain', content, encoding: 'UTF-8' },
      audiofile,
    );
    expect(importResult.annotjson).toBeDefined();
    const exportResult = converter.export(importResult.annotjson!, audiofile);
    expect(exportResult.file?.encoding).toBe('UTF-8');
  });
});
