import { describe, expect, it } from 'vitest';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { NOT_CHECK_MARK } from './not-check-mark';
import {
  WebVTTConverter,
  WebVTTConverterImportOptions,
} from './WebVTTConverter';

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

function vttFile(content: string) {
  return { name: 'test.vtt', type: 'text/vtt', content, encoding: 'UTF-8' };
}

/** Build a minimal VTT string from cue objects. */
function buildVtt(
  cues: Array<{ start: string; end: string; text: string; id?: string }>,
): string {
  const blocks = cues.map((c) => {
    const id = c.id ? `${c.id}\n` : '';
    return `${id}${c.start} --> ${c.end}\n${c.text}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

// ── parseVttCueText via import round-trip ─────────────────────────────────

describe('WebVTTConverter — inline tag stripping', () => {
  const c = new WebVTTConverter();
  const audio = audiofile(SR * 10); // 10 s

  it('strips <b>, <i>, <u> formatting tags', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:03.000',
        text: '<b>bold</b> and <i>italic</i>',
      },
    ]);
    const r = c.import(vttFile(vtt), audio);
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const seg = items.find((s: any) => s.labels?.[0]?.value?.trim() !== '');
    expect(seg!.labels[0].value).toBe('bold and italic');
  });

  it('strips <c.class> tags', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:03.000',
        text: '<c.yellow>coloured</c>',
      },
    ]);
    const r = c.import(vttFile(vtt), audio);
    expect(r.error).toBe('');
    const seg = r.annotjson!.levels[0].items.find(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(seg!.labels[0].value).toBe('coloured');
  });

  it('strips inline timestamp tags', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:03.000',
        text: '<00:00:01.500>Hello <00:00:02.000>world',
      },
    ]);
    const r = c.import(vttFile(vtt), audio);
    expect(r.error).toBe('');
    const seg = r.annotjson!.levels[0].items.find(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(seg!.labels[0].value).toBe('Hello world');
  });

  it('decodes HTML entities', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:03.000',
        text: 'AT&amp;T &lt;rocks&gt;',
      },
    ]);
    const r = c.import(vttFile(vtt), audio);
    expect(r.error).toBe('');
    const seg = r.annotjson!.levels[0].items.find(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(seg!.labels[0].value).toBe('AT&T <rocks>');
  });
});

// ── voice tag / speaker extraction ───────────────────────────────────────

describe('WebVTTConverter — speaker extraction', () => {
  const c = new WebVTTConverter();
  const audio = audiofile(SR * 10);

  it('extracts speaker from <v Name> tag', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:03.000',
        text: '<v Alice>Hello there</v>',
      },
    ]);
    const r = c.import(vttFile(vtt), audio);
    expect(r.error).toBe('');
    const seg = r.annotjson!.levels[0].items.find(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(seg!.labels[0].value).toBe('Hello there');
    expect(seg!.labels.find((l: any) => l.name === 'Speaker')?.value).toBe(
      'Alice',
    );
  });

  it('extractSpeakers = false leaves voice tags stripped but no Speaker label', () => {
    const vtt = buildVtt([
      { start: '00:00:01.000', end: '00:00:03.000', text: '<v Bob>Hi</v>' },
    ]);
    const r = c.import(
      vttFile(vtt),
      audio,
      new WebVTTConverterImportOptions({ extractSpeakers: false }),
    );
    expect(r.error).toBe('');
    const seg = r.annotjson!.levels[0].items.find(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(seg!.labels[0].value).toBe('Hi');
    expect(seg!.labels.find((l: any) => l.name === 'Speaker')).toBeUndefined();
  });

  it('sortSpeakerSegments = true creates one level per speaker', () => {
    const vtt = buildVtt([
      {
        start: '00:00:01.000',
        end: '00:00:02.000',
        text: '<v Alice>Hello</v>',
      },
      { start: '00:00:02.000', end: '00:00:03.000', text: '<v Bob>Hi</v>' },
      { start: '00:00:03.000', end: '00:00:04.000', text: '<v Alice>Bye</v>' },
    ]);
    const r = c.import(
      vttFile(vtt),
      audio,
      new WebVTTConverterImportOptions({
        extractSpeakers: true,
        sortSpeakerSegments: true,
      }),
    );
    expect(r.error).toBe('');
    expect(r.annotjson!.levels.length).toBe(2);
    const names = r.annotjson!.levels.map((l: any) => l.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });
});

// ── cue identifier support ───────────────────────────────────────────────

describe('WebVTTConverter — cue identifiers', () => {
  it('parses cues with optional identifier lines', () => {
    const vtt = `WEBVTT\n\ncue-001\n00:00:01.000 --> 00:00:03.000\nHello\n\ncue-002\n00:00:03.000 --> 00:00:05.000\nWorld\n`;
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(SR * 10));
    expect(r.error).toBe('');
    const nonEmpty = r.annotjson!.levels[0].items.filter(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(nonEmpty.length).toBe(2);
    expect(nonEmpty[0].labels[0].value).toBe('Hello');
    expect(nonEmpty[1].labels[0].value).toBe('World');
  });
});

// ── NOTE / STYLE / REGION blocks ignored ─────────────────────────────────

describe('WebVTTConverter — non-cue block handling', () => {
  it('ignores NOTE blocks', () => {
    const vtt = `WEBVTT\n\nNOTE This is a comment\nspanning multiple lines\n\n00:00:01.000 --> 00:00:03.000\nHello\n`;
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(SR * 10));
    expect(r.error).toBe('');
    const nonEmpty = r.annotjson!.levels[0].items.filter(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(nonEmpty.length).toBe(1);
    expect(nonEmpty[0].labels[0].value).toBe('Hello');
  });

  it('ignores STYLE blocks', () => {
    const vtt = `WEBVTT\n\nSTYLE\n::cue { color: red; }\n\n00:00:01.000 --> 00:00:03.000\nStyled\n`;
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(SR * 10));
    expect(r.error).toBe('');
    const nonEmpty = r.annotjson!.levels[0].items.filter(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(nonEmpty.length).toBe(1);
  });
});

// ── flexible timestamp format ────────────────────────────────────────────

describe('WebVTTConverter — flexible timestamps', () => {
  it('parses MM:SS.mmm timestamps (no hours)', () => {
    const vtt = `WEBVTT\n\n00:01.000 --> 00:03.000\nHello\n`;
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(SR * 10));
    expect(r.error).toBe('');
    const nonEmpty = r.annotjson!.levels[0].items.filter(
      (s: any) => s.labels?.[0]?.value?.trim() !== '',
    );
    expect(nonEmpty.length).toBe(1);
    // 1s at 48000 Hz = 48000 samples
    expect(nonEmpty[0].sampleStart).toBe(48000);
    expect(nonEmpty[0].sampleDur).toBe(96000);
  });
});

// ── lastEnd scoping fix ───────────────────────────────────────────────────

describe('WebVTTConverter — gap tracking', () => {
  it('contiguous cues produce no duplicate segments', () => {
    // 3 back-to-back cues with no gaps; only one leading empty segment (0→1s)
    const vtt = buildVtt([
      { start: '00:00:01.000', end: '00:00:02.000', text: 'A' },
      { start: '00:00:02.000', end: '00:00:03.000', text: 'B' },
      { start: '00:00:03.000', end: '00:00:04.000', text: 'C' },
    ]);
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(SR * 5));
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    // Expect: [0→1s empty], [1s A], [2s B], [3s C], [4s→5s trailing empty] = 5
    expect(items.length).toBe(5);
    // No overlapping segments
    for (let i = 1; i < items.length; i++) {
      expect(items[i].sampleStart).toBe(
        items[i - 1].sampleStart + items[i - 1].sampleDur,
      );
    }
  });
});

// ── boundary check (timeEnd === duration) ────────────────────────────────

describe('WebVTTConverter — boundary check', () => {
  it('accepts cue whose end equals audio duration', () => {
    const dur = SR * 5; // 5 s
    const vtt = buildVtt([
      { start: '00:00:01.000', end: '00:00:05.000', text: 'Last' },
    ]);
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(dur));
    expect(r.error).toBe('');
  });

  it('clamps cue whose end exceeds audio duration (ms-rounding tolerance)', () => {
    const dur = SR * 4; // 4 s — last cue ends at 5 s
    const vtt = buildVtt([
      { start: '00:00:01.000', end: '00:00:05.000', text: 'Clamped' },
    ]);
    const c = new WebVTTConverter();
    const r = c.import(vttFile(vtt), audiofile(dur));
    // Import succeeds; last segment is clamped to audio boundary
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items;
    const last = items[items.length - 1];
    expect(last.sampleStart! + last.sampleDur!).toBe(dur);
  });
});

describe('WebVTTConverter — not-check mark round trip', () => {
  it('exports the mark for non-verified segments and reads it back', () => {
    const c = new WebVTTConverter();
    const audio = audiofile(SR * 2); // 2 s

    const annotation = new OAnnotJSON('test.wav', 'test', SR);
    annotation.levels.push(
      new OSegmentLevel<OSegment>('OCTRA_1', [
        new OSegment(1, 0, SR, [new OLabel('OCTRA_1', 'Hello')], false),
        new OSegment(2, SR, SR, [new OLabel('OCTRA_1', 'World')], true),
      ]),
    );

    const exported = c.export(annotation, audio as any, 0);
    const vtt = exported.file!.content as string;
    expect(vtt).toContain(`Hello${NOT_CHECK_MARK}`);
    expect(vtt).toContain('World');
    expect(vtt).not.toContain(`World${NOT_CHECK_MARK}`);

    const r = c.import(vttFile(vtt), audio as any);
    expect(r.error).toBe('');
    const items = r.annotjson!.levels[0].items as OSegment[];
    expect(items.map((i) => i.verified)).toEqual([false, true]);
    expect(items[0].labels[0].value).toBe('Hello');
  });
});
