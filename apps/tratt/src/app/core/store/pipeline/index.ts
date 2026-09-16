import { RootState } from '../index';

export const selectPipeline = (state: RootState) => state.pipeline;

// Field shapes mirror `login.component.ts`'s own `transcription`/`translation`
// component fields exactly (same field names, same types) — see the task
// brief's explicit instruction that Task 4's template rewrite should be
// close to mechanical, not a redesign of the UI's data model. Do not add
// fields the template doesn't render (e.g. no `annotJson`, no run-history) —
// this slice drives today's progress bars/phase text/elapsed-time/error
// messages, nothing more.
export type TranscriptionPipelinePhase =
  | 'idle'
  | 'downloading'
  | 'transcribing'
  | 'diarizing'
  | 'finalizing';

export type TranslationPipelinePhase =
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'translating'
  | 'finalizing';

export interface TranscriptionPipelineState {
  active: boolean;
  phase: TranscriptionPipelinePhase;
  downloadLoaded: number;
  downloadTotal: number;
  downloadExpectedBytes: number;
  downloadFile: string;
  elapsedMs: number;
  audioDurationS: number;
  segmentEndS: number;
  error: string | null;
  usedWebGPU: boolean;
}

export interface TranslationPipelineState {
  active: boolean;
  phase: TranslationPipelinePhase;
  downloadLoaded: number;
  downloadTotal: number;
  downloadFile: string;
  elapsedMs: number;
  segmentIndex: number;
  segmentTotal: number;
  error: string | null;
}

export interface PipelineState {
  transcription: TranscriptionPipelineState;
  translation: TranslationPipelineState;
  diarizationWarning: string | null;
}
