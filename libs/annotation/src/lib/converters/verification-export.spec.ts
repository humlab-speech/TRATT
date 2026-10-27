import { SampleUnit } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import { TrattAnnotation } from '../annotation';
import { OLabel } from '../annotjson';
import { TrattAnnotationSegment } from '../trattAnnotationSegment';
import { CTMConverter } from './CTMConverter';
import { ELANConverter } from './ELANConverter';
import { NOT_CHECK_MARK } from './not-check-mark';
import { PartiturConverter } from './PartiturConverter';
import { PraatTableConverter } from './PraatTableConverter';
import { PraatTextgridConverter } from './PraatTextgridConverter';
import { SRTConverter } from './SRTConverter';
import { WebVTTConverter } from './WebVTTConverter';

const SR = 48000;

/**
 * Mirrors the app's export flow exactly: the editor's transcript is
 * serialized to an OAnnotJSON first (export-files-modal /
 * catalogue-export), then the converter runs against it. Non-verified
 * transcriptions must end with the not-check mark in every time-aligned
 * format.
 */
function serializedAnnotation() {
  const transcript = new TrattAnnotation<TrattAnnotationSegment>();
  const level = transcript.createSegmentLevel('Transcript', [
    new TrattAnnotationSegment(
      1,
      new SampleUnit(SR, SR),
      [new OLabel('Transcript', 'Not listened')],
      false,
    ),
    new TrattAnnotationSegment(
      2,
      new SampleUnit(SR * 2, SR),
      [new OLabel('Transcript', 'Listened')],
      true,
    ),
  ]);
  transcript.addLevel(level);
  transcript.changeCurrentLevelIndex(0);
  return transcript.serialize('audio.wav', SR, new SampleUnit(SR * 2, SR));
}

const audio = {
  name: 'audio.wav',
  size: 0,
  duration: SR * 2,
  sampleRate: SR,
  arraybuffer: undefined,
} as never;

function assertMarked(content: string): void {
  expect(content).toContain(`Not listened${NOT_CHECK_MARK}`);
  expect(content).toContain('Listened');
  expect(content).not.toContain(`Listened${NOT_CHECK_MARK}`);
}

describe('verification mark in time-aligned exports (serialize → export)', () => {
  it('SRT', () => {
    const result = new SRTConverter().export(serializedAnnotation(), audio, 0);
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('WebVTT', () => {
    const result = new WebVTTConverter().export(
      serializedAnnotation(),
      audio,
      0,
    );
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('ELAN', () => {
    const result = new ELANConverter().export(serializedAnnotation(), audio);
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('Praat TextGrid', () => {
    const result = new PraatTextgridConverter().export(
      serializedAnnotation(),
      audio,
    );
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('Praat Table', () => {
    const result = new PraatTableConverter().export(
      serializedAnnotation(),
      audio,
    );
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('CTM', () => {
    const result = new CTMConverter().export(serializedAnnotation(), audio, 0);
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('BAS Partitur', () => {
    const result = new PartiturConverter().export(
      serializedAnnotation(),
      audio,
      0,
    );
    expect(result.error).toBeFalsy();
    assertMarked(result.file!.content as string);
  });

  it('round-trips through SRT: verification is conservatively reset to unverified on import', () => {
    const exported = new SRTConverter().export(
      serializedAnnotation(),
      audio,
      0,
    );
    const reimported = new SRTConverter().import(
      {
        name: 'audio.srt',
        type: 'text/srt',
        content: exported.file!.content as string,
        encoding: 'UTF-8',
      },
      audio,
    );
    expect(reimported.error).toBe('');
    const items = reimported.annotjson!.levels[0].items;
    expect(items.map((item) => item.verified)).toEqual([false, false]);
    expect(items[0].labels[0].value).toBe('Not listened');
  });
});
