import { createReducer, on } from '@ngrx/store';
import { PipelineState } from './index';
import { PipelineActions } from './pipeline.actions';

export const initialState: PipelineState = {
  transcription: {
    active: false,
    phase: 'idle',
    downloadLoaded: 0,
    downloadTotal: 0,
    downloadExpectedBytes: 0,
    downloadFile: '',
    elapsedMs: 0,
    audioDurationS: 0,
    segmentEndS: 0,
    error: null,
    usedWebGPU: false,
  },
  translation: {
    active: false,
    phase: 'idle',
    downloadLoaded: 0,
    downloadTotal: 0,
    downloadFile: '',
    elapsedMs: 0,
    segmentIndex: 0,
    segmentTotal: 0,
    error: null,
  },
  diarizationWarning: null,
};

export const reducer = createReducer(
  initialState,

  // Mirrors login.component.ts's `_startTranscriptionPipeline`'s
  // object-literal reset exactly.
  on(
    PipelineActions.transcriptionStart,
    (state, { downloadExpectedBytes, usedWebGPU }): PipelineState => ({
      ...state,
      diarizationWarning: null,
      transcription: {
        active: true,
        phase: 'downloading',
        downloadLoaded: 0,
        downloadTotal: 0,
        downloadExpectedBytes,
        downloadFile: '',
        elapsedMs: 0,
        audioDurationS: 0,
        segmentEndS: 0,
        error: null,
        usedWebGPU,
      },
    }),
  ),

  // Mirrors `_onTranscriptionEvent` field-by-field. `'result'` here is the
  // inner TranscriptionEvent's result (annotJson dropped — see
  // pipeline.actions.ts's comment on why `result`/annotJson don't live in
  // this slice), distinct from the outer pipeline-level `result` action.
  on(PipelineActions.transcriptionEvent, (state, { event }): PipelineState => {
    switch (event.type) {
      case 'download-progress':
        return {
          ...state,
          transcription: {
            ...state.transcription,
            phase: 'downloading',
            downloadLoaded: event.loaded,
            downloadTotal: event.total,
            downloadFile: event.file,
          },
        };
      case 'transcribe-start':
        return {
          ...state,
          transcription: {
            ...state.transcription,
            phase: 'transcribing',
            audioDurationS: event.audioDurationS,
            elapsedMs: 0,
            segmentEndS: 0,
          },
        };
      case 'segment-progress':
        return {
          ...state,
          transcription: {
            ...state.transcription,
            segmentEndS: event.segmentEndS,
          },
        };
      case 'backend-fallback':
        return {
          ...state,
          transcription: {
            ...state.transcription,
            usedWebGPU: false,
            phase: 'downloading',
            downloadLoaded: 0,
            downloadTotal: 0,
            downloadFile: 'Retrying with WASM after WebGPU startup failure',
          },
        };
      case 'result':
        return {
          ...state,
          transcription: { ...state.transcription, phase: 'finalizing' },
        };
      default:
        // 'error' is delivered via the Observable's error() channel, not a
        // next()-emitted TranscriptionEvent, so it never reaches here — see
        // PipelineActions.error.
        return state;
    }
  }),

  on(
    PipelineActions.transcriptionFinalized,
    (state, { diarizationWarning, willTranslate }): PipelineState => ({
      ...state,
      diarizationWarning,
      transcription: {
        ...state.transcription,
        active: false,
        phase: willTranslate ? 'idle' : state.transcription.phase,
      },
    }),
  ),

  on(
    PipelineActions.transcriptionCancelled,
    (state): PipelineState => ({
      ...state,
      transcription: { ...state.transcription, active: false, phase: 'idle' },
    }),
  ),

  on(
    PipelineActions.transcriptionErrorDismissed,
    (state): PipelineState => ({
      ...state,
      transcription: { ...state.transcription, error: null },
    }),
  ),

  on(
    PipelineActions.transcriptionElapsedTick,
    (state, { elapsedMs }): PipelineState => ({
      ...state,
      transcription: { ...state.transcription, elapsedMs },
    }),
  ),

  on(
    PipelineActions.diarizationStarted,
    (state): PipelineState => ({
      ...state,
      transcription: { ...state.transcription, phase: 'diarizing' },
    }),
  ),

  // No-op — matches login.component.ts's own comment: the disabled/'skipped'
  // branch never touched `.phase` (or any other field) in the original code.
  on(PipelineActions.diarizationSkipped, (state): PipelineState => state),

  on(PipelineActions.diarizationEvent, (state, { event }): PipelineState => {
    if (event.type === 'download-progress') {
      return {
        ...state,
        transcription: {
          ...state.transcription,
          downloadLoaded: event.loaded,
          downloadTotal: event.total,
          downloadFile: event.file,
        },
      };
    }
    // 'diarize-start'/'result'/'error' aren't read by login.component.ts's
    // transcription-panel rendering today — no-op, matches current behavior.
    return state;
  }),

  // Mirrors `_startTranslation`'s object-literal reset exactly.
  on(
    PipelineActions.translationStart,
    (state): PipelineState => ({
      ...state,
      translation: {
        active: true,
        phase: 'downloading',
        downloadLoaded: 0,
        downloadTotal: 0,
        downloadFile: '',
        elapsedMs: 0,
        segmentIndex: 0,
        segmentTotal: 0,
        error: null,
      },
    }),
  ),

  on(PipelineActions.translationEvent, (state, { event }): PipelineState => {
    switch (event.type) {
      case 'download-progress':
        return {
          ...state,
          translation: {
            ...state.translation,
            phase: 'downloading',
            downloadLoaded: event.loaded,
            downloadTotal: event.total,
            downloadFile: event.file,
          },
        };
      case 'model-init':
        return {
          ...state,
          translation: { ...state.translation, phase: 'initializing' },
        };
      case 'translate-start':
        return {
          ...state,
          translation: {
            ...state.translation,
            phase: 'translating',
            segmentTotal: event.total,
            segmentIndex: 0,
            elapsedMs: 0,
          },
        };
      case 'segment-progress':
        return {
          ...state,
          translation: {
            ...state.translation,
            segmentIndex: event.index,
            segmentTotal: event.total,
          },
        };
      case 'result':
        return {
          ...state,
          translation: {
            ...state.translation,
            active: false,
            phase: 'finalizing',
          },
        };
      default:
        // 'segments' isn't consumed by login.component.ts today — no-op,
        // matches current behavior. 'error' arrives via error(), not here.
        return state;
    }
  }),

  on(
    PipelineActions.translationCancelled,
    (state): PipelineState => ({
      ...state,
      translation: { ...state.translation, active: false, phase: 'idle' },
    }),
  ),

  on(
    PipelineActions.translationErrorDismissed,
    (state): PipelineState => ({
      ...state,
      translation: { ...state.translation, error: null },
    }),
  ),

  on(
    PipelineActions.translationElapsedTick,
    (state, { elapsedMs }): PipelineState => ({
      ...state,
      translation: { ...state.translation, elapsedMs },
    }),
  ),

  // Mirrors today's `this.translation.error = event.message;` on a stall.
  on(
    PipelineActions.stalled,
    (state, { message }): PipelineState => ({
      ...state,
      translation: { ...state.translation, error: message },
    }),
  ),

  on(
    PipelineActions.result,
    (state, { diarizationWarning }): PipelineState => ({
      ...state,
      diarizationWarning,
    }),
  ),

  // No-op — matches login.component.ts's own comment that the 'cancelled'
  // PipelineEvent is a no-op there too (cancelTranscription()/
  // cancelTranslation() already do their own synchronous resets).
  on(PipelineActions.cancelled, (state): PipelineState => state),

  // Mirrors `_onPipelineError`: whichever stage is currently active absorbs
  // the error. Translation additionally resets phase to 'idle' (matching
  // today's exact field-by-field write); transcription does not (matching
  // today, where only `.error`/`.active` are written on transcription error).
  on(PipelineActions.error, (state, { message }): PipelineState => {
    if (state.transcription.active) {
      return {
        ...state,
        transcription: {
          ...state.transcription,
          error: message,
          active: false,
        },
      };
    }
    if (state.translation.active) {
      return {
        ...state,
        translation: {
          ...state.translation,
          error: message,
          active: false,
          phase: 'idle',
        },
      };
    }
    return state;
  }),
);
