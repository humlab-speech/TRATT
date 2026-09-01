import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { LoginMode } from '../../index';
import { AnnotationTextProcessingService } from './annotation-text-processing.service';

const guidelines: any = {
  markers: [
    { id: 1, code: '<<>>', type: 'break', icon: '', name: 'break' },
    { id: 2, code: '[[]]', type: 'other', icon: 'pause.png', name: 'other' },
  ],
  instructions: [
    {
      group: 'group-1',
      entries: [
        {
          code: 'E1',
          priority: 'high',
          title: 'Error 1',
          description: 'Bad thing {{foo}} happened',
          examples: [],
        },
      ],
    },
  ],
};

function createService(overrides: {
  audio?: any;
  appStorage?: any;
  multiThreading?: any;
} = {}) {
  const audio =
    overrides.audio ??
    ({
      audioManager: {
        resource: {
          name: 'audio.wav',
          info: { sampleRate: 16000, duration: { samples: 32000 } },
        },
      },
    } as never);
  const appStorage =
    overrides.appStorage ??
    ({
      onlineSession: { currentProject: { name: 'my-project' } },
      snapshot: { application: { mode: LoginMode.LOCAL } },
      useMode: LoginMode.LOCAL,
    } as never);
  const multiThreading =
    overrides.multiThreading ??
    ({
      run: jest.fn((job: any) => job.doFunction(...job.args)),
    } as never);

  return new AnnotationTextProcessingService(audio, appStorage, multiThreading);
}

describe('AnnotationTextProcessingService', () => {
  describe('replaceSingleTags', () => {
    it('keeps well-formed single tags but escapes a lone angle bracket', () => {
      const service = createService();
      // "<b>" is a well-formed tag and survives the sentinel round-trip
      // unchanged; the lone "<" before "d" has no matching ">" so it gets
      // HTML-escaped instead.
      const result = service.replaceSingleTags('a<b>c<d');
      expect(result).toBe('a<b>c&lt;d');
    });
  });

  describe('getMarkerPositions', () => {
    it('finds all marker occurrences in the raw text', () => {
      const service = createService();
      const result = service.getMarkerPositions(
        'a <<>> b [[]] c',
        guidelines,
      );
      expect(result).toEqual([
        { start: 2, end: 6 },
        { start: 9, end: 13 },
      ]);
    });
  });

  describe('validate', () => {
    afterEach(() => {
      delete (global as any).validateAnnotation;
    });

    it('returns an empty array when no guidelines are set', () => {
      const service = createService();
      expect(service.validate('some text', undefined)).toEqual([]);
    });

    it('delegates to the global validateAnnotation and filters selection-range hits', () => {
      (global as any).validateAnnotation = jest.fn().mockReturnValue([
        { start: 0, length: 2, code: 'E1' },
      ]);
      const service = createService();
      const result = service.validate('xy plain text', guidelines);
      expect((global as any).validateAnnotation).toHaveBeenCalledWith(
        'xy plain text',
        guidelines,
      );
      expect(result).toEqual([{ start: 0, length: 2, code: 'E1' }]);
    });

    it('does not crash on a zero-length validation at the junction of two adjacent boundary markers, and does not drop an unrelated result (C26)', () => {
      const rawText =
        '✉✉✉sel-start/📩📩📩' + 'a{123}{456}b' + '✉✉✉sel-end/📩📩📩';
      const junctionStart = rawText.indexOf('{123}{456}') + 5; // the '}' / '{' junction
      const unrelatedStart = rawText.indexOf('{') - 1; // position of 'a' before first boundary marker

      (global as any).validateAnnotation = jest.fn().mockReturnValue([
        { start: junctionStart, length: 0, code: 'E1' },
        { start: unrelatedStart, length: 1, code: 'E2' }, // unrelated, the 'a' before any boundary marker
      ]);
      const service = createService();

      let result: any[] = [];
      expect(() => {
        result = service.validate(rawText, guidelines);
      }).not.toThrow();

      expect(result.some((r) => r.code === 'E2')).toBe(true);
      expect(result.some((r) => r.code === 'E1')).toBe(false);
    });

    it('removes all results inside the same boundary marker, not just the first (lastIndex regression)', () => {
      const rawText = 'a{100}b';
      (global as any).validateAnnotation = jest.fn().mockReturnValue([
        { start: 1, length: 1, code: 'A' }, // inside {100}
        { start: 2, length: 1, code: 'B' }, // also inside {100}
      ]);
      const service = createService();
      const result = service.validate(rawText, guidelines);
      expect(result).toEqual([]);
    });
  });

  describe('underlineTextRed', () => {
    it('wraps validation errors with span markers', () => {
      const service = createService();
      const result = service.underlineTextRed('abcdef', [
        { start: 1, length: 2, code: 'E1' },
      ], guidelines);
      expect(result).toBe(
        "a✉✉✉span class='val-error' data-errorcode='E1'📩📩📩bc✉✉✉/span📩📩📩def",
      );
    });

    it('returns the raw text unchanged when there is no validation', () => {
      const service = createService();
      expect(service.underlineTextRed('abcdef', [], guidelines)).toBe(
        'abcdef',
      );
    });
  });

  describe('getErrorDetails', () => {
    it('returns undefined when guidelines have no instructions', () => {
      const service = createService();
      return service.getErrorDetails('E1', undefined).then((result) => {
        expect(result).toBeUndefined();
      });
    });

    it('finds the matching entry by code', async () => {
      const service = createService();
      const result = await service.getErrorDetails('E1', guidelines);
      expect(result?.code).toBe('E1');
      expect(result?.title).toBe('Error 1');
    });

    it('returns undefined when no entry matches the code', async () => {
      const service = createService();
      const result = await service.getErrorDetails('UNKNOWN', guidelines);
      expect(result).toBeUndefined();
    });
  });

  describe('extractUI', () => {
    it('builds an OLogging with entries derived from the audio resource', () => {
      const service = createService();
      const result = service.extractUI([
        {
          timestamp: 1,
          type: 'mouse',
          context: 'ctx',
          playpos: 0,
          textSelection: undefined,
          audioSelection: undefined,
          transcriptionUnit: 0,
          value: 'clicked',
        } as any,
      ]);
      expect(result.sampleRate).toBe(16000);
      expect(result.projectname).toBe('my-project');
      expect(result.logs.length).toBe(1);
      expect(result.logs[0].value).toBe('clicked');
    });

    it('falls back to "local" when there is no online project', () => {
      const service = createService({
        appStorage: { onlineSession: undefined, snapshot: {} } as never,
      });
      const result = service.extractUI([]);
      expect(result.projectname).toBe('local');
    });
  });

  describe('rawToHTML', () => {
    it('converts markers to boundary/marker HTML via the worker job', async () => {
      const service = createService();
      const result = await service.rawToHTML('hello <<>> world', guidelines);
      expect(result).toContain('<p>');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('returns an empty wrapper for empty input', async () => {
      const service = createService();
      const result = await service.rawToHTML('', guidelines);
      expect(result).toBe('');
    });
  });

  describe('analyse', () => {
    function buildLevel() {
      const transcript = new TrattAnnotation<TrattAnnotationSegment>();
      return new TrattAnnotationSegmentLevel<TrattAnnotationSegment>(
        transcript.idCounters.level++,
        'OCTRA_1',
        [
          new TrattAnnotationSegment(
            transcript.idCounters.item++,
            new SampleUnit(48000, 48000),
            [
              new OLabel('OCTRA_1', 'transcribed text'),
              new OLabel('Speaker', 'Speaker 1'),
            ],
          ) as any,
          new TrattAnnotationSegment(
            transcript.idCounters.item++,
            new SampleUnit(96000, 48000),
            [new OLabel('OCTRA_1', ''), new OLabel('Speaker', 'Speaker 2')],
          ) as any,
          new TrattAnnotationSegment(
            transcript.idCounters.item++,
            new SampleUnit(144000, 48000),
            [
              new OLabel('OCTRA_1', 'has <<>> break marker'),
              new OLabel('Speaker', 'Speaker 1'),
            ],
          ) as any,
        ],
      );
    }

    it('counts transcribed, empty and paused segments', () => {
      const service = createService();
      const level = buildLevel();
      const breakMarker = guidelines.markers[0];
      const result = service.analyse(level, breakMarker);
      expect(result).toEqual({ transcribed: 1, empty: 1, pause: 1 });
    });

    it('returns all zeros when there is no current level', () => {
      const service = createService();
      expect(service.analyse(undefined, undefined)).toEqual({
        transcribed: 0,
        empty: 0,
        pause: 0,
      });
    });
  });

  describe('validateAll', () => {
    it('does not validate and returns an undefined transcriptValid when validation is disabled', () => {
      const service = createService({
        appStorage: {
          useMode: LoginMode.LOCAL,
          snapshot: { application: { mode: LoginMode.LOCAL } },
        } as never,
      });
      const result = service.validateAll(undefined, guidelines);
      expect(result).toEqual({ validationArray: [], transcriptValid: undefined });
    });

    it('marks the transcript valid when there is no transcript but validation is enabled', () => {
      const service = createService({
        appStorage: {
          useMode: LoginMode.DEMO,
          snapshot: { application: { mode: LoginMode.DEMO } },
        } as never,
      });
      const result = service.validateAll(undefined, guidelines);
      expect(result).toEqual({ validationArray: [], transcriptValid: true });
    });
  });
});
