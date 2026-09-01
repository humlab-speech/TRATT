import { describe, expect, it } from 'vitest';
import { SRTConverter } from './SRTConverter';

const SR = 48000;

function audiofile(duration: number) {
  return {
    name: 'test.wav',
    size: 0,
    duration,
    sampleRate: SR,
    arraybuffer: undefined,
  };
}

function srtFile(content: string) {
  return { name: 'test.srt', type: 'text/srt', content, encoding: 'UTF-8' };
}

describe('SRTConverter — multi-line cues (B3)', () => {
  const c = new SRTConverter();
  const audio = audiofile(SR * 10); // 10 s

  it('keeps every line of a multi-line cue', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Line one',
      'Line two',
      '',
      '2',
      '00:00:02,000 --> 00:00:04,000',
      'Hello world',
      '',
    ].join('\n');

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts).toContain('Line one\nLine two');
    expect(texts).toContain('Hello world');
  });

  it('still parses the second cue after a multi-line first cue (regression: the old regex could fail to find it at all)', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Line one',
      'Line two',
      '',
      '2',
      '00:00:02,000 --> 00:00:04,000',
      'Second cue',
      '',
    ].join('\n');

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts.some((t: string) => t.includes('Second cue'))).toBe(true);
  });

  it('still parses a single-line cue correctly (no regression)', () => {
    const srt = ['1', '00:00:00,000 --> 00:00:02,000', 'Hello world', ''].join(
      '\n',
    );

    const r = c.import(srtFile(srt), audio as any);
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const texts = items
      .map((it: any) => it.labels?.[0]?.value)
      .filter((v: string | undefined) => v !== undefined && v !== '');
    expect(texts).toContain('Hello world');
  });
});
