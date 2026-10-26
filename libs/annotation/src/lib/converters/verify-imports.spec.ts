import { describe, expect, it } from 'vitest';
import { AnnotJSONConverter } from './AnnotJSONConverter';
import { ELANConverter } from './ELANConverter';
import { PraatTableConverter } from './PraatTableConverter';
import { PraatTextgridConverter } from './PraatTextgridConverter';
import { BASE, SYNTH_END, SYNTH_SEGMENTS, audiofile, makeSyntheticAnnot } from './spec-helpers';
import { SRTConverter } from './SRTConverter';
import { TextConverter } from './TextConverter';
import { WebVTTConverter } from './WebVTTConverter';

// Files an external tool would hand us, generated from a synthetic transcript
// (the real interview used originally is private and not in the repo).
const source = makeSyntheticAnnot();
const exportAudio = { ...audiofile, duration: SYNTH_END };
const contentOf = (r: {
  error?: string;
  file?: { content: string };
}): string => {
  expect(r.error).toBeFalsy();
  return r.file!.content;
};

describe('annotation import fixes', () => {
  it('TextConverter: imports <ts="..."> timestamps (Bug #1)', () => {
    const converter = new TextConverter();
    const content = contentOf(
      Object.assign(new TextConverter(), {
        options: {
          showTimestampString: true,
          showTimestampSamples: false,
          addNewLineString: false,
          addSpeakerId: false,
          breakMarkerCode: '<P>',
        },
      }).export(source, exportAudio, 0),
    );
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
    const content = contentOf(
      new PraatTextgridConverter().export(source, exportAudio),
    );
    const result = converter.import(
      {
        name: `${BASE}.TextGrid`,
        type: 'text/plain',
        content,
        encoding: 'UTF-8',
      },
      audiofile,
    );
    expect(result.error).toBe('');
    expect(result.annotjson).toBeDefined();
    expect(result.annotjson!.levels[0].items.length).toBe(SYNTH_SEGMENTS);
  });

  it('PraatTableConverter: imports Table', () => {
    const converter = new PraatTableConverter();
    const content = contentOf(new PraatTableConverter().export(source));
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
    const content = contentOf(new ELANConverter().export(source, exportAudio));
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
    const content = contentOf(
      new SRTConverter().export(source, exportAudio, 0),
    );
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
    const content = contentOf(
      new WebVTTConverter().export(source, exportAudio, 0),
    );
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
    const annotJson = {
      ...source,
      annotates: `${BASE}.mp4`,
      sampleRate: 16000,
    };
    const content = new AnnotJSONConverter().export(annotJson).file!.content;
    // _annot.json was created from .mp4 at 16000 Hz
    const annotAudio = { ...audiofile, name: `${BASE}.mp4`, sampleRate: 16000 };
    const result = converter.import(
      {
        name: `${BASE}_annot.json`,
        type: 'application/json',
        content,
        encoding: 'UTF-8',
      },
      annotAudio,
    );
    expect(result.error).toBeFalsy();
    expect(result.annotjson).toBeDefined();
  });

  it('PraatTextgridConverter: export encoding is UTF-8 (Bug #2)', () => {
    const converter = new PraatTextgridConverter();
    const content = contentOf(
      new PraatTextgridConverter().export(source, exportAudio),
    );
    const importResult = converter.import(
      {
        name: `${BASE}.TextGrid`,
        type: 'text/plain',
        content,
        encoding: 'UTF-8',
      },
      audiofile,
    );
    expect(importResult.annotjson).toBeDefined();
    const exportResult = converter.export(importResult.annotjson!, audiofile);
    expect(exportResult.file?.encoding).toBe('UTF-8');
  });
});
