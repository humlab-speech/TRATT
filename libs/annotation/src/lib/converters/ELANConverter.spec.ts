import { describe, expect, it } from 'vitest';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { ELANConverter } from './ELANConverter';

const SR = 16000;
const audio = {
  name: 'talk.wav',
  size: 0,
  duration: SR * 3, // 3 s
  sampleRate: SR,
  arraybuffer: undefined,
} as any;

/** Two levels (transcript + translation), both diarized. */
function diarized(): OAnnotJSON {
  const level = (name: string, a: string, b: string) =>
    new OSegmentLevel<OSegment>(name, [
      new OSegment(1, 0, SR, [
        new OLabel(name, a),
        new OLabel('Speaker', 'Speaker 1'),
      ]),
      new OSegment(2, SR, SR * 2, [
        new OLabel(name, b),
        new OLabel('Speaker', 'Speaker 2'),
      ]),
    ]);
  const annotation = new OAnnotJSON('talk.wav', 'talk', SR);
  annotation.levels.push(
    level('English (en)', 'Hello there', 'Hi'),
    level('German (de)', 'Hallo', 'Hi'),
  );
  return annotation;
}

const eaf = (content: string) => ({
  name: 'talk.eaf',
  type: 'text/xml',
  content,
  encoding: 'UTF-8',
});

describe('ELANConverter — speakers', () => {
  it('keeps each level as a tier and its speakers in a dependent tier', () => {
    const result = new ELANConverter().export(diarized(), audio);
    expect(result.error).toBeFalsy();
    const xml = result.file!.content;

    for (const tier of ['English (en)', 'German (de)']) {
      expect(xml).toContain(`TIER_ID="${tier}"`);
      expect(xml).toMatch(
        new RegExp(
          `<TIER[^>]*TIER_ID="${tier.replace(/[()]/g, '\\$&')} - Speaker"[^>]*PARENT_REF="${tier.replace(/[()]/g, '\\$&')}"`,
        ),
      );
    }
    expect(xml).toContain('<REF_ANNOTATION ANNOTATION_ID=');
    expect(xml).toContain('ANNOTATION_REF="a1"');
    expect(xml).toContain('<ANNOTATION_VALUE>Speaker 2</ANNOTATION_VALUE>');
    expect(xml).toMatch(
      /LINGUISTIC_TYPE_ID="speaker"[^>]*CONSTRAINTS="Symbolic_Association"|CONSTRAINTS="Symbolic_Association"[^>]*LINGUISTIC_TYPE_ID="speaker"/,
    );
    expect(xml).toContain('STEREOTYPE="Symbolic_Association"');
    // The text tiers carry the text, not the speaker.
    expect(xml).toContain('<ANNOTATION_VALUE>Hello there</ANNOTATION_VALUE>');
  });

  it('writes no speaker tier when nothing is diarized', () => {
    const annotation = new OAnnotJSON('talk.wav', 'talk', SR);
    annotation.levels.push(
      new OSegmentLevel<OSegment>('Swedish', [
        new OSegment(1, 0, SR * 3, [new OLabel('Swedish', 'Hej')]),
      ]),
    );
    const xml = new ELANConverter().export(annotation, audio).file!.content;
    expect(xml).not.toContain('PARENT_REF');
    expect(xml).not.toContain('CONSTRAINT');
  });

  it('reads the speaker tiers back as Speaker labels (round trip)', () => {
    const exported = new ELANConverter().export(diarized(), audio);
    const reimported = new ELANConverter().import(
      eaf(exported.file!.content),
      audio,
    );
    expect(reimported.error).toBe('');
    const levels = reimported.annotjson!.levels;
    expect(levels.map((l) => l.name)).toEqual(['English (en)', 'German (de)']);
    for (const level of levels) {
      const items = level.items as OSegment[];
      expect(
        items.map((i) => i.labels.find((a) => a.name === 'Speaker')?.value),
      ).toEqual(['Speaker 1', 'Speaker 2']);
    }
    expect(
      (levels[0].items as OSegment[]).map(
        (i) => i.labels.find((a) => a.name === 'English (en)')?.value,
      ),
    ).toEqual(['Hello there', 'Hi']);
  });

  it('skips other reference tiers instead of failing on them', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ANNOTATION_DOCUMENT AUTHOR="" DATE="2026-01-01T00:00:00Z" FORMAT="3.0" VERSION="3.0">
  <HEADER TIME_UNITS="milliseconds"/>
  <TIME_ORDER>
    <TIME_SLOT TIME_SLOT_ID="ts1" TIME_VALUE="0"/>
    <TIME_SLOT TIME_SLOT_ID="ts2" TIME_VALUE="3000"/>
  </TIME_ORDER>
  <TIER LINGUISTIC_TYPE_REF="default" TIER_ID="words">
    <ANNOTATION><ALIGNABLE_ANNOTATION ANNOTATION_ID="a1" TIME_SLOT_REF1="ts1" TIME_SLOT_REF2="ts2"><ANNOTATION_VALUE>hello</ANNOTATION_VALUE></ALIGNABLE_ANNOTATION></ANNOTATION>
  </TIER>
  <TIER LINGUISTIC_TYPE_REF="gloss" PARENT_REF="words" TIER_ID="gloss">
    <ANNOTATION><REF_ANNOTATION ANNOTATION_ID="a2" ANNOTATION_REF="a1"><ANNOTATION_VALUE>greeting</ANNOTATION_VALUE></REF_ANNOTATION></ANNOTATION>
  </TIER>
  <LINGUISTIC_TYPE LINGUISTIC_TYPE_ID="default" TIME_ALIGNABLE="true"/>
  <LINGUISTIC_TYPE CONSTRAINTS="Symbolic_Association" LINGUISTIC_TYPE_ID="gloss" TIME_ALIGNABLE="false"/>
</ANNOTATION_DOCUMENT>`;
    const result = new ELANConverter().import(eaf(xml), audio);
    expect(result.error).toBe('');
    const levels = result.annotjson!.levels;
    expect(levels.map((l) => l.name)).toEqual(['words']);
    expect((levels[0].items[0] as OSegment).labels.map((a) => a.name)).toEqual([
      'words',
    ]);
  });
});
