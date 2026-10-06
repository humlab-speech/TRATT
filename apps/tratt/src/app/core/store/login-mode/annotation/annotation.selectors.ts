import { createFeatureSelector, createSelector } from '@ngrx/store';
import { selectMode } from '../../application/application.selectors';
import { LoginMode } from '../../index';
import { AnnotationState } from './index';
import {
  localBundleAdapter,
  LocalBundleCollectionState,
  resolveLocalBundleState,
} from './local-bundle-collection';

const { selectAll: selectAllBundleEntities } = localBundleAdapter.getSelectors();

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
    })),
);

/** The guidelines' break ("silence") marker code, e.g. `<P>`, if any. */
export function breakMarkerCodeOf(
  guidelines: { selected?: { json?: unknown } } | undefined,
): string | undefined {
  const markers = (
    guidelines?.selected?.json as
      | { markers?: { type?: string; code?: string }[] }
      | undefined
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
