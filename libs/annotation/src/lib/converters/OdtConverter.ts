import { OAudiofile } from '@tratt/media';
import { OAnnotJSON, OSegment } from '../annotjson';
import {
  Converter,
  ExportCategory,
  ExportResult,
  IFile,
  ImportResult,
  TrattAnnotationFormatType,
} from './Converter';
import { LibreOfficeApplication } from './SupportedApplications';
import { buildZip } from './zip-builder';

export class OdtConverter extends Converter {
  override _name: TrattAnnotationFormatType = 'ODT';
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
      { application: new LibreOfficeApplication(), recommended: true },
    ];
    this._extensions = ['.odt'];
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
    const paragraphs: { text: string; heading?: boolean }[] = [];

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
      'i publikationer eller uppsatser så att stödet från forskningsinfrastrukturen synliggörs.',
    ];

    const ackTexts = isSwedish ? swedishAck : englishAck;
    for (const ackText of ackTexts) {
      paragraphs.push({ text: ackText });
    }
    paragraphs.push({ text: '─'.repeat(64) });

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

    const odtBytes = this.buildOdt(paragraphs);
    const baseName = audiofile.name.replace(/\.[^.]+$/, '');

    const file: IFile = {
      name: `${baseName}.odt`,
      content: odtBytes as unknown as string,
      type: 'application/vnd.oasis.opendocument.text',
      encoding: 'binary',
    };
    return { file };
  }

  import(_file: IFile, _audiofile: OAudiofile): ImportResult {
    return { error: 'ODT import not supported' };
  }

  needsOptionsForImport(_file: IFile, _audiofile: OAudiofile): undefined {
    return undefined;
  }

  private buildOdt(
    paragraphs: { text: string; heading?: boolean }[],
  ): Uint8Array {
    const enc = new TextEncoder();

    // mimetype MUST be the first entry per ODF spec, STORED (no compression)
    const mimetype = enc.encode('application/vnd.oasis.opendocument.text');

    const manifest = enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<manifest:manifest' +
        ' xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"' +
        ' manifest:version="1.2">' +
        '<manifest:file-entry manifest:full-path="/"' +
        ' manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
        '<manifest:file-entry manifest:full-path="content.xml"' +
        ' manifest:media-type="text/xml"/>' +
        '</manifest:manifest>',
    );

    const paras = paragraphs
      .map((p) => {
        const style = p.heading ? 'Heading_20_1' : 'Standard';
        return `<text:p text:style-name="${style}">${this.escapeXml(p.text)}</text:p>`;
      })
      .join('');

    const content = enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<office:document-content' +
        ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
        ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
        ' office:version="1.2">' +
        '<office:body><office:text>' +
        paras +
        '</office:text></office:body>' +
        '</office:document-content>',
    );

    return buildZip([
      { name: 'mimetype', data: mimetype },
      { name: 'META-INF/manifest.xml', data: manifest },
      { name: 'content.xml', data: content },
    ]);
  }
}
