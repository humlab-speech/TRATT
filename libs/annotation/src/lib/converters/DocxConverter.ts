import { OAudiofile } from '@octra/media';
import { OAnnotJSON, OSegment } from '../annotjson';
import {
  Converter,
  ExportCategory,
  ExportResult,
  IFile,
  ImportResult,
  OctraAnnotationFormatType,
} from './Converter';
import { WordApplication } from './SupportedApplications';
import { buildZip } from './zip-builder';

export class DocxConverter extends Converter {
  override _name: OctraAnnotationFormatType = 'DOCX';
  override _category: ExportCategory = 'general';

  public override options: {
    mode: 'separate' | 'continuous';
    addTimestamps: boolean;
    addSpeakerId: boolean;
    groupByTier: boolean;
    breakMarkerCode: string;
    uiLanguage: string;
  } = {
    mode: 'separate',
    addTimestamps: false,
    addSpeakerId: false,
    groupByTier: false,
    breakMarkerCode: '<P>',
    uiLanguage: '',
  };

  public constructor() {
    super();
    this._applications = [
      { application: new WordApplication(), recommended: true },
    ];
    this._extensions = ['.docx'];
    this._conversion = { export: true, import: false };
    this._encoding = 'binary';
    this._multitiers = false;
    this._multiTierExport = true;
  }

  export(
    annotation: OAnnotJSON,
    audiofile: OAudiofile,
    levelnum = 0,
    levelnums?: number[],
  ): ExportResult {
    if (!audiofile?.sampleRate) {
      return { error: 'Invalid audio file' };
    }

    const indices =
      levelnums && levelnums.length > 0
        ? levelnums.filter((i) => i >= 0 && i < annotation.levels.length)
        : [levelnum].filter((i) => i >= 0 && i < annotation.levels.length);

    if (indices.length === 0) {
      return { error: `Level ${levelnum} not found` };
    }

    const multi = indices.length > 1;
    const paragraphs: {
      text: string;
      heading?: boolean;
      separator?: boolean;
    }[] = [];

    const isSwedish =
      this.options.uiLanguage === 'sv' ||
      indices.some((i) => {
        const name = annotation.levels[i]?.name ?? '';
        return name === 'Swedish' || name.toLowerCase().includes('svenska');
      });

    const englishAck = [
      'The transcriptions below were produced using the TRATT tool, developed by Humlab at Umeå University, Språkbanken CLARIN, and our partners within CLARIN-ERIC.',
      'Please consider including the following acknowledgement:',
      '"This project has received technical support in its implementation from the national research infrastructure Språkbanken CLARIN, which is jointly funded by the Swedish Research Council (2025–2028, Grant No. 2023-00161-16) and the ten universities and government agencies that collaborate within the research infrastructure."',
      'in publications or theses, so that the support provided by the Språkbanken CLARIN research infrastructure is duly acknowledged.',
    ];

    const swedishAck = [
      'Transkriptionerna nedan skapades i verktyget TRATT, som utvecklats av Humlab vid Umeå universitet, Språkbanken CLARIN och våra samarbetspartners inom CLARIN-ERIC.',
      'Ange gärna',
      '"Detta projekt har fått tekniskt stöd i sitt genomförande av den nationella forskningsinfrastrukturen Språkbanken CLARIN, som finansieras gemensamt av Vetenskapsrådet (2025-2028, Dnr 2023-00161-16) och de 10 universitet och statliga myndigheter som samverkar inom forskningsinfrastrukturen."',
      'i publikationer eller uppsatser för att så att stödet från forskningsinfrastrukturen Språkbanken CLARIN synliggörs.',
    ];

    const ackTexts = isSwedish ? swedishAck : englishAck;
    for (const ackText of ackTexts) {
      paragraphs.push({ text: ackText });
    }
    paragraphs.push({ text: '', separator: true });

    const lineFor = (seg: OSegment, prefix?: string) => {
      const text = seg.getFirstLabelWithoutName('Speaker')?.value ?? '';
      if (!text.trim() || text.trim() === this.options.breakMarkerCode)
        return undefined;
      const tsPrefix = this.options.addTimestamps
        ? `[${this.msToTimeString(Math.round((seg.sampleStart / audiofile.sampleRate) * 1000))}] `
        : '';
      const speakerId = seg.labels?.find((l) => l.name === 'Speaker')?.value;
      const speakerPrefix =
        this.options.addSpeakerId && speakerId ? `[${speakerId}] ` : '';
      return (prefix ?? '') + tsPrefix + speakerPrefix + text.trim();
    };

    if (multi && !this.options.groupByTier) {
      // Utterance-major: interleave tiers per segment index.
      const levels = indices.map((i) => annotation.levels[i]);
      const maxLen = Math.max(...levels.map((l) => l.items.length));
      for (let j = 0; j < maxLen; j++) {
        if (this.options.mode === 'separate') {
          let emitted = 0;
          for (const level of levels) {
            if (j >= level.items.length) continue;
            const line = lineFor(
              level.items[j] as OSegment,
              `[${level.name}] `,
            );
            if (line !== undefined) {
              paragraphs.push({ text: line });
              emitted++;
            }
          }
          if (emitted > 0) {
            paragraphs.push({ text: '' });
          }
        } else {
          const parts: string[] = [];
          for (const level of levels) {
            if (j >= level.items.length) continue;
            const line = lineFor(
              level.items[j] as OSegment,
              `[${level.name}] `,
            );
            if (line !== undefined) parts.push(line);
          }
          if (parts.length > 0) {
            paragraphs.push({ text: parts.join(' ') });
          }
        }
      }
    } else {
      for (const idx of indices) {
        const level = annotation.levels[idx];
        if (multi) {
          paragraphs.push({ text: level.name, heading: true });
        }
        const segments = level.items as OSegment[];

        if (this.options.mode === 'separate') {
          for (const seg of segments) {
            const line = lineFor(seg);
            if (line !== undefined) paragraphs.push({ text: line });
          }
        } else {
          const parts: string[] = [];
          for (const seg of segments) {
            const line = lineFor(seg);
            if (line !== undefined) parts.push(line);
          }
          if (parts.length > 0) {
            paragraphs.push({ text: parts.join(' ') });
          }
        }
      }
    }

    const docxBytes = this.buildDocx(paragraphs);
    const baseName = audiofile.name.replace(/\.[^.]+$/, '');

    const file: IFile = {
      name: `${baseName}.docx`,
      content: docxBytes as unknown as string, // binary Uint8Array
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      encoding: 'binary',
    };
    return { file };
  }

  import(_file: IFile, _audiofile: OAudiofile): ImportResult {
    return { error: 'DOCX import not supported' };
  }

  needsOptionsForImport(_file: IFile, _audiofile: OAudiofile): undefined {
    return undefined;
  }

  private buildDocx(
    paragraphs: { text: string; heading?: boolean; separator?: boolean }[],
  ): Uint8Array {
    const enc = new TextEncoder();

    const contentTypes = enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '</Types>',
    );

    const rels = enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    );

    const wordRels = enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '</Relationships>',
    );

    const wordSettings = enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:defaultTabStop w:val="720"/>' +
        '</w:settings>',
    );

    const paras = paragraphs
      .map((p) => {
        if (p.separator) {
          return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr><w:r><w:t></w:t></w:r></w:p>`;
        }
        const text = `<w:t xml:space="preserve">${this.escapeXml(p.text)}</w:t>`;
        if (p.heading) {
          return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr>${text}</w:r></w:p>`;
        }
        return `<w:p><w:r>${text}</w:r></w:p>`;
      })
      .join('');

    const document = enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        paras +
        '<w:sectPr/>' +
        '</w:body>' +
        '</w:document>',
    );

    return buildZip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/_rels/document.xml.rels', data: wordRels },
      { name: 'word/settings.xml', data: wordSettings },
      { name: 'word/document.xml', data: document },
    ]);
  }
}
