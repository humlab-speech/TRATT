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

// NOTE: no `elapsedMs` field here — Task 4 kept elapsed-time ticking
// entirely local to login.component.ts (a plain, unthrottled component
// field driven by its own setInterval), per the master plan's Global
// Constraint that a once-a-second UI tick must never write into NgRx. Task 3
// speculatively added `elapsedMs`/`*ElapsedTick` actions "in case Task 4
// needed them"; Task 4 didn't, so they were removed as dead exported
// surface rather than shipped unused.
export interface TranscriptionPipelineState {
  active: boolean;
  phase: TranscriptionPipelinePhase;
  downloadLoaded: number;
  downloadTotal: number;
  downloadExpectedBytes: number;
  downloadFile: string;
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
  segmentIndex: number;
  segmentTotal: number;
  error: string | null;
}

export interface PipelineState {
  transcription: TranscriptionPipelineState;
  translation: TranslationPipelineState;
  diarizationWarning: string | null;
}
