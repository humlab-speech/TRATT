import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { OAnnotJSON } from '@tratt/annotation';
import type { OAudiofile } from '@tratt/media';
import type { AudioManager } from '@tratt/web-media';
import {
  filter,
  firstValueFrom,
  Observable,
  Subscriber,
  Subscription,
  tap,
} from 'rxjs';
import { applyOptionalSpeakerSegmentation } from '../../pages/login/local-offline-transcription.helpers';
import {
  DIARIZATION_DEFAULT_MODEL_ID,
  DiarizationEvent,
  LocalDiarizationRuntimeService,
} from './local-diarization-runtime.service';
import {
  LocalTranscriptionService,
  TranscriptionEvent,
  TranscriptionOptions,
} from './local-transcription.service';
import {
  LocalTranslationService,
  TranslationEvent,
  TranslationOptions,
} from './local-translation.service';

const TRANSLATION_DOWNLOAD_STALL_MS = 30_000;
const TRANSLATION_INIT_STALL_MS = 60_000;

type TranslationStallPhase = 'downloading' | 'initializing' | 'translating';

export type PipelineEvent =
  | { stage: 'transcription'; event: TranscriptionEvent }
  // Emitted once, synchronously, right after diarization (or the skipped
  // no-diarization branch) has resolved — mirrors login.component.ts's
  // today-inline `this.transcription.active = false;` write, relocated here
  // since that decision point now lives in the service, not the component.
  // Carries `diarizationWarning` HERE (not only on the terminal
  // `{stage:'pipeline', type:'result'}` event) so a consumer can surface it
  // immediately — on the chained transcribe->translate path, the old
  // component code set `this.diarizationWarning` at this exact point, well
  // before translation (which can take minutes) even starts. This preserves
  // that store-write TIMING exactly (matching the zero-behavior-change bar),
  // not the banner's actual on-screen visibility — the banner's own template
  // gate (`login.component.html`) already unmounts it the instant
  // `transcription.active` goes false, which happens at this same point, so
  // it was never actually renderable during translation in either the old
  // code or this one. That's a separate, pre-existing UI bug, not something
  // this fix creates or closes — see the design doc's step-3a notes.
  // Delivering the warning only on the final `result` event (the bug this
  // replaced) would additionally have meant the underlying STATE arrived the
  // instant before the pipeline navigates away. `willTranslate`
  // lets the consumer decide the same phase transition
  // (`transcription.phase = 'idle'`) the original code made from the SAME
  // captured `translateOptions` value the service already used to decide
  // whether to chain into translation, instead of re-reading it
  // independently from a live external source (e.g. a dropzone field) that
  // could in principle disagree.
  | {
      stage: 'transcription';
      type: 'finalized';
      diarizationWarning: string | null;
      willTranslate: boolean;
    }
  | { stage: 'diarization'; event: DiarizationEvent }
  | { stage: 'diarization'; type: 'skipped' }
  // Emitted synchronously right before diarize() is called, only when
  // diarization is enabled — mirrors today's inline
  // `this.transcription.phase = 'diarizing';` write that used to happen at
  // the same point inside handleCompletedTranscription(), before awaiting
  // the diarization result.
  | { stage: 'diarization'; type: 'started' }
  // Emitted once, synchronously, right before subscribing to
  // localTranslationService.translate() — lets the consumer reset its own
  // translation UI state exactly like today's `_startTranslation()` did,
  // for BOTH the "chained after transcription" and "translation-only submit"
  // entry points.
  | { stage: 'translation'; type: 'start' }
  | { stage: 'translation'; event: TranslationEvent }
  | { stage: 'pipeline'; type: 'stalled'; phase: string; message: string }
  | {
      stage: 'pipeline';
      type: 'result';
      annotJson: OAnnotJSON;
      diarizationWarning: string | null;
    }
  | { stage: 'pipeline'; type: 'cancelled' };

export interface PipelineInput {
  /**
   * Required when `transcribeOptions` is set (transcription, and the
   * optional diarization chained after it, both need the live audio).
   * Ignored on a translation-only run (`translateOptions` without
   * `transcribeOptions`) — callers on that path don't need to eagerly read
   * a dropzone's `audioManager`, which throws before any audio has ever
   * been dropped.
   */
  audioManager?: AudioManager;
  /** Same optionality as `audioManager`, for the same reason. */
  oaudiofile?: OAudiofile;
  transcribeOptions?: TranscriptionOptions;
  translateOptions?: TranslationOptions;
  /**
   * Required when `translateOptions` is set without `transcribeOptions`
   * (a translation-only submit, matching today's `onOfflineSubmit`'s second
   * branch): the annotation to translate directly. Ignored otherwise — when
   * `transcribeOptions` is present, the annotation to translate is whatever
   * transcription (and optional diarization) just produced.
   */
  annotJson?: OAnnotJSON;
}

type ActiveStage = 'transcription' | 'translation' | null;

/**
 * Orchestrates the ASR -> (optional) diarization -> (optional) translation
 * pipeline that `login.component.ts` used to run inline. Pure relocation of
 * that orchestration logic — see login.component.spec.ts (Task 1's
 * characterization suite) for the exact sequencing/timing this must
 * preserve, and pipeline-runner.service.spec.ts for this service's own
 * regression net.
 */
@Injectable({ providedIn: 'root' })
export class PipelineRunnerService {
  private _activeStage: ActiveStage = null;
  private _stageSub: Subscription | null = null;
  private _stallTimerId: ReturnType<typeof setTimeout> | null = null;
  private _translationPhase: TranslationStallPhase = 'downloading';
  private _diarizationWarning: string | null = null;
  private _subscriber: Subscriber<PipelineEvent> | null = null;

  constructor(
    private localTranscriptionService: LocalTranscriptionService,
    private localDiarizationRuntimeService: LocalDiarizationRuntimeService,
    private localTranslationService: LocalTranslationService,
    private transloco: TranslocoService,
  ) {}

  run(input: PipelineInput): Observable<PipelineEvent> {
    return new Observable<PipelineEvent>((subscriber) => {
      this._diarizationWarning = null;
      this._subscriber = subscriber;

      if (input.transcribeOptions) {
        this._activeStage = 'transcription';
        this._runTranscriptionStage(input, input.transcribeOptions, subscriber);
      } else if (input.translateOptions && input.annotJson) {
        this._activeStage = 'translation';
        this._runTranslationStage(
          input.annotJson,
          input.translateOptions,
          subscriber,
        );
      } else {
        this._subscriber = null;
        subscriber.complete();
      }

      return () => {
        this._clearStallTimer();
        this._stageSub?.unsubscribe();
        this._stageSub = null;
      };
    });
  }

  /**
   * Determines which stage is active from this service's own tracked state
   * (not from the caller) and cancels exactly the underlying service(s) that
   * stage owns — both transcription+diarization for an active transcription
   * stage (matching today's `cancelTranscription()`), or translation alone
   * for an active translation stage (matching today's `cancelTranslation()`).
   * A no-op when nothing is active. When a stage WAS active, emits a
   * terminal `{stage:'pipeline', type:'cancelled'}` event on the returned
   * `run()` Observable before completing it, so a consumer can react to
   * "the run was cancelled" as a real event rather than just silence.
   */
  cancel(): void {
    const wasActive = this._activeStage !== null;

    if (this._activeStage === 'translation') {
      this._clearStallTimer();
      this.localTranslationService.cancel();
    } else if (this._activeStage === 'transcription') {
      this.localTranscriptionService.cancel();
      this.localDiarizationRuntimeService.cancel();
    }
    this._stageSub?.unsubscribe();
    this._stageSub = null;
    this._activeStage = null;

    const subscriber = this._subscriber;
    this._subscriber = null;
    if (wasActive && subscriber && !subscriber.closed) {
      subscriber.next({ stage: 'pipeline', type: 'cancelled' });
      subscriber.complete();
    }
  }

  private _runTranscriptionStage(
    input: PipelineInput,
    opts: TranscriptionOptions,
    subscriber: Subscriber<PipelineEvent>,
  ): void {
    // Non-null: only called from run() when input.transcribeOptions is set,
    // the one case PipelineInput's own doc comment guarantees audioManager/
    // oaudiofile are provided.
    this._stageSub = this.localTranscriptionService
      .transcribe(input.audioManager!, input.oaudiofile!, opts)
      .subscribe({
        next: (event: TranscriptionEvent) => {
          subscriber.next({ stage: 'transcription', event });
          if (event.type === 'result') {
            this._handleTranscriptionResult(
              input,
              opts,
              event.annotJson,
              subscriber,
            ).catch((err) => {
              // A rejection here used to leave the run non-terminal forever:
              // the queue never advanced and `pausing` never resolved.
              this._activeStage = null;
              this._subscriber = null;
              subscriber.error(err);
            });
          }
        },
        error: (err) => {
          this._activeStage = null;
          this._subscriber = null;
          subscriber.error(err);
        },
      });
  }

  private async _handleTranscriptionResult(
    input: PipelineInput,
    opts: TranscriptionOptions,
    annotJson: OAnnotJSON,
    subscriber: Subscriber<PipelineEvent>,
  ): Promise<void> {
    const diarizationEnabled = !!opts.diarization;

    subscriber.next({
      stage: 'diarization',
      type: diarizationEnabled ? 'started' : 'skipped',
    });

    const segmented = await applyOptionalSpeakerSegmentation({
      annotJson,
      diarizationEnabled,
      runDiarization: async () => {
        const diarizationOptions = opts.diarization ?? {
          modelId: DIARIZATION_DEFAULT_MODEL_ID,
          useWebGPU: false,
        };

        const result = await firstValueFrom(
          this.localDiarizationRuntimeService
            // Non-null: reached only via _handleTranscriptionResult, itself
            // only reachable from the transcription stage — see the
            // non-null comment on _runTranscriptionStage above.
            .diarize(input.audioManager!, diarizationOptions)
            .pipe(
              tap((event: DiarizationEvent) => {
                subscriber.next({ stage: 'diarization', event });
              }),
              filter(
                (
                  event: DiarizationEvent,
                ): event is Extract<DiarizationEvent, { type: 'result' }> =>
                  event.type === 'result',
              ),
            ),
        );

        return result.turns;
      },
    });

    if (subscriber.closed) {
      // Cancelled while diarization was in flight. cancel() has already torn
      // down the transcription/diarization services, unsubscribed _stageSub,
      // and completed this subscriber — resuming into a translation stage or
      // emitting further events here would leak a worker and a stall timer
      // that nothing can ever reach again, and nobody is listening anyway.
      return;
    }

    const diarizationWarning = segmented.errorMessage
      ? this.transloco.translate(
          'login.auto-transcription.diarization failed',
          {
            message: segmented.errorMessage,
          },
        )
      : null;
    if (diarizationWarning) {
      console.error('[diarization]', diarizationWarning);
    }
    this._diarizationWarning = diarizationWarning;

    subscriber.next({
      stage: 'transcription',
      type: 'finalized',
      diarizationWarning,
      willTranslate: !!input.translateOptions,
    });

    if (input.translateOptions) {
      this._activeStage = 'translation';
      this._runTranslationStage(
        segmented.annotJson,
        input.translateOptions,
        subscriber,
      );
    } else {
      this._activeStage = null;
      this._subscriber = null;
      subscriber.next({
        stage: 'pipeline',
        type: 'result',
        annotJson: segmented.annotJson,
        diarizationWarning,
      });
      subscriber.complete();
    }
  }

  private _runTranslationStage(
    annotJson: OAnnotJSON,
    trOpts: TranslationOptions,
    subscriber: Subscriber<PipelineEvent>,
  ): void {
    subscriber.next({ stage: 'translation', type: 'start' });
    this._translationPhase = 'downloading';
    this._armStallTimer(subscriber);

    this._stageSub = this.localTranslationService
      .translate(annotJson, trOpts)
      .subscribe({
        next: (event: TranslationEvent) => {
          subscriber.next({ stage: 'translation', event });

          if (event.type === 'result') {
            this._clearStallTimer();
            this._activeStage = null;
            this._subscriber = null;
            subscriber.next({
              stage: 'pipeline',
              type: 'result',
              annotJson: event.annotJson,
              diarizationWarning: this._diarizationWarning,
            });
            subscriber.complete();
            return;
          }

          if (event.type === 'download-progress') {
            this._translationPhase = 'downloading';
          } else if (event.type === 'model-init') {
            this._translationPhase = 'initializing';
          } else if (event.type === 'translate-start') {
            this._translationPhase = 'translating';
          }
          this._armStallTimer(subscriber);
        },
        error: (err) => {
          this._clearStallTimer();
          this._activeStage = null;
          this._subscriber = null;
          subscriber.error(err);
        },
      });
  }

  private _armStallTimer(subscriber: Subscriber<PipelineEvent>): void {
    this._clearStallTimer();
    const phase = this._translationPhase;
    const budget =
      phase === 'initializing' || phase === 'translating'
        ? TRANSLATION_INIT_STALL_MS
        : TRANSLATION_DOWNLOAD_STALL_MS;
    this._stallTimerId = setTimeout(() => {
      if (this._activeStage !== 'translation') {
        return;
      }
      const message = this.transloco.translate(
        phase === 'initializing'
          ? 'login.translation.stall init'
          : phase === 'translating'
            ? 'login.translation.stall translating'
            : 'login.translation.stall download',
      );
      subscriber.next({ stage: 'pipeline', type: 'stalled', phase, message });
    }, budget);
  }

  private _clearStallTimer(): void {
    if (this._stallTimerId !== null) {
      clearTimeout(this._stallTimerId);
      this._stallTimerId = null;
    }
  }
}
