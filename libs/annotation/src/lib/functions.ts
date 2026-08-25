import { OAudiofile, SampleUnit } from '@tratt/media';
import { contains } from '@tratt/utilities';
import { OLabel, OSegment } from './annotjson';
import { Converter, IFile } from './converters';
import { TrattAnnotationSegment } from './trattAnnotationSegment';

export function convertFromSupportedConverters(
  converters: Converter[],
  file: IFile,
  audioFile: OAudiofile,
) {
  for (const converter of converters) {
    try {
      const result = converter.import(file, audioFile);
      if (result && result.annotjson) {
        return result;
      }
    } catch (e) {
      // ignore
    }
  }

  return undefined;
}

export { contains };

/**
 * formats a duration in seconds as an SRT timestamp: HH:MM:SS,mmm
 */
export function srtTimestamp(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * returns the segment by the sample position (BrowserSample)
 */
export function getSegmentBySamplePosition(
  segments: TrattAnnotationSegment[],
  samples: SampleUnit,
): number {
  let begin = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      begin = segments[i - 1].time.samples;
    }
    if (
      samples.samples > begin &&
      samples.samples <= segments[i].time.samples
    ) {
      return i;
    }
  }
  return -1;
}

export function getSegmentsOfRange(
  entries: TrattAnnotationSegment[],
  startSamples: SampleUnit,
  endSamples: SampleUnit,
): {
  startIndex: number;
  endIndex: number;
} {
  if (startSamples.sampleRate !== endSamples.sampleRate) {
    throw new Error('Samplerate of both SampleUnits must be equal');
  }

  let start = new SampleUnit(0, startSamples.sampleRate);
  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < entries.length; i++) {
    const segment = entries[i];

    if (
      // segment end is in chunk
      (segment.time!.samples >= startSamples.samples &&
        segment.time!.samples <= endSamples.samples) ||
      // segment end is not in chunk, start is
      (start.samples >= startSamples.samples &&
        start.samples <= endSamples.samples) ||
      (start.samples <= startSamples.samples &&
        segment.time!.samples >= endSamples.samples)
    ) {
      if (startIndex < 0) {
        startIndex = i;
      }
      endIndex = i;
    }

    start = segment.time.clone();
  }

  return { startIndex, endIndex };
}

/***
 * removes a boundary and concatenates the transcripts of its neighbour.
 * @param entries
 * @param index index of the boundary
 * @param silenceValue the break marker
 * @param mergeTranscripts
 */
export function removeSegmentByIndex(
  entries: TrattAnnotationSegment[],
  index: number,
  silenceValue: string | undefined,
  mergeTranscripts = true,
) {
  if (index > -1 && index < entries.length) {
    const segment = entries[index];
    if (
      index < entries.length - 1 &&
      silenceValue !== undefined &&
      silenceValue !== ''
    ) {
      const nextSegment = entries[index + 1];
      const transcription =
        entries[index].getFirstLabelWithoutName('Spealer')?.value;

      if (
        silenceValue !== undefined &&
        nextSegment.getFirstLabelWithoutName('Speaker')?.value !==
          silenceValue &&
        transcription !== silenceValue &&
        mergeTranscripts
      ) {
        // concat transcripts
        if (
          nextSegment.getFirstLabelWithoutName('Speaker')?.value !== '' &&
          transcription !== ''
        ) {
          nextSegment.changeFirstLabelWithoutName(
            'Speaker',
            transcription +
              ' ' +
              nextSegment.getFirstLabelWithoutName('Speaker')?.value,
          );
        } else if (
          nextSegment.getFirstLabelWithoutName('Speaker')?.value === '' &&
          transcription !== ''
        ) {
          nextSegment.changeFirstLabelWithoutName(
            'Speaker',
            transcription ?? '',
          );
        }
      } else if (
        nextSegment.getFirstLabelWithoutName('Speaker')?.value === silenceValue
      ) {
        // delete pause
        nextSegment.changeFirstLabelWithoutName('Speaker', transcription ?? '');
      }
    }

    entries.splice(index, 1);
  }
  return entries;
}

export function betweenWhichSegment(
  entries: TrattAnnotationSegment[],
  samples: number,
): TrattAnnotationSegment | undefined {
  let start = 0;

  for (const segment of entries) {
    if (samples >= start && samples <= segment.time.samples) {
      return segment;
    }
    start = segment.time.samples;
  }

  return undefined;
}

/**
 * adds new Segment
 */
export function addSegment(
  itemIDCounter: number,
  entries: TrattAnnotationSegment[],
  time: SampleUnit,
  label: string,
  value: string | undefined = undefined,
): {
  entries: TrattAnnotationSegment[];
  itemIDCounter: number;
} {
  const newSegment: TrattAnnotationSegment = new TrattAnnotationSegment(
    itemIDCounter,
    time,
    [new OLabel(label, value ?? '')],
  );

  if (
    entries.find((a) => {
      return a.time!.seconds === time.seconds;
    }) === undefined
  ) {
    entries.push(newSegment);
    entries = sort(entries);
    entries = cleanup(entries);
    return { entries, itemIDCounter: itemIDCounter + 1 };
  } else {
    console.error(
      `segment with this timestamp ${time.seconds} already exists and can not be added.`,
    );
  }
  return { entries, itemIDCounter: itemIDCounter };
}

/**
 * sorts the segments by time in samples
 */
export function sort(entries: TrattAnnotationSegment[]) {
  entries.sort((a, b) => {
    if (a.time!.samples < b.time!.samples) {
      return -1;
    }
    if (a.time!.samples === b.time!.samples) {
      return 0;
    }
    return 1;
  });
  return entries;
}

export function cleanup(entries: TrattAnnotationSegment[]) {
  const remove: number[] = [];

  if (entries.length > 1) {
    let last = entries[0];
    for (let i = 1; i < entries.length; i++) {
      if (last.time!.samples === entries[i].time!.samples) {
        remove.push(i);
      }
      last = entries[i - 1];
    }

    for (let i = 0; i < remove.length; i++) {
      entries.splice(remove[i], 1);
      remove.splice(i, 1);
      --i;
    }
  }
  return entries;
}

export function getStartTimeBySegmentID(
  entries: TrattAnnotationSegment[],
  id: number,
): SampleUnit | undefined {
  const segmentIndex = entries.findIndex((a) => a.id === id);

  if (segmentIndex > -1) {
    if (segmentIndex > 0) {
      return entries[segmentIndex].time.clone();
    } else {
      return new SampleUnit(0, entries[segmentIndex].time.sampleRate);
    }
  }
  return undefined;
}

export function combineSegments(
  entries: TrattAnnotationSegment[],
  segmentIndexStart: number,
  segmentIndexEnd: number,
  breakMarker: string,
) {
  for (let i = segmentIndexStart; i < segmentIndexEnd; i++) {
    entries = removeSegmentByIndex(entries, i, breakMarker, false);
    i--;
    segmentIndexEnd--;
  }
}

/**
 * returns an array of normal segment objects with original values.
 */
export function convertSegmentsToOSegments(
  entries: TrattAnnotationSegment[],
): OSegment[] {
  return entries.map((a, i) =>
    a.serializeToOSegment(i > 0 ? entries[i - 1].time.samples : 0),
  );
}

export function convertOSegmentsToSegments(
  entries: OSegment[],
  sampleRate: number,
): TrattAnnotationSegment[] {
  return entries.map((a) =>
    TrattAnnotationSegment.deserializeFromOSegment(a, sampleRate),
  );
}

/**
 * removes Segment by number of samples
 */
export function removeBySamples(
  entries: TrattAnnotationSegment[],
  timeSamples: SampleUnit,
) {
  for (let i = 0; i < entries.length; i++) {
    const segment = entries[i];

    if (segment.time!.equals(timeSamples)) {
      entries.splice(i, 1);
      return entries;
    }
  }
  return entries;
}
