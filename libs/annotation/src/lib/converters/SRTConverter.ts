import { OAudiofile } from '@tratt/media';
import { FileInfo } from '@tratt/web-media';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';
import { srtTimestamp } from '../functions';
import {
  Converter,
  ExportResult,
  IFile,
  ImportResult,
  TrattAnnotationFormatType,
} from './Converter';
import {
  AnyTextEditor,
  AnyVideoPlayer,
  OctraApplication,
  WordApplication,
} from './SupportedApplications';

export class SRTConverterImportOptions {
  sortSpeakerSegments = false;
  combineSegmentsWithSameSpeakerThreshold?: number;
  speakerIdentifierPattern = '\\[([^\\]]+)\\] *:? *';

  constructor(partial?: Partial<SRTConverterImportOptions>) {
    if (partial) Object.assign(this, partial);
  }
}
// https://matroska.org/technical/specs/subtitles/srt.html
export class SRTConverter extends Converter {
  override _name: TrattAnnotationFormatType = 'SRT';

  override defaultImportOptions = new SRTConverterImportOptions();

  public override options = { addSpeakerId: false };

  public constructor() {
    super();
    this._applications = [
      {
        application: new OctraApplication(),
      },
      {
        application: new AnyVideoPlayer(),
      },
      {
        application: new WordApplication(),
      },
      {
        application: new AnyTextEditor(),
      },
    ];
    this._extensions = ['.srt'];
    this._conversion.export = true;
    this._conversion.import = true;
    this._encoding = 'UTF-8';
    this._category = 'general';
    this._multitiers = false;
  }

  public static getSamplesFromTimeString(
    timeString: string,
    sampleRate: number,
  ) {
    if (sampleRate > 0) {
      const regex = new RegExp(/([0-9]+):([0-9]+):([0-9]+)(?:,([0-9]+))?/g);

      const matches = regex.exec(timeString);

      if (matches && matches.length > -1) {
        const hours = Number(matches[1]);
        const minutes = Number(matches[2]);
        const seconds = Number(matches[3]);
        const miliseconds = matches.length > 4 ? Number(matches[4]) : 0;

        let totalMiliSeconds = hours * 60 * 60;
        totalMiliSeconds += minutes * 60;
        totalMiliSeconds += seconds;
        totalMiliSeconds *= 1000;
        totalMiliSeconds += miliseconds;
        totalMiliSeconds = Math.round(totalMiliSeconds);

        return Math.round((totalMiliSeconds / 1000) * sampleRate);
      } else {
        console.error(`time string does not match`);
      }
    } else {
      console.error(`invalid sample rate`);
    }
    return -1;
  }

  public export(
    annotation: OAnnotJSON,
    audiofile: OAudiofile,
    levelnum: number,
  ): ExportResult {
    if (!annotation) {
      return {
        error: 'Annotation is undefined or null',
      };
    }

    let result = '';
    let filename = '';

    if (
      levelnum === undefined ||
      levelnum < 0 ||
      levelnum > annotation.levels.length
    ) {
      return {
        error: `Missing level number`,
      };
    }

    if (levelnum < annotation.levels.length) {
      const level = annotation.levels[levelnum];

      let counter = 1;
      if (level.type === 'SEGMENT') {
        for (const item of level.items as OSegment[]) {
          const transcript =
            item.getFirstLabelWithoutName('Speaker')?.value ?? '';
          const start = this.getTimeStringFromSamples(
            item.sampleStart,
            annotation.sampleRate,
          );
          const end = this.getTimeStringFromSamples(
            item.sampleStart + item.sampleDur,
            annotation.sampleRate,
          );

          if (transcript !== '') {
            const speaker = item.labels?.find(
              (l) => l.name === 'Speaker',
            )?.value;
            const speakerPrefix =
              this.options.addSpeakerId && speaker ? `[${speaker}] ` : '';
            result += `${counter}\n`;
            result += `${start} --> ${end}\n`;
            result += `${speakerPrefix}${transcript}\n\n`;
            counter++;
          }
        }
      }

      filename = `${annotation.name}`;
      if (annotation.levels.length > 1) {
        filename += `-${level.name}`;
      }
      filename += `${this._extensions[0]}`;
    }

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
    return {
      $gui_support: true,
      type: 'object',
      properties: {
        speakerIdentifierPattern: {
          title: 'speakerIdentifierPattern',
          toggleable: true,
          type: 'string',
          default: '\\[([^\\]]+)\\] *:? *',
          description:
            'Regular expression (with one capture group) matching the speaker prefix at the start of a cue line. The first capture group becomes the speaker name.',
        },
        sortSpeakerSegments: {
          title: 'sortSpeakerSegments',
          dependsOn: ['speakerIdentifierPattern'],
          type: 'boolean',
          default: false,
          description:
            'Moves all units with a speaker label to separate annotation levels. Units without a speaker remain on the default level.',
        },
        combineSegmentsWithSameSpeakerThreshold: {
          title: 'combineSegmentsWithSameSpeakerThreshold',
          dependsOn: ['speakerIdentifierPattern'],
          toggleable: true,
          type: 'number',
          default: 2000,
          description:
            'Defines max. duration an empty segment between two segments may have to be combined together. Set empty to deactivate it.',
        },
      },
    };
  }

  public import(
    file: IFile,
    audiofile: OAudiofile,
    options: SRTConverterImportOptions = new SRTConverterImportOptions(),
  ): ImportResult {
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

    if (audiofile) {
      const result = new OAnnotJSON(
        audiofile.name,
        FileInfo.extractFileName(file.name).name,
        audiofile.sampleRate,
      );

      const content = file.content;
      let levels: OSegmentLevel<OSegment>[] = [];

      let counterID = 1;
      let lastEnd = 0;

      let defaultLevel: OSegmentLevel<OSegment> = new OSegmentLevel<OSegment>(
        'OCTRA_1',
      );
      const regexStr =
        `([0-9]+)[\\n\\r]*([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?) --> ` +
        `([0-9]{2}:[0-9]{2}:[0-9]{2}(?:,[0-9]{3})?)\\r?\\n\\r?` +
        `(.*)\\r?\\n\\r?`;
      const speakerRx = options.speakerIdentifierPattern
        ? new RegExp(`^(?:${options.speakerIdentifierPattern})`)
        : undefined;

      if (content !== '') {
        const regex = new RegExp(regexStr, 'g');

        let matches = regex.exec(content);
        while (matches !== null) {
          let olevel: OSegmentLevel<OSegment> = defaultLevel;

          let transcript = matches[4].replace(/(\n|\s)+$/g, '');
          let speakerName: string | undefined;
          if (speakerRx) {
            const sm = speakerRx.exec(transcript);
            if (sm) {
              speakerName = sm[1];
              transcript = transcript.slice(sm[0].length);
            }
          }

          const timeStart = SRTConverter.getSamplesFromTimeString(
            matches[2],
            audiofile.sampleRate,
          );
          const timeEnd = SRTConverter.getSamplesFromTimeString(
            matches[3],
            audiofile.sampleRate,
          );

          if (timeStart > -1 && timeEnd > -1) {
            if (timeStart > lastEnd) {
              // add additional segment
              olevel.items.push(
                new OSegment(counterID++, lastEnd, timeStart - lastEnd, [
                  ...(speakerName ? [new OLabel('Speaker', speakerName)] : []),
                  new OLabel(olevel.name, ''),
                ]),
              );
            }

            if (timeEnd >= timeStart) {
              olevel.items.push(
                new OSegment(counterID++, timeStart, timeEnd - timeStart, [
                  ...(speakerName ? [new OLabel('Speaker', speakerName)] : []),
                  new OLabel(olevel.name, transcript),
                ]),
              );
            } else {
              return {
                error: `Invalid timestamps in line: ${matches[0]}`,
              };
            }
          }
          matches = regex.exec(content);
          lastEnd = timeEnd;
        }
      }

      if (defaultLevel.items.length > 0) {
        if (options.combineSegmentsWithSameSpeakerThreshold) {
          for (let i = 0; i < defaultLevel.items.length; i++) {
            const previousItem = i > 0 ? defaultLevel.items[i - 1] : undefined;
            const item = defaultLevel.items[i];
            const nextItem =
              i < defaultLevel.items.length - 1
                ? defaultLevel.items[i + 1]
                : undefined;
            const duration = (item.sampleDur * 1000) / audiofile.sampleRate;
            const text = item.getFirstLabelWithoutName('Speaker')?.value;

            if (
              nextItem &&
              previousItem &&
              !text &&
              duration <= options.combineSegmentsWithSameSpeakerThreshold
            ) {
              // current unit is empty, previous and next is set
              // remove empty unit
              defaultLevel.items.splice(i, 1);
              // extend previousItem
              previousItem.sampleDur += item.sampleDur;
              i--; // i = position of previous item

              if (
                nextItem.labels[0].name === 'Speaker' &&
                previousItem.labels[0].name === 'Speaker' &&
                nextItem.labels[0].value === previousItem.labels[0].value
              ) {
                // left and right neighbours have the same speaker
                // remove nextItem
                defaultLevel.items.splice(i + 1, 1);
                // extend previousItem
                previousItem.sampleDur += nextItem.sampleDur;

                const label = previousItem.getFirstLabelWithoutName('Speaker');
                if (label) {
                  label.value +=
                    nextItem.getFirstLabelWithoutName('Speaker')?.value ?? '';
                }
              }
            }
          }
        }

        if (options.sortSpeakerSegments) {
          for (let i = 0; i < defaultLevel.items.length; i++) {
            const item = defaultLevel.items[i];
            const speaker = item.labels.find(
              (a) => a.name === 'Speaker',
            )?.value;
            let olevel: OSegmentLevel<OSegment>;

            if (speaker) {
              const found = levels.find((a) => a.name === speaker);
              if (found) {
                olevel = found;
              } else {
                olevel = new OSegmentLevel<OSegment>(speaker);
                levels.push(olevel);
              }

              item.labels = item.labels
                .filter((a) => a.name !== 'Speaker')
                .map(
                  (a) =>
                    new OLabel(
                      speaker,
                      item.getFirstLabelWithoutName('Speaker')?.value ?? '',
                    ),
                );
              olevel.items.push(item);
              defaultLevel.items.splice(i, 1);
              i--;
            }
          }
        }
        levels.sort((a, b) => {
          if (a.name > b.name) return 1;
          else if (a.name === b.name) return 0;
          return -1;
        });

        if (defaultLevel.items.length > 0) {
          levels.push(defaultLevel);
        }

        levels = levels.map((a, i) => {
          let lastEnd = 0;
          for (let j = 0; j < a.items.length; j++) {
            const item = a.items[j];
            if (item.sampleStart > lastEnd + 1) {
              a.items = [
                ...a.items.slice(0, j),
                new OSegment(counterID++, lastEnd, item.sampleStart - lastEnd, [
                  new OLabel(a.name, ''),
                ]),
                ...a.items.slice(j),
              ];
            }

            lastEnd = item.sampleStart + item.sampleDur;

            const nextItem =
              j < a.items.length - 1 ? a.items[j + 1] : undefined;
            if (
              !nextItem &&
              item.sampleStart + item.sampleDur < Number(audiofile.duration)
            ) {
              a.items.push(
                new OSegment(
                  counterID++,
                  item.sampleStart + item.sampleDur,
                  Number(audiofile.duration) -
                    (item.sampleStart + item.sampleDur),
                  [new OLabel(a.name, '')],
                ),
              );
            }
          }
          return a;
        });

        result.levels = levels;
        console.log(result);
        return {
          annotjson: result,
          error: '',
        };
      } else {
        return {
          error: 'Input file is not comatible with SRT format.',
        };
      }
    }

    return {
      error: `This SRT file is not compatible with this audio file.`,
    };
  }

  public getTimeStringFromSamples(samples: number, sampleRate: number) {
    return srtTimestamp(samples / sampleRate);
  }
}
