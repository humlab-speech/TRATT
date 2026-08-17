import { OAudiofile } from '@tratt/media';
import { FileInfo } from '@tratt/web-media';
import {
  OAnnotJSON,
  OAnyLevel,
  OLabel,
  OSegment,
  OSegmentLevel,
} from '../annotjson';
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

// https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API

export class WebVTTConverterImportOptions {
  extractSpeakers = true;
  sortSpeakerSegments = false;

  constructor(partial?: Partial<WebVTTConverterImportOptions>) {
    if (partial) Object.assign(this, partial);
  }
}

export class WebVTTConverter extends Converter {
  override _name: TrattAnnotationFormatType = 'WebVTT';

  override defaultImportOptions = new WebVTTConverterImportOptions();

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
    this._extensions = ['.vtt'];
    this._conversion.export = true;
    this._conversion.import = true;
    this._encoding = 'UTF-8';
    this._category = 'specialist';
    this._multitiers = false;
    this._notice =
      'Supports voice-tagged speaker extraction (<v Name>). STYLE, REGION and NOTE blocks are ignored. Multi-line cues are merged.';
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

    let result = 'WEBVTT\n\n';
    let filename = '';

    if (
      levelnum === undefined ||
      levelnum < 0 ||
      levelnum > annotation.levels.length
    ) {
      return {
        error: 'Missing level number',
      };
    }

    if (levelnum < annotation.levels.length) {
      const level: OAnyLevel<OSegment> = annotation.levels[levelnum];

      let counter = 1;
      if (level.type === 'SEGMENT') {
        for (let j = 0; j < level.items.length; j++) {
          const item = level.items[j] as OSegment;
          const rawText = item.getFirstLabelWithoutName('Speaker')?.value ?? '';
          if (rawText === '') continue;

          const speaker = item.labels.find((l) => l.name === 'Speaker')?.value;
          const escapedText = this.escapeXml(rawText);
          const speakerPrefix =
            this.options.addSpeakerId && speaker ? `[${speaker}] ` : '';
          const prefixedText = speakerPrefix + escapedText;
          const cueText = speaker
            ? `<v ${speaker}>${prefixedText}</v>`
            : prefixedText;

          const start = this.getTimeStringFromSamples(
            item.sampleStart!,
            annotation.sampleRate,
          );
          const end = this.getTimeStringFromSamples(
            item.sampleStart! + item.sampleDur!,
            annotation.sampleRate,
          );

          result += `${counter}\n`;
          result += `${start} --> ${end}\n`;
          result += `${cueText}\n\n`;
          counter++;
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
        extractSpeakers: {
          title: 'extractSpeakers',
          type: 'boolean',
          default: true,
          description:
            'Reads the speaker name from <v Name> voice tags or [Name] bracket prefixes in cue text and stores it as a speaker label.',
        },
        sortSpeakerSegments: {
          title: 'sortSpeakerSegments',
          dependsOn: ['extractSpeakers'],
          type: 'boolean',
          default: false,
          description: 'Create a separate annotation level for each speaker.',
        },
      },
    };
  }

  public import(
    file: IFile,
    audiofile: OAudiofile,
    options: WebVTTConverterImportOptions = new WebVTTConverterImportOptions(),
  ): ImportResult {
    if (!audiofile?.sampleRate) {
      return { error: 'Missing sample rate' };
    }
    if (!audiofile?.name) {
      return { error: 'Missing audiofile name' };
    }
    if (!audiofile?.duration) {
      return { error: 'Missing audiofile duration' };
    }

    const content = file.content;
    if (content === '') {
      return { error: 'Empty file' };
    }

    if (!/^WEBVTT(\s|$)/.test(content.trimStart())) {
      return { error: 'This WebVTT file is bad formatted (header)' };
    }

    // Split into blocks (blank-line separated) and classify each block
    const blocks = content.split(/\n\n+/).filter((b) => b.trim() !== '');
    const parsedCues: Array<{
      timeStart: number;
      timeEnd: number;
      text: string;
      speaker?: string;
    }> = [];

    for (const block of blocks) {
      const lines = block.split('\n').filter((l) => l !== '');
      if (lines.length === 0) continue;

      const first = lines[0].trim();

      // Skip header, NOTE, STYLE and REGION blocks
      if (
        /^WEBVTT/.test(first) ||
        /^NOTE(\s|$)/.test(first) ||
        /^STYLE(\s|$)/.test(first) ||
        /^REGION(\s|$)/.test(first)
      ) {
        continue;
      }

      // Locate the timestamp line (may be preceded by an optional cue identifier)
      const tsLineIdx = first.includes('-->') ? 0 : 1;
      if (tsLineIdx >= lines.length || !lines[tsLineIdx].includes('-->')) {
        continue; // not a valid cue block
      }

      const tsLine = lines[tsLineIdx].trim();

      // Extract start and end timestamps (ignore cue settings after end time)
      const tsMatches = [
        ...tsLine.matchAll(/(?:[0-9]+:)?[0-9]{2}:[0-9]{2}\.[0-9]{3}/g),
      ];
      if (tsMatches.length < 2) continue;

      const timeStart = this.getSamplesFromTimeString(
        tsMatches[0][0],
        audiofile.sampleRate,
      );
      const timeEndRaw = this.getSamplesFromTimeString(
        tsMatches[1][0],
        audiofile.sampleRate,
      );

      if (timeStart < 0 || timeEndRaw < 0 || timeStart >= audiofile.duration) {
        return {
          error:
            "The last segment's end or start point is out of the audio duration.",
        };
      }

      // Clamp timeEnd to audio duration; VTT timestamps are ms-rounded and the
      // last cue may overshoot the actual sample count by a small amount.
      const timeEnd = Math.min(timeEndRaw, audiofile.duration);

      const rawText = lines
        .slice(tsLineIdx + 1)
        .join(' ')
        .trim();
      const { text, speaker } = this.parseVttCueText(rawText);

      if (text !== '') {
        parsedCues.push({ timeStart, timeEnd, text, speaker });
      }
    }

    if (parsedCues.length === 0) {
      return { error: 'Could not find a cue in VTT file' };
    }

    const result = new OAnnotJSON(
      audiofile.name,
      FileInfo.extractFileName(file.name).name,
      audiofile.sampleRate,
    );

    let counterID = 1;

    if (options.extractSpeakers && options.sortSpeakerSegments) {
      // Build one level per unique speaker
      const cuesBySpeaker = new Map<
        string,
        Array<{ timeStart: number; timeEnd: number; text: string }>
      >();
      for (const cue of parsedCues) {
        const key = cue.speaker ?? 'OCTRA_1';
        if (!cuesBySpeaker.has(key)) cuesBySpeaker.set(key, []);
        cuesBySpeaker.get(key)!.push(cue);
      }

      let levelIdx = 0;
      for (const [speakerName, cues] of cuesBySpeaker) {
        const level = new OSegmentLevel<OSegment>(speakerName);
        let lastEnd = 0;
        for (const cue of cues) {
          if (cue.timeStart > lastEnd) {
            level.items.push(
              new OSegment(counterID++, lastEnd, cue.timeStart - lastEnd, [
                new OLabel(speakerName, ''),
              ]),
            );
          }
          level.items.push(
            new OSegment(
              counterID++,
              cue.timeStart,
              cue.timeEnd - cue.timeStart,
              [new OLabel(speakerName, cue.text)],
            ),
          );
          lastEnd = cue.timeEnd;
        }
        this.fillTrailingGap(
          level,
          audiofile.duration,
          speakerName,
          counterID++,
        );
        result.levels.push(level);
        levelIdx++;
      }
    } else {
      // Single level; speaker name stored as a second label when present
      const level = new OSegmentLevel<OSegment>('OCTRA_1');
      let lastEnd = 0;
      for (const cue of parsedCues) {
        if (cue.timeStart > lastEnd) {
          level.items.push(
            new OSegment(counterID++, lastEnd, cue.timeStart - lastEnd, [
              new OLabel('OCTRA_1', ''),
            ]),
          );
        }
        const labels: OLabel[] = [new OLabel('OCTRA_1', cue.text)];
        if (options.extractSpeakers && cue.speaker) {
          labels.push(new OLabel('Speaker', cue.speaker));
        }
        level.items.push(
          new OSegment(
            counterID++,
            cue.timeStart,
            cue.timeEnd - cue.timeStart,
            labels,
          ),
        );
        lastEnd = cue.timeEnd;
      }
      this.fillTrailingGap(level, audiofile.duration, 'OCTRA_1', counterID++);
      result.levels.push(level);
    }

    return { annotjson: result, error: '' };
  }

  /**
   * Strip all VTT inline markup from cue text and extract the speaker name.
   * Handles: <v Name>, <b>, <i>, <u>, <c.class>, <ruby>, <rt>, inline timestamps.
   * Decodes HTML entities.
   */
  private parseVttCueText(raw: string): { text: string; speaker?: string } {
    const voiceMatch = /^<v\s+([^>]+)>/.exec(raw.trim());
    let speaker = voiceMatch?.[1]?.trim() || undefined;

    let text = raw;
    // Ruby: strip <rt>…</rt> content entirely, then ruby wrappers
    text = text.replace(/<rt>[^<]*<\/rt>/g, '');
    text = text.replace(/<\/?ruby>/g, '');
    // Strip inline timestamp tags e.g. <00:01:23.456>
    text = text.replace(/<[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}>/g, '');
    // Strip VTT voice/formatting tags: <v x>, <b>, <i>, <u>, <c.x> and closers
    text = text.replace(/<\/?[vbiuc][^>]*>/g, '');
    // Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ');
    // Collapse whitespace and trim
    text = text.replace(/\s+/g, ' ').trim();

    // Strip [Speaker] bracket prefix (round-trip with addSpeakerId export; also plain bracket notation)
    const bracketMatch = /^\[([^\]]+)\] *:? */.exec(text);
    if (bracketMatch) {
      const bracketSpeaker = bracketMatch[1].trim();
      text = text.slice(bracketMatch[0].length).trim();
      if (!speaker) {
        speaker = bracketSpeaker;
      }
    }

    return { text, speaker };
  }

  private fillTrailingGap(
    level: OSegmentLevel<OSegment>,
    audioDuration: number,
    labelName: string,
    counterID: number,
  ): void {
    if (level.items.length === 0) return;
    const lastItem = level.items[level.items.length - 1];
    const restSamples =
      audioDuration - (lastItem.sampleStart + lastItem.sampleDur);

    if (restSamples > 300) {
      level.items.push(
        new OSegment(
          counterID,
          lastItem.sampleStart + lastItem.sampleDur,
          restSamples,
          [new OLabel(labelName, '')],
        ),
      );
    } else {
      level.items[level.items.length - 1].sampleDur =
        Number(audioDuration) - Number(lastItem.sampleStart);
    }
  }

  public getTimeStringFromSamples(samples: number, sampleRate: number) {
    const miliseconds = Math.round((samples / sampleRate) * 1000);
    const seconds = Math.floor(miliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const miliStr = this.formatNumber(miliseconds % 1000, 3);
    const secondsStr = this.formatNumber(seconds % 60, 2);
    const minutesStr = this.formatNumber(minutes % 60, 2);
    const hoursStr = this.formatNumber(hours, 2);

    return `${hoursStr}:${minutesStr}:${secondsStr}.${miliStr}`;
  }

  public getSamplesFromTimeString(timeString: string, sampleRate: number) {
    if (sampleRate > 0) {
      // Optional hours: matches MM:SS.mmm or HH:MM:SS.mmm
      const regex = /^(?:([0-9]+):)?([0-9]{2}):([0-9]{2})\.([0-9]{3})$/;
      const matches = regex.exec(timeString.trim());

      if (matches !== null) {
        const hours = matches[1] ? Number(matches[1]) : 0;
        const minutes = Number(matches[2]);
        const seconds = Number(matches[3]);
        const miliseconds = Number(matches[4]);

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

  public formatNumber = (num: number, length: number): string => {
    let result = '' + num.toFixed(0);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };
}
