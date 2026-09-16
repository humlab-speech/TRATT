import { createAction, props } from '@ngrx/store';
import type { DiarizationEvent } from '../../shared/service/local-diarization-runtime.service';
import type { TranscriptionEvent } from '../../shared/service/local-transcription.service';
import type { TranslationEvent } from '../../shared/service/local-translation.service';

/**
 * One action per case this reducer actually needs to react to, mirroring
 * `PipelineRunnerService`'s real `PipelineEvent` union (Task 2's shipped
 * shape — NOT the master plan's illustrative sketch) plus a small number of
 * UI-only, non-`PipelineEvent` actions (`transcriptionStart`,
 * `*Cancelled`, `*ErrorDismissed`) that mirror
 * `login.component.ts`'s own synchronous, component-initiated resets (the
 * pre-run reset before `pipelineRunnerService.run()` is even called, and the
 * cancel/dismiss button handlers) — these never arrive as `PipelineEvent`s,
 * so they can't be derived from the throttled stream and must be dispatched
 * directly by whatever calls this pipeline (Task 4's `login.component.ts`).
 *
 * Deliberately NOT a `createActionGroup` do/success/fail family — none of
 * these are request/response pairs, they're one-shot progress notifications,
 * matching the plain-`createAction` style already used for this kind of
 * event in `login-mode.actions.ts` (e.g. `setFeedback`, `createBundle`).
 *
 * `transcriptionEvent`/`diarizationEvent`/`translationEvent` each wrap the
 * inner event verbatim rather than being exploded into one action per inner
 * `type` — this keeps the action count from tripling for no benefit (the
 * reducer still switches on `event.type` internally) while staying a
 * mechanical, 1:1 mapping from `PipelineEvent`'s own stage/event split.
 */
export class PipelineActions {
  // Dispatched by the component synchronously, BEFORE calling
  // pipelineRunnerService.run() — mirrors login.component.ts's
  // `_startTranscriptionPipeline`'s object-literal reset. `downloadExpectedBytes`
  // is a UI-only value (computed from KB_WHISPER_MODELS/OPENAI_WHISPER_MODELS
  // metadata, per Task 2's own comment on why that computation stays in the
  // component rather than moving into PipelineRunnerService) that never
  // arrives via any PipelineEvent, so it must be passed in here.
  static transcriptionStart = createAction(
    '[Pipeline] transcription start',
    props<{ downloadExpectedBytes: number; usedWebGPU: boolean }>(),
  );

  // Wraps `{stage:'transcription', event: TranscriptionEvent}`.
  static transcriptionEvent = createAction(
    '[Pipeline] transcription event',
    props<{ event: TranscriptionEvent }>(),
  );

  // Wraps `{stage:'transcription', type:'finalized', diarizationWarning, willTranslate}`.
  static transcriptionFinalized = createAction(
    '[Pipeline] transcription finalized',
    props<{ diarizationWarning: string | null; willTranslate: boolean }>(),
  );

  // Mirrors login.component.ts's `cancelTranscription()` synchronous reset.
  static transcriptionCancelled = createAction(
    '[Pipeline] transcription cancelled',
  );

  // Mirrors `dismissTranscriptionError()`'s non-active branch.
  static transcriptionErrorDismissed = createAction(
    '[Pipeline] transcription error dismissed',
  );

  // Wraps `{stage:'diarization', type:'started'}`.
  static diarizationStarted = createAction('[Pipeline] diarization started');

  // Wraps `{stage:'diarization', type:'skipped'}` — no-op reducer-side,
  // kept as a real action (rather than omitted) so it still round-trips
  // through the throttled dispatch in Task 4 the same as every other event.
  static diarizationSkipped = createAction('[Pipeline] diarization skipped');

  // Wraps `{stage:'diarization', event: DiarizationEvent}`.
  static diarizationEvent = createAction(
    '[Pipeline] diarization event',
    props<{ event: DiarizationEvent }>(),
  );

  // Wraps `{stage:'translation', type:'start'}`.
  static translationStart = createAction('[Pipeline] translation start');

  // Wraps `{stage:'translation', event: TranslationEvent}`.
  static translationEvent = createAction(
    '[Pipeline] translation event',
    props<{ event: TranslationEvent }>(),
  );

  // Mirrors login.component.ts's `cancelTranslation()` synchronous reset.
  static translationCancelled = createAction(
    '[Pipeline] translation cancelled',
  );

  // Mirrors `dismissTranslationError()`'s non-active branch.
  static translationErrorDismissed = createAction(
    '[Pipeline] translation error dismissed',
  );

  // Wraps `{stage:'pipeline', type:'stalled', phase, message}`. Today's
  // component writes the stall message into `translation.error` (stalls only
  // ever happen mid-translation) — mirrored as-is.
  static stalled = createAction(
    '[Pipeline] stalled',
    props<{ phase: string; message: string }>(),
  );

  // Wraps `{stage:'pipeline', type:'result', diarizationWarning, ...}`.
  // Deliberately omits `annotJson` — that value routes straight to
  // `dropzone.setAnnotationFromAnnotJson()` / `proceedWithLogin()` in the
  // component (today, and presumably still in Task 4), never rendered from
  // NgRx state; carrying it here would make this a "pipeline-run history
  // log" rather than the progress-bar/phase-text-driving slice the brief
  // asks for. Task 4 reads `annotJson` off the raw `PipelineEvent` itself in
  // its own subscribe callback, independent of this dispatch.
  static result = createAction(
    '[Pipeline] result',
    props<{ diarizationWarning: string | null }>(),
  );

  // Wraps `{stage:'pipeline', type:'cancelled'}`. A genuine terminal event
  // (Task 2's fix round added it) but a reducer no-op — matches
  // login.component.ts's own comment that this event is a no-op there too,
  // because cancelTranscription()/cancelTranslation() already do their own
  // synchronous resets independent of it. Still a real, dispatched action
  // (see pipeline.reducer.spec.ts's throttle-survival test) so a consumer
  // CAN react to it if it ever needs to.
  static cancelled = createAction('[Pipeline] cancelled');

  // Not a PipelineEvent variant at all — mirrors `_onPipelineError`, which
  // reacts to the run() Observable's `error()` channel, not a `next()`
  // event. RxJS delivers `error()` notifications immediately, never buffered
  // by `throttleTime`, so this is not subject to the same drop risk the
  // terminal PipelineEvents are.
  static error = createAction('[Pipeline] error', props<{ message: string }>());
}
