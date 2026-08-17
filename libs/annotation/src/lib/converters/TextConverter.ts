import { OAudiofile } from '@tratt/media';
import { FileInfo } from '@tratt/web-media';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import {
  Converter,
  ExportResult,
  IFile,
  ImportResult,
  TrattAnnotationFormatType,
} from './Converter';
import {
  AnyTextEditor,
  BASWebservicesApplication,
  OctraApplication,
  WordApplication,
} from './SupportedApplications';

// https://clarin.phonetik.uni-muenchen.de/BASWebServices/#/services/WebMAUSBasic
export class TextConverter extends Converter {
  override _name: TrattAnnotationFormatType = 'PlainText';

  public override options = {
    showTimestampSamples: false,
    showTimestampString: false,
    addNewLineString: false,
    addSpeakerId: false,
    groupByTier: false,
    breakMarkerCode: '<P>',
    uiLanguage: '',
  };

  public constructor() {
    super();
    this._applications = [
      {
        application: new OctraApplication(),
      },
      {
        application: new BASWebservicesApplication(),
      },
      {
        application: new WordApplication(),
      },
      {
        application: new AnyTextEditor(),
      },
    ];
    this._extensions = ['.txt'];
    this._conversion.export = true;
    this._conversion.import = true;
    this._encoding = 'UTF-8';
    this._category = 'general';
    this._multitiers = false;
    this._multiTierExport = true;
  }

  public export(
    annotation: OAnnotJSON,
    audiofile: OAudiofile,
    levelnum?: number,
    levelnums?: number[],
  ): ExportResult {
    if (!annotation) {
      return {
        error: 'Annotation is undefined or null',
      };
    }

    if (!audiofile?.sampleRate) {
      return {
        error: 'Annotation is undefined or null',
      };
    }

    const indices =
      levelnums && levelnums.length > 0
        ? levelnums.filter((i) => i >= 0 && i < annotation.levels.length)
        : levelnum !== undefined &&
            levelnum >= 0 &&
            levelnum < annotation.levels.length
          ? [levelnum]
          : [];

    if (indices.length === 0) {
      return { error: 'Missing level number' };
    }

    const multi = indices.length > 1;
    const segmentLevels = indices
      .map((i) => annotation.levels[i])
      .filter((l) => l.type === 'SEGMENT');

    const noTimestamps =
      !this.options.showTimestampString && !this.options.showTimestampSamples;

    const speakerPrefixOf = (item: OSegment) => {
      const speakerId = item.labels?.find((l) => l.name === 'Speaker')?.value;
      return this.options.addSpeakerId && speakerId ? `[${speakerId}] ` : '';
    };

    const timestampSuffixOf = (item: OSegment) => {
      if (
        !this.options.showTimestampString &&
        !this.options.showTimestampSamples
      ) {
        return '';
      }
      const sampleEnd = item.sampleStart + item.sampleDur;
      const unixTimestamp = Math.ceil(
        (sampleEnd * 1000) / audiofile.sampleRate,
      );
      let s = ' <';
      if (this.options.showTimestampString) {
        const endTime = this.convertToTimeString(unixTimestamp, {
          showHour: true,
          showMilliSeconds: true,
        });
        s += `ts="${endTime}"`;
      }
      if (this.options.showTimestampSamples) {
        s += this.options.showTimestampString ? ' ' : '';
        s += `sp="${sampleEnd}"`;
      }
      s += '>';
      return s;
    };

    let result: string;

    if (multi && !this.options.groupByTier) {
      // Utterance-major: interleave tiers per segment index.
      const maxLen = Math.max(...segmentLevels.map((l) => l.items.length));
      const groups: string[] = [];
      for (let j = 0; j < maxLen; j++) {
        const lines: string[] = [];
        for (let t = 0; t < segmentLevels.length; t++) {
          const level = segmentLevels[t];
          if (j >= level.items.length) continue;
          const item = level.items[j] as OSegment;
          const transcript =
            item.getFirstLabelWithoutName('Speaker')?.value ?? '';
          if (
            noTimestamps &&
            transcript.trim() === this.options.breakMarkerCode
          ) {
            continue;
          }
          if (!transcript.trim()) continue;
          let line = `[${level.name}] ${speakerPrefixOf(item)}${transcript}`;
          if (t === segmentLevels.length - 1) {
            line += timestampSuffixOf(item);
          }
          line = line.replace(/ +/g, ' ');
          lines.push(line);
        }
        if (lines.length > 0) {
          groups.push(lines.join('\n'));
        }
      }
      result = groups.join('\n\n');
    } else {
      const tierBlocks: string[] = [];
      for (const level of segmentLevels) {
        let block = '';
        for (let j = 0; j < level.items.length; j++) {
          const item = level.items[j] as OSegment;
          const transcript =
            item.getFirstLabelWithoutName('Speaker')?.value ?? '';
          if (
            noTimestamps &&
            transcript.trim() === this.options.breakMarkerCode
          ) {
            continue;
          }
          block += speakerPrefixOf(item) + transcript;
          if (j < level.items.length - 1) {
            block += timestampSuffixOf(item);
            block += this.options.addNewLineString ? '\n' : ' ';
          }
        }
        block = block.replace(/ +/g, ' ');
        const header = multi ? `=== ${level.name} ===\n` : '';
        tierBlocks.push(header + block);
      }
      result = tierBlocks.join('\n\n');
    }

    let filename = `${annotation.name}`;
    if (!multi && annotation.levels.length > 1) {
      filename += `-${annotation.levels[indices[0]].name}`;
    }
    filename += `${this._extensions[0]}`;

    result = result.replace(/ +/g, ' ');

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
    const separator = '─'.repeat(64);
    result = ackTexts.join('\n\n') + '\n\n' + separator + '\n\n' + result;

    return {
      file: {
        name: filename,
        content: result,
        encoding: 'UTF-8',
        type: 'text/plain',
      },
    };
  }

  override needsOptionsForImport(
    file: IFile,
    audiofile: OAudiofile,
  ): any | undefined {
    return undefined;
  }

  public import(file: IFile, audiofile: OAudiofile): ImportResult {
    const hasTextExtension = this._extensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    );
    if (!hasTextExtension && file.type !== 'text/plain') {
      return {
        error: 'Not a plain text file',
      };
    }

    if (!audiofile?.sampleRate) {
      return {
        error: 'Missing sample rate',
      };
    }
    if (!audiofile?.name) {
      return {
        error: 'Missing audiofile name',
      };
    }
    if (!audiofile?.duration) {
      return {
        error: 'Missing audiofile duration',
      };
    }

    if (!audiofile?.duration) {
      return {
        error: 'Missing duration',
      };
    }

    const result = new OAnnotJSON(
      audiofile.name,
      FileInfo.extractFileName(file.name).name,
      audiofile.sampleRate,
      [],
      [],
    );
    const olevel = new OSegmentLevel('OCTRA_1');

    if (file.content.indexOf('<ts') > -1 || file.content.indexOf('<sp') > -1) {
      // segments available
      const regexSplit =
        /<(?:(?:(?:(?:ts)|(?:sp))="(?:(?:[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,3})|[0-9]+)")(?: ?(?:(?:(?:ts)|(?:sp)))="(?:(?:[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,3})|[0-9]+)")?\/?>)/g;
      const regexExtract = new RegExp(
        /<(?:(?:((?:ts)|(?:sp))="((?:[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,3})|[0-9]+)")(?: ?(?:((?:ts)|(?:sp)))="((?:[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,3})|[0-9]+)")?(?= *\/?>))/g,
      );
      const transcripts = file.content.split(regexSplit);
      let match = regexExtract.exec(file.content);
      let i = 0;
      let sampleStart = 0;

      if (match !== undefined) {
        // all fine

        while (match !== null) {
          const olabels: OLabel[] = [];
          let samplePoint = 0;
          const samplePointIndex = match.findIndex((a) => a === 'sp');

          if (samplePointIndex > -1 && samplePointIndex + 1 < match.length) {
            // use sample point
            samplePoint = Number(match[samplePointIndex + 1]);
          } else {
            const timeStringIndex = match.findIndex((a) => a === 'ts');
            if (timeStringIndex > -1 && timeStringIndex + 1 < match.length) {
              // use time string
              const timeString = match[timeStringIndex + 1];
              samplePoint = this.timeStringToSamples(
                timeString,
                audiofile.sampleRate,
              );

              if (samplePoint < 1) {
                return {
                  error:
                    "`can't convert time string to samples. Invalid format.",
                };
              }
            } else {
              console.error(
                `can't convert time string to samples. Invalid format.`,
              );
              return {
                error: "`can't convert time string to samples. Invalid format.",
              };
            }
          }

          olabels.push(
            new OLabel('OCTRA_1', this.cleanTranscript(transcripts[i])),
          );
          const sampleDuration = samplePoint - sampleStart;
          const osegment = new OSegment(
            1 + i,
            sampleStart,
            sampleDuration,
            olabels,
          );
          olevel.items.push(osegment);
          sampleStart += sampleDuration;

          match = regexExtract.exec(file.content);
          i++;
        }

        if (i < transcripts.length) {
          const olabels: OLabel[] = [];
          olabels.push(
            new OLabel('OCTRA_1', this.cleanTranscript(transcripts[i])),
          );
          const osegment = new OSegment(
            1 + i,
            sampleStart,
            audiofile.duration - sampleStart,
            olabels,
          );
          olevel.items.push(osegment);
        }
      } else {
        return {
          error: 'Timestamps in text file do have an invalid format.',
        };
      }
    } else {
      // text only
      const olabels: OLabel[] = [];
      olabels.push(new OLabel('OCTRA_1', this.cleanTranscript(file.content)));
      const osegment = new OSegment(
        1,
        0,
        Math.round(audiofile.duration),
        olabels,
      );

      olevel.items.push(osegment);
    }

    result.levels.push(olevel);

    return {
      annotjson: result,
      error: '',
    };
  }

  private timeStringToSamples(timeString: string, sampleRate: number): number {
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let milliseconds = 0;

    const regex = new RegExp(/([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{1,3})/g);
    const match = regex.exec(timeString);

    if (match !== null && match.length > 4) {
      hours = Number(match[1]);
      minutes = Number(match[2]);
      seconds = Number(match[3]);
      milliseconds = Number(match[4]);

      seconds += milliseconds / 1000 + minutes * 60 + hours * 3600;
      return Math.ceil(seconds * sampleRate);
    }

    return -1;
  }

  private cleanTranscript(transcript: string) {
    return transcript
      .replace(/[\n\t]/gm, ' ')
      .replace(/\s+/g, ' ')
      .replace(/(^ +)|( +$)/g, '');
  }

  /**
   * transforms milliseconds to time string
   * @param value number or milliseconds
   * @param args
   */
  convertToTimeString(
    value: number,
    args?: {
      showHour?: boolean;
      showMilliSeconds?: boolean;
      maxDuration?: number;
    },
  ) {
    let timespan = Number(value);
    if (timespan < 0) {
      timespan = 0;
    }

    const defaultArgs = {
      showHour: false,
      showMilliSeconds: false,
      maxDuration: 0,
    };

    args = { ...defaultArgs, ...args };

    let result = '';

    const milliSeconds: string = this.formatNumber(
      this.getMilliSeconds(timespan),
      3,
    );
    const minutes: string = this.formatNumber(this.getMinutes(timespan), 2);
    const seconds: string = this.formatNumber(this.getSeconds(timespan), 2);
    const hours: string = args.showHour
      ? this.formatNumber(this.getHours(timespan), 2) + ':'
      : '';

    result += hours + minutes + ':' + seconds;
    if (args.showMilliSeconds) {
      result += '.' + milliSeconds;
    }

    return result;
  }

  private formatNumber = (num: number, length: number): string => {
    let result = '' + num.toFixed(0);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };

  private getMilliSeconds(timespan: number): number {
    return Math.floor(timespan % 1000);
  }

  private getSeconds(timespan: number): number {
    return Math.floor(timespan / 1000) % 60;
  }

  private getMinutes(timespan: number): number {
    return Math.floor(timespan / 1000 / 60) % 60;
  }

  private getHours(timespan: number): number {
    return Math.floor(timespan / 1000 / 60 / 60);
  }
}
