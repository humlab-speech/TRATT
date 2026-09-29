import { describe, expect, it } from '@jest/globals';
import { PipelineState } from './index';
import { PipelineActions } from './pipeline.actions';
import { initialState, reducer } from './pipeline.reducer';

function freshTranscriptionActive(): PipelineState {
  return reducer(
    initialState,
    PipelineActions.transcriptionStart({
      downloadExpectedBytes: 500,
      usedWebGPU: true,
    }),
  );
}

function freshTranslationActive(): PipelineState {
  return reducer(initialState, PipelineActions.translationStart());
}

describe('pipeline.reducer', () => {
  it('returns the initial state for an unknown action', () => {
    const state = reducer(undefined, { type: '@@INIT' } as any);
    expect(state).toEqual(initialState);
  });

  describe('transcriptionStart', () => {
    it('resets transcription to an active downloading state and clears diarizationWarning', () => {
      const seeded: PipelineState = {
        ...initialState,
        diarizationWarning: 'stale warning',
        transcription: {
          ...initialState.transcription,
          error: 'stale error',
          segmentEndS: 42,
        },
      };
      const state = reducer(
        seeded,
        PipelineActions.transcriptionStart({
          downloadExpectedBytes: 12345,
          usedWebGPU: true,
        }),
      );

      expect(state.diarizationWarning).toBeNull();
      expect(state.transcription).toEqual({
        active: true,
        phase: 'downloading',
        downloadLoaded: 0,
        downloadTotal: 0,
        downloadExpectedBytes: 12345,
        downloadFile: '',
        audioDurationS: 0,
        segmentEndS: 0,
        error: null,
        usedWebGPU: true,
      });
    });
  });

  describe('transcriptionEvent', () => {
    it('download-progress writes loaded/total/file and sets phase downloading', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionEvent({
          event: {
            type: 'download-progress',
            loaded: 10,
            total: 100,
            file: 'model.bin',
          },
        }),
      );
      expect(state.transcription.phase).toBe('downloading');
      expect(state.transcription.downloadLoaded).toBe(10);
      expect(state.transcription.downloadTotal).toBe(100);
      expect(state.transcription.downloadFile).toBe('model.bin');
    });

    it('transcribe-start sets phase transcribing, audioDurationS, and resets the segment counter', () => {
      const seeded: PipelineState = {
        ...freshTranscriptionActive(),
        transcription: {
          ...freshTranscriptionActive().transcription,
          segmentEndS: 5,
        },
      };
      const state = reducer(
        seeded,
        PipelineActions.transcriptionEvent({
          event: { type: 'transcribe-start', audioDurationS: 60 },
        }),
      );
      expect(state.transcription.phase).toBe('transcribing');
      expect(state.transcription.audioDurationS).toBe(60);
      expect(state.transcription.segmentEndS).toBe(0);
    });

    it('segment-progress writes segmentEndS only', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionEvent({
          event: { type: 'segment-progress', segmentEndS: 12.5 },
        }),
      );
      expect(state.transcription.segmentEndS).toBe(12.5);
    });

    it('backend-fallback clears usedWebGPU, resets download counters, and sets the fallback message', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionEvent({
          event: { type: 'backend-fallback', backend: 'wasm' },
        }),
      );
      expect(state.transcription.usedWebGPU).toBe(false);
      expect(state.transcription.phase).toBe('downloading');
      expect(state.transcription.downloadLoaded).toBe(0);
      expect(state.transcription.downloadTotal).toBe(0);
      expect(state.transcription.downloadFile).toBe(
        'Retrying with WASM after WebGPU startup failure',
      );
    });

    it("inner 'result' sets phase finalizing", () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionEvent({
          event: { type: 'result', annotJson: {} as any },
        }),
      );
      expect(state.transcription.phase).toBe('finalizing');
    });
  });

  describe('transcriptionFinalized', () => {
    it('sets active=false and diarizationWarning; when willTranslate resets phase to idle', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionFinalized({
          diarizationWarning: 'diarization had trouble',
          willTranslate: true,
        }),
      );
      expect(state.transcription.active).toBe(false);
      expect(state.diarizationWarning).toBe('diarization had trouble');
      expect(state.transcription.phase).toBe('idle');
    });

    it('when NOT willTranslate, leaves phase untouched (e.g. finalizing)', () => {
      const finalizing = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionEvent({
          event: { type: 'result', annotJson: {} as any },
        }),
      );
      const state = reducer(
        finalizing,
        PipelineActions.transcriptionFinalized({
          diarizationWarning: null,
          willTranslate: false,
        }),
      );
      expect(state.transcription.active).toBe(false);
      expect(state.transcription.phase).toBe('finalizing');
    });
  });

  describe('transcriptionCancelled', () => {
    it('resets active and phase to idle', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.transcriptionCancelled(),
      );
      expect(state.transcription.active).toBe(false);
      expect(state.transcription.phase).toBe('idle');
    });
  });

  describe('transcriptionErrorDismissed', () => {
    it('clears the error field only', () => {
      const seeded: PipelineState = {
        ...freshTranscriptionActive(),
        transcription: {
          ...freshTranscriptionActive().transcription,
          error: 'boom',
        },
      };
      const state = reducer(
        seeded,
        PipelineActions.transcriptionErrorDismissed(),
      );
      expect(state.transcription.error).toBeNull();
    });
  });

  describe('diarizationStarted / diarizationSkipped', () => {
    it('diarizationStarted sets phase to diarizing', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.diarizationStarted(),
      );
      expect(state.transcription.phase).toBe('diarizing');
    });

    it('diarizationSkipped is a no-op', () => {
      const before = freshTranscriptionActive();
      const state = reducer(before, PipelineActions.diarizationSkipped());
      expect(state).toEqual(before);
    });
  });

  describe('diarizationEvent', () => {
    it('download-progress writes into the transcription download fields', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.diarizationEvent({
          event: {
            type: 'download-progress',
            loaded: 3,
            total: 9,
            file: 'diarize.bin',
          },
        }),
      );
      expect(state.transcription.downloadLoaded).toBe(3);
      expect(state.transcription.downloadTotal).toBe(9);
      expect(state.transcription.downloadFile).toBe('diarize.bin');
    });

    it('other diarization event types are a no-op', () => {
      const before = freshTranscriptionActive();
      const state = reducer(
        before,
        PipelineActions.diarizationEvent({
          event: { type: 'diarize-start', audioDurationS: 30 },
        }),
      );
      expect(state).toEqual(before);
    });
  });

  describe('translationStart', () => {
    it('resets translation to an active downloading state', () => {
      const state = reducer(initialState, PipelineActions.translationStart());
      expect(state.translation).toEqual({
        active: true,
        phase: 'downloading',
        downloadLoaded: 0,
        downloadTotal: 0,
        downloadFile: '',
        segmentIndex: 0,
        segmentTotal: 0,
        error: null,
      });
    });
  });

  describe('translationEvent', () => {
    it('download-progress writes loaded/total/file', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationEvent({
          event: {
            type: 'download-progress',
            loaded: 1,
            total: 2,
            file: 'trans.bin',
          },
        }),
      );
      expect(state.translation.downloadLoaded).toBe(1);
      expect(state.translation.downloadTotal).toBe(2);
      expect(state.translation.downloadFile).toBe('trans.bin');
    });

    it('model-init sets phase initializing', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationEvent({ event: { type: 'model-init' } }),
      );
      expect(state.translation.phase).toBe('initializing');
    });

    it('translate-start sets phase translating and resets counters', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationEvent({
          event: { type: 'translate-start', total: 10 },
        }),
      );
      expect(state.translation.phase).toBe('translating');
      expect(state.translation.segmentTotal).toBe(10);
      expect(state.translation.segmentIndex).toBe(0);
    });

    it('segment-progress writes index/total', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationEvent({
          event: { type: 'segment-progress', index: 3, total: 10 },
        }),
      );
      expect(state.translation.segmentIndex).toBe(3);
      expect(state.translation.segmentTotal).toBe(10);
    });

    it("inner 'result' sets active=false, phase finalizing", () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationEvent({
          event: { type: 'result', annotJson: {} as any },
        }),
      );
      expect(state.translation.active).toBe(false);
      expect(state.translation.phase).toBe('finalizing');
    });

    it("'segments' is a no-op", () => {
      const before = freshTranslationActive();
      const state = reducer(
        before,
        PipelineActions.translationEvent({
          event: { type: 'segments', translated: [] },
        }),
      );
      expect(state).toEqual(before);
    });
  });

  describe('translationCancelled', () => {
    it('resets active and phase to idle', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.translationCancelled(),
      );
      expect(state.translation.active).toBe(false);
      expect(state.translation.phase).toBe('idle');
    });
  });

  describe('translationErrorDismissed', () => {
    it('clears the error field only', () => {
      const seeded: PipelineState = {
        ...freshTranslationActive(),
        translation: { ...freshTranslationActive().translation, error: 'x' },
      };
      const state = reducer(
        seeded,
        PipelineActions.translationErrorDismissed(),
      );
      expect(state.translation.error).toBeNull();
    });
  });

  describe('stalled', () => {
    it('writes the stall message into translation.error', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.stalled({
          phase: 'downloading',
          message: 'Download stalled',
        }),
      );
      expect(state.translation.error).toBe('Download stalled');
    });
  });

  describe('result', () => {
    it('writes diarizationWarning and does not touch transcription/translation', () => {
      const before = freshTranslationActive();
      const state = reducer(
        before,
        PipelineActions.result({ diarizationWarning: 'warned' }),
      );
      expect(state.diarizationWarning).toBe('warned');
      expect(state.transcription).toEqual(before.transcription);
      expect(state.translation).toEqual(before.translation);
    });
  });

  describe('cancelled', () => {
    it('is a no-op, matching login.component.ts treating this PipelineEvent as a no-op', () => {
      const before = freshTranslationActive();
      const state = reducer(before, PipelineActions.cancelled());
      expect(state).toEqual(before);
    });
  });

  describe('error', () => {
    it('when transcription is active, writes transcription.error and clears active', () => {
      const state = reducer(
        freshTranscriptionActive(),
        PipelineActions.error({ message: 'transcription blew up' }),
      );
      expect(state.transcription.error).toBe('transcription blew up');
      expect(state.transcription.active).toBe(false);
    });

    it('when translation is active, writes translation.error, clears active, and resets phase to idle', () => {
      const state = reducer(
        freshTranslationActive(),
        PipelineActions.error({ message: 'translation blew up' }),
      );
      expect(state.translation.error).toBe('translation blew up');
      expect(state.translation.active).toBe(false);
      expect(state.translation.phase).toBe('idle');
    });

    it('when neither is active, is a no-op', () => {
      const state = reducer(
        initialState,
        PipelineActions.error({ message: 'unreachable' }),
      );
      expect(state).toEqual(initialState);
    });
  });
});
