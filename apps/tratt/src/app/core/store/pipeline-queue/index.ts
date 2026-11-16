import { Dictionary } from '@ngrx/entity';

/**
 * Per-bundle pipeline run state for the /workbench queue (step 3b-i).
 *
 * Deliberately separate from the singleton `pipeline` slice (step 3a), which
 * is a SINGLE run's progress with no bundleId anywhere and stays wired
 * exclusively to login.component.ts / `/local`. Nothing here touches it.
 */
export type BundleRunState =
  'idle' | 'queued' | 'running' | 'done' | 'failed' | 'interrupted';

export type BundleRunStage = 'decode' | 'asr' | 'diarization' | 'translation';

export type BundleRunErrorKind =
  'decode' | 'model-load' | 'oom' | 'cancelled' | 'unknown';

export interface BundleRunError {
  kind: BundleRunErrorKind;
  message: string;
}

export interface BundleRunStatus {
  state: BundleRunState;
  stage?: BundleRunStage;
  /** 0-1 within the current stage. */
  progress?: number;
  /** True while the current stage is downloading its model. */
  downloading?: boolean;
  error?: BundleRunError;
}

export interface PipelineQueueState {
  /** FIFO of pending bundle ids, oldest first. */
  queue: string[];
  /** Bundle id currently running, or null when idle. */
  activeId: string | null;
  /** 'pausing' = finish activeId, then stop; don't drain the rest. */
  mode: 'idle' | 'running' | 'pausing';
  /**
   * Keyed by bundleId. An ABSENT entry means "idle" — entries are created
   * lazily on first enqueue, never eagerly for every bundle. Read it through
   * `runStatusOf()` so that default is applied in exactly one place.
   */
  runs: Dictionary<BundleRunStatus>;
}

/**
 * Frozen so it can be shared as the default for every bundle with no `runs`
 * entry without any risk of a consumer mutating the shared object (NgRx's
 * strictStateImmutability runtime check does not cover values that never
 * entered the store).
 */
export const IDLE_RUN_STATUS: BundleRunStatus = Object.freeze({
  state: 'idle',
}) as BundleRunStatus;

/** Absent entry ⇒ idle. The single place that default is applied. */
export function runStatusOf(
  runs: Dictionary<BundleRunStatus>,
  bundleId: string,
): BundleRunStatus {
  return runs[bundleId] ?? IDLE_RUN_STATUS;
}

/**
 * One file's share of its run, 0–1, that never goes back: its stages each
 * report their own 0–1, so only speech recognition counts, as the bulk of
 * the work. Decoding and the model download come before it (0); speaker
 * separation and translation after it (1). The list rows' bars and the run
 * button's total both use it, so the rows add up to the total.
 */
export function fileFraction(status: BundleRunStatus): number {
  switch (status.stage) {
    case 'asr':
      return status.downloading ? 0 : (status.progress ?? 0);
    case 'diarization':
    case 'translation':
      return 1;
    default:
      return 0;
  }
}

/**
 * The file is being prepared (decoded, or its model loaded): work that
 * `fileFraction` can't show yet.
 */
export function isPreparing(status: BundleRunStatus): boolean {
  return (
    status.state === 'running' &&
    (status.stage === undefined ||
      status.stage === 'decode' ||
      (status.stage === 'asr' && !!status.downloading))
  );
}

export interface BundleSummaryForQueue {
  bundleId: string;
  awaitingMedia: boolean;
  /** Step 6: a bundle with any transcript content is never auto-run or offered for "run all". */
  hasAnnotationContent: boolean;
}

/**
 * The spec's skip rule: a bundle is eligible for `enqueue()` when its media
 * is available AND its current run state is not one of queued/running/done.
 *
 * NOT a store selector: `selectAllBundleSummaries`'s `awaitingMedia` is
 * `!b.audio.loaded`, and the reducer only ever sets `audio.loaded` for the
 * SELECTED bundle (see AnnotationActions.loadAudio.success) — so a bundle
 * with a real, resident AudioManager that simply hasn't been selected yet
 * would be wrongly excluded. `isResident` is AudioService.hasResident, the
 * same live check BundleListComponent already merges in for exactly this
 * reason.
 */
export function computeReadyBundleIds(
  summaries: BundleSummaryForQueue[],
  runs: Dictionary<BundleRunStatus>,
  isResident: (bundleId: string) => boolean,
): string[] {
  return summaries
    .filter((summary) => {
      if (summary.hasAnnotationContent) {
        return false;
      }
      if (summary.awaitingMedia && !isResident(summary.bundleId)) {
        return false;
      }
      const state = runStatusOf(runs, summary.bundleId).state;
      return state !== 'queued' && state !== 'running' && state !== 'done';
    })
    .map((summary) => summary.bundleId);
}

/**
 * What a re-transcription compares to tell whether the transcript changed
 * while the file waited or ran: every level's segment boundaries and label
 * text. Deliberately not the object identity — listening to a passage marks
 * it verified (a new transcript object), which is no reason to throw a
 * requested result away.
 */
export function transcriptFingerprint(
  transcript:
    | {
        levels?: {
          items: {
            time?: { samples?: number };
            labels?: { name?: string; value?: string }[];
          }[];
        }[];
      }
    | undefined,
): string {
  return JSON.stringify(
    (transcript?.levels ?? []).map((level) =>
      level.items.map((item) => [
        item.time?.samples,
        (item.labels ?? []).map((label) => [label.name, label.value]),
      ]),
    ),
  );
}
