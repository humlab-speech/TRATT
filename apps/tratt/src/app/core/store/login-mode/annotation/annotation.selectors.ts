import { createFeatureSelector, createSelector } from '@ngrx/store';
import { selectMode } from '../../application/application.selectors';
import { LoginMode } from '../../index';
import { AnnotationState } from './index';

// Per-mode feature selectors
export const selectOnlineMode =
  createFeatureSelector<AnnotationState>('onlineMode');
export const selectDemoMode =
  createFeatureSelector<AnnotationState>('demoMode');
export const selectLocalMode =
  createFeatureSelector<AnnotationState>('localMode');
export const selectUrlMode = createFeatureSelector<AnnotationState>('urlMode');

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
        return local;
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
