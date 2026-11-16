import { createFeatureSelector, createSelector } from '@ngrx/store';
import { selectMode } from '../../application/application.selectors';
import { LoginMode } from '../../index';
import { AnnotationState } from './index';
import {
  localBundleAdapter,
  LocalBundleCollectionState,
  resolveLocalBundleState,
} from './local-bundle-collection';

const { selectAll: selectAllBundleEntities } =
  localBundleAdapter.getSelectors();

// Per-mode feature selectors
export const selectOnlineMode =
  createFeatureSelector<AnnotationState>('onlineMode');
export const selectDemoMode =
  createFeatureSelector<AnnotationState>('demoMode');
export const selectLocalMode =
  createFeatureSelector<LocalBundleCollectionState>('localMode');
export const selectUrlMode = createFeatureSelector<AnnotationState>('urlMode');

// Hard-wired to selectLocalMode; harmless today since AudioService (used by ONLINE/DEMO/URL
// sessions too) always resolves through the same constant key, but revisit once step 2.7 makes
// selectedBundleId genuinely variable — non-LOCAL sessions would then read LOCAL's selection state.
export const selectSelectedBundleId = createSelector(
  selectLocalMode,
  (local): string => local.selectedBundleId,
);

export const selectAllBundleSummaries = createSelector(
  selectLocalMode,
  (local) =>
    selectAllBundleEntities(local.bundles).map((b) => ({
      bundleId: b.bundleId,
      name: b.sessionFile?.name,
      selected: b.bundleId === local.selectedBundleId,
      awaitingMedia: !b.audio.loaded,
      // Step 6: a bundle with real annotation content is excluded from
      // auto-enqueue and "run all" — see transcriptHasContent().
      hasAnnotationContent: transcriptHasContent(
        b.transcript,
        breakMarkerCodeOf(b.guidelines),
      ),
      coverage: transcriptCoverage(
        b.transcript,
        breakMarkerCodeOf(b.guidelines),
      ),
    })),
);

/** How much of a bundle's audio its transcript covers with text. */
export interface TranscriptCoverage {
  /** Segments holding text (not empty, not just the break marker). */
  withText: number;
  /** All segments of the tier. */
  segments: number;
  /** Share of the audio, 0–1, lying in segments that hold text. */
  fraction: number;
}

/** The levels of a transcript, as far as coverage and tiers need them. */
interface TextLevels {
  levels?: {
    name?: string;
    type?: string;
    items: {
      time?: { samples: number };
      labels?: { name?: string; value?: string }[];
    }[];
  }[];
}

/**
 * A segment's text: the label named after its tier, else the first one that
 * is not a Speaker label (as the VISP save writes it). Empty and break-marker
 * values are no text, as in {@link transcriptHasContent}.
 */
function segmentText(
  item: { labels?: { name?: string; value?: string }[] },
  tierName: string | undefined,
  breakMarkerCode: string | undefined,
): string | undefined {
  const labels = item.labels ?? [];
  const text = (
    labels.find((l) => l.name === tierName) ??
    labels.find((l) => l.name !== 'Speaker')
  )?.value?.trim();
  return text && text !== breakMarkerCode ? text : undefined;
}

/**
 * Coverage of the segment tier that covers the most audio with text, or
 * `undefined` when there is no segment tier with segments.
 *
 * Measured by duration rather than by counting segments, so one long
 * untranscribed stretch does not read as nearly done. Segment tiers cover the
 * whole recording and each segment stores only its end sample, so the last
 * segment's end is the audio's length — no decoded audio is needed.
 */
export function transcriptCoverage(
  transcript: TextLevels | undefined,
  breakMarkerCode?: string,
): TranscriptCoverage | undefined {
  let best: TranscriptCoverage | undefined;
  for (const level of transcript?.levels ?? []) {
    if (level.type !== 'SEGMENT' || level.items.length === 0) continue;
    const total = level.items[level.items.length - 1].time?.samples ?? 0;
    let start = 0;
    let covered = 0;
    let withText = 0;
    for (const item of level.items) {
      const end = item.time?.samples ?? start;
      if (segmentText(item, level.name, breakMarkerCode)) {
        withText++;
        covered += Math.max(0, end - start);
      }
      start = end;
    }
    const candidate: TranscriptCoverage = {
      withText,
      segments: level.items.length,
      fraction: total > 0 ? Math.min(1, covered / total) : 0,
    };
    if (
      !best ||
      candidate.fraction > best.fraction ||
      (candidate.fraction === best.fraction &&
        candidate.withText > best.withText)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** The guidelines' break ("silence") marker code, e.g. `<P>`, if any. */
export function breakMarkerCodeOf(
  guidelines: { selected?: { json?: unknown } } | undefined,
): string | undefined {
  const markers = (
    guidelines?.selected?.json as
      { markers?: { type?: string; code?: string }[] } | undefined
  )?.markers;
  return markers?.find((m) => m.type === 'break')?.code;
}

/**
 * Whether a transcript holds anything a pipeline run could overwrite.
 *
 * NOT simply "any level has items": the session bootstrap
 * (AnnotationLoadEffects.loadSegments) seeds a brand-new bundle with ONE
 * empty segment spanning the whole file, so the first file of every session
 * looked "already transcribed" and was silently excluded from auto-run and
 * from the "Transcribe N file(s)" button. Content = any label with text, or
 * more than one item in a level (boundaries the user placed by hand).
 *
 * `breakMarkerCode`: once guidelines are loaded, empty segments are
 * normalised to the break marker (startAnnotation.success), so a lone
 * segment holding only that marker is just as empty.
 */
export function transcriptHasContent(
  transcript:
    | {
        levels?: {
          items: { labels?: { name?: string; value?: string }[] }[];
        }[];
      }
    | undefined,
  breakMarkerCode?: string,
): boolean {
  const isEmptyValue = (value: string | undefined) => {
    const trimmed = (value ?? '').trim();
    return trimmed.length === 0 || trimmed === breakMarkerCode;
  };
  return (
    transcript?.levels?.some(
      (level) =>
        level.items.length > 1 ||
        level.items.some((item) =>
          (item.labels ?? []).some((label) => !isEmptyValue(label.value)),
        ),
    ) ?? false
  );
}

/** Returns the active mode's AnnotationState based on application.mode. */
export const selectActiveAnnotation = createSelector(
  selectMode,
  selectOnlineMode,
  selectDemoMode,
  selectLocalMode,
  selectUrlMode,
  (mode, online, demo, local, url): AnnotationState | undefined => {
    switch (mode) {
      case LoginMode.ONLINE:
        return online;
      case LoginMode.DEMO:
        return demo;
      case LoginMode.LOCAL:
        return resolveLocalBundleState(local);
      case LoginMode.URL:
        return url;
      default:
        return undefined;
    }
  },
);

export const selectAnnotationTranscript = createSelector(
  selectActiveAnnotation,
  (s) => s?.transcript,
);
export const selectAnnotationCurrentLevel = createSelector(
  selectAnnotationTranscript,
  (t) => t?.currentLevel,
);
export const selectAnnotationCurrentLevelIndex = createSelector(
  selectAnnotationTranscript,
  (t) => t?.selectedLevelIndex ?? 0,
);
export const selectAnnotationLevels = createSelector(
  selectAnnotationTranscript,
  (t) => t?.levels,
);
export const selectAnnotationLinks = createSelector(
  selectAnnotationTranscript,
  (t) => t?.links,
);
export const selectCurrentSession = createSelector(
  selectActiveAnnotation,
  (s) => s?.currentSession,
);
export const selectCurrentTask = createSelector(
  selectCurrentSession,
  (s) => s?.task,
);
export const selectCurrentProject = createSelector(
  selectCurrentSession,
  (s) => s?.currentProject,
);
export const selectProjectConfig = createSelector(
  selectActiveAnnotation,
  (s) => s?.projectConfig,
);
export const selectGuidelines = createSelector(
  selectActiveAnnotation,
  (s) => s?.guidelines,
);
export const selectAnnotationAudio = createSelector(
  selectActiveAnnotation,
  (s) => s?.audio,
);
export const selectAnnotationAudioLoaded = createSelector(
  selectAnnotationAudio,
  (a) => a?.loaded ?? false,
);
export const selectSavingNeeded = createSelector(
  selectActiveAnnotation,
  (s) => s?.savingNeeded ?? false,
);
export const selectLogging = createSelector(
  selectActiveAnnotation,
  (s) => s?.logging,
);
export const selectImportOptions = createSelector(
  selectActiveAnnotation,
  (s) => s?.importOptions,
);
export const selectImportConverter = createSelector(
  selectActiveAnnotation,
  (s) => s?.importConverter,
);
