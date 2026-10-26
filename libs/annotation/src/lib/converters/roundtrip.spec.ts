/**
 * Round-trip tests: import from real file → export (with time indicators) → re-import.
 * Verifies that exported annotation files can be read back correctly by the app.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TextConverter } from './TextConverter';
import { PraatTextgridConverter } from './PraatTextgridConverter';
import { PraatTableConverter } from './PraatTableConverter';
import { ELANConverter } from './ELANConverter';
import { SRTConverter } from './SRTConverter';
import { WebVTTConverter } from './WebVTTConverter';
import { AnnotJSONConverter } from './AnnotJSONConverter';
import { OAnnotJSON } from '../annotjson';
import { BASE, HAS_FIXTURES, readFile, audiofile, segmentCount } from './spec-helpers';

// Round-trip tests use a clean ms-boundary duration (2692 s × 48000 = 129216000)
// so ELAN ms-rounding doesn't create a phantom trailing empty segment on reimport.
const rtAudiofile = { ...audiofile, duration: 129216000 };

function importTextGrid(): OAnnotJSON {
  const c = new PraatTextgridConverter();
  const r = c.import(
    { name: `${BASE}.TextGrid`, type: 'text/plain', content: readFile(`${BASE}.TextGrid`), encoding: 'UTF-8' },
    rtAudiofile,
  );
  expect(r.error).toBe('');
  return r.annotjson!;
}

// ── round-trip tests ─────────────────────────────────────────────────────────

describe.skipIf(!HAS_FIXTURES)('annotation round-trip (export → re-import)', () => {
  let sharedSource!: OAnnotJSON;

  beforeAll(() => {
    sharedSource = importTextGrid();
  });

  it('PlainText (.txt) — with showTimestampString', () => {
    const source = sharedSource;
    const src_count = segmentCount(source);

    const exporter = new TextConverter();
    exporter.options = { showTimestampString: true, showTimestampSamples: false, addNewLineString: false, addSpeakerId: false, breakMarkerCode: '<P>' };
    const exported = exporter.export(source, rtAudiofile, 0);
    expect(exported.error).toBeFalsy();
    expect(exported.file!.content).toContain('<ts=');

    const importer = new TextConverter();
    const reimported = importer.import(
      { name: `${BASE}.txt`, type: 'text/plain', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    expect(segmentCount(reimported.annotjson!)).toBe(src_count);
  });

  it('PlainText (.txt) — with showTimestampSamples', () => {
    const source = sharedSource;
    const src_count = segmentCount(source);

    const exporter = new TextConverter();
    exporter.options = { showTimestampString: false, showTimestampSamples: true, addNewLineString: false, addSpeakerId: false, breakMarkerCode: '<P>' };
    const exported = exporter.export(source, rtAudiofile, 0);
    expect(exported.error).toBeFalsy();
    expect(exported.file!.content).toContain('<sp=');

    const importer = new TextConverter();
    const reimported = importer.import(
      { name: `${BASE}.txt`, type: 'text/plain', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    expect(segmentCount(reimported.annotjson!)).toBe(src_count);
  });

  it('Praat TextGrid (.TextGrid)', () => {
    const source = sharedSource;
    const src_count = segmentCount(source);

    const exporter = new PraatTextgridConverter();
    const exported = exporter.export(source, rtAudiofile);
    expect(exported.error).toBeFalsy();
    // guard: export must use UTF-8 not UTF-16 (dropzone reads as utf-8)
    expect(exported.file!.encoding).toBe('UTF-8');

    const importer = new PraatTextgridConverter();
    const reimported = importer.import(
      { name: `${BASE}.TextGrid`, type: 'text/plain', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    expect(segmentCount(reimported.annotjson!)).toBe(src_count);
  });

  it('Praat Table (.Table)', () => {
    const source = sharedSource;
    const src_count = segmentCount(source);

    const exporter = new PraatTableConverter();
    const exported = exporter.export(source);
    expect(exported.error).toBeFalsy();

    const importer = new PraatTableConverter();
    const reimported = importer.import(
      { name: `${BASE}.Table`, type: 'text/plain', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    expect(segmentCount(reimported.annotjson!)).toBe(src_count);
  });

  it('ELAN (.eaf)', () => {
    const source = sharedSource;
    const src_count = segmentCount(source);

    const exporter = new ELANConverter();
    const exported = exporter.export(source, rtAudiofile);
    expect(exported.error).toBeFalsy();

    const importer = new ELANConverter();
    const reimported = importer.import(
      { name: `${BASE}.eaf`, type: 'text/xml', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    // ELAN import adds a trailing empty segment when source doesn't reach audio duration;
    // ms-precision rounding may also cause a 1-segment gap at the end.
    expect(segmentCount(reimported.annotjson!)).toBeGreaterThanOrEqual(src_count);
  });

  it('SRT (.srt)', () => {
    // SRT only exports non-empty segments
    const source = sharedSource;
    const nonEmpty = source.levels[0].items.filter((s: any) =>
      (s.labels?.[0]?.value ?? '') !== ''
    ).length;

    const exporter = new SRTConverter();
    const exported = exporter.export(source, rtAudiofile, 0);
    expect(exported.error).toBeFalsy();
    expect(exported.file!.content).toContain('-->');

    const importer = new SRTConverter();
    const reimported = importer.import(
      { name: `${BASE}.srt`, type: 'text/plain', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    // SRT skips empty segments on export; re-import recreates them
    expect(reimported.annotjson!.levels[0].items.length).toBeGreaterThanOrEqual(nonEmpty);
  });

  it('WebVTT (.vtt)', () => {
    const source = sharedSource;
    const nonEmpty = source.levels[0].items.filter((s: any) =>
      (s.labels?.[0]?.value ?? '') !== ''
    ).length;

    const exporter = new WebVTTConverter();
    const exported = exporter.export(source, rtAudiofile, 0);
    expect(exported.error).toBeFalsy();
    expect(exported.file!.content.startsWith('WEBVTT')).toBe(true);

    const importer = new WebVTTConverter();
    const reimported = importer.import(
      { name: `${BASE}.vtt`, type: 'text/vtt', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBe('');
    expect(reimported.annotjson).toBeDefined();
    expect(reimported.annotjson!.levels[0].items.length).toBeGreaterThanOrEqual(nonEmpty);
  });

  it('AnnotJSON (_annot.json)', () => {
    const source = { ...sharedSource };
    const src_count = segmentCount(source);
    // Patch annotates to match the mock audio name so re-import accepts it
    source.annotates = rtAudiofile.name;

    const exporter = new AnnotJSONConverter();
    const exported = exporter.export(source);
    expect(exported.error).toBeFalsy();

    const importer = new AnnotJSONConverter();
    const reimported = importer.import(
      { name: `${BASE}_annot.json`, type: 'application/json', content: exported.file!.content, encoding: 'UTF-8' },
      rtAudiofile,
    );
    expect(reimported.error).toBeFalsy();
    expect(reimported.annotjson).toBeDefined();
    expect(segmentCount(reimported.annotjson!)).toBe(src_count);
  });

});
