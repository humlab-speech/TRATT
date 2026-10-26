import type { OAudiofile } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { OdtConverter } from './OdtConverter';

const audiofile: OAudiofile = {
  name: 'a.wav',
  size: 0,
  duration: 48000,
  sampleRate: 16000,
  type: 'audio/wav',
};

function contentXml(verifiedOf: boolean[], lang = 'en'): string {
  const level = new OSegmentLevel<OSegment>(
    'OCTRA_1',
    verifiedOf.map(
      (v, i) =>
        new OSegment(
          i + 1,
          i * 16000,
          16000,
          [new OLabel('OCTRA_1', `Sentence ${i + 1}`)],
          v,
        ),
    ),
  );
  const converter = new OdtConverter();
  converter.options.uiLanguage = lang;
  const result = converter.export(
    new OAnnotJSON('a.wav', 'a', 16000, [level]),
    audiofile,
    0,
  );
  expect(result.error).toBeFalsy();
  // Parts are STORED, so content.xml appears verbatim in the zip bytes.
  return new TextDecoder('utf-8').decode(
    result.file!.content as unknown as Uint8Array,
  );
}

describe('OdtConverter verification markers', () => {
  it('prefixes sentences with a coloured "| " and declares the styles', () => {
    const xml = contentXml([true, false]);
    expect(xml).toContain('fo:color="#5AA018"');
    expect(xml).toContain('fo:color="#F0581A"');
    expect(xml).toContain(
      '<text:span text:style-name="Tver">| </text:span>Sentence 1',
    );
    expect(xml).toContain(
      '<text:span text:style-name="Tnon">| </text:span>Sentence 2',
    );
  });

  it('puts a legend between the acknowledgement and the text', () => {
    const xml = contentXml([true]);
    const legend = xml.indexOf('= verified transcription');
    expect(legend).toBeGreaterThan(xml.indexOf('TRATT tool'));
    expect(legend).toBeLessThan(xml.indexOf('Sentence 1'));
  });

  it('writes the legend in Swedish and omits it for empty exports', () => {
    expect(contentXml([true], 'sv')).toContain('= verifierad');
    expect(contentXml([])).not.toContain('= verified transcription');
  });
});
