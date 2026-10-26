import type { OAudiofile } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { DocxConverter } from './DocxConverter';

const audiofile: OAudiofile = {
  name: 'a.wav',
  size: 0,
  duration: 48000,
  sampleRate: 16000,
  type: 'audio/wav',
};

function makeAnnot(verifiedOf: boolean[]): OAnnotJSON {
  const level = new OSegmentLevel<OSegment>(
    'OCTRA_1',
    verifiedOf.map((verified, i) => {
      const start = i * 16000;
      return new OSegment(
        i + 1,
        start,
        16000,
        [new OLabel('OCTRA_1', `Sentence ${i + 1}`)],
        verified,
      );
    }),
  );
  return new OAnnotJSON('a.wav', 'a', 16000, [level]);
}

/**
 * The generated .docx zip stores every part uncompressed (STORED), so
 * word/document.xml appears verbatim inside the returned bytes.
 */
function documentXml(converter: DocxConverter, annot: OAnnotJSON): string {
  const result = converter.export(annot, audiofile, 0);
  expect(result.error).toBeFalsy();
  // The converter ships the binary as a Uint8Array inside the
  // string-typed IFile.content (its own established convention).
  const content = result.file!.content as unknown as Uint8Array;
  return new TextDecoder('utf-8').decode(content);
}

describe('DocxConverter verification markers', () => {
  it('prefixes each sentence paragraph with a colored "| " marker', () => {
    const converter = new DocxConverter();
    const xml = documentXml(converter, makeAnnot([true, false]));

    const markerFor = (color: string) =>
      `<w:r><w:rPr><w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">| </w:t></w:r>`;

    expect(xml).toContain(markerFor('5AA018'));
    expect(xml).toContain(markerFor('F0581A'));

    // Green marker directly precedes the verified sentence.
    expect(xml).toContain(
      `${markerFor('5AA018')}<w:r><w:t xml:space="preserve">Sentence 1</w:t></w:r>`,
    );
    // Orange marker directly precedes the non-verified sentence.
    expect(xml).toContain(
      `${markerFor('F0581A')}<w:r><w:t xml:space="preserve">Sentence 2</w:t></w:r>`,
    );

    // Each sentence is its own paragraph, one per line.
    const paragraphCount = xml.split('<w:p>').length - 1;
    expect(paragraphCount).toBeGreaterThanOrEqual(2);
  });

  it('marks every sentence in continuous mode with its own marker', () => {
    const converter = new DocxConverter();
    converter.options.mode = 'continuous';
    const xml = documentXml(converter, makeAnnot([true, false]));

    const greenMarker =
      '<w:r><w:rPr><w:color w:val="5AA018"/></w:rPr><w:t xml:space="preserve">| </w:t></w:r>';
    const orangeMarker =
      '<w:r><w:rPr><w:color w:val="F0581A"/></w:rPr><w:t xml:space="preserve">| </w:t></w:r>';

    // Both sentences sit in one paragraph, separated by a plain space run,
    // each preceded by its own marker.
    expect(xml).toContain(
      `${greenMarker}<w:r><w:t xml:space="preserve">Sentence 1</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${orangeMarker}<w:r><w:t xml:space="preserve">Sentence 2</w:t></w:r>`,
    );
  });

  it('emits no marker paragraph for empty or break-marker segments', () => {
    const converter = new DocxConverter();
    const level = new OSegmentLevel<OSegment>('OCTRA_1', [
      new OSegment(1, 0, 16000, [new OLabel('OCTRA_1', '')]),
      new OSegment(2, 16000, 16000, [new OLabel('OCTRA_1', '<P>')]),
      new OSegment(3, 32000, 16000, [new OLabel('OCTRA_1', 'Real text')]),
    ]);
    const annot = new OAnnotJSON('a.wav', 'a', 16000, [level]);
    const xml = documentXml(converter, annot);

    expect(xml).toContain('Real text');
    // Only the third segment produced a marked sentence line (+2 legend bars).
    expect(xml.match(/w:color w:val="(?:5AA018|F0581A)"/g)).toHaveLength(3);
    expect(xml.match(/\| <\/w:t>/g)).toHaveLength(1);
  });

  it('keeps acknowledgements and separators unmarked', () => {
    const converter = new DocxConverter();
    const xml = documentXml(converter, makeAnnot([true]));

    // The acknowledgement runs precede the first marker; the marker only
    // appears for the transcription line itself.
    const firstMarkerIndex = xml.indexOf('<w:color w:val="5AA018"/>');
    expect(firstMarkerIndex).toBeGreaterThan(0);
    expect(xml.indexOf('TRATT tool')).toBeLessThan(firstMarkerIndex);
  });
});

describe('DocxConverter verification legend', () => {
  it('explains the coloured bars after the acknowledgement', () => {
    const xml = documentXml(new DocxConverter(), makeAnnot([true, false]));
    const legend = xml.indexOf('= verified transcription');
    expect(legend).toBeGreaterThan(xml.indexOf('TRATT tool'));
    expect(legend).toBeLessThan(xml.indexOf('Sentence 1'));
    expect(xml).toContain(
      '<w:color w:val="5AA018"/></w:rPr><w:t xml:space="preserve">|</w:t>',
    );
  });

  it('writes the legend in Swedish when asked', () => {
    const converter = new DocxConverter();
    converter.options.uiLanguage = 'sv';
    expect(documentXml(converter, makeAnnot([true]))).toContain('= verifierad');
  });

  it('omits the legend when no line is exported', () => {
    expect(documentXml(new DocxConverter(), makeAnnot([]))).not.toContain(
      '= verified transcription',
    );
  });
});
