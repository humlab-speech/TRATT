import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ASRState } from './index';

export const selectASRFeature = createFeatureSelector<ASRState>('asr');

export const selectASRSettings = createSelector(
  selectASRFeature,
  (s) => s.settings,
);
export const selectASRQueue = createSelector(selectASRFeature, (s) => s.queue);
export const selectASRQueueItems = createSelector(
  selectASRQueue,
  (q) => q?.items ?? [],
);
export const selectASREnabled = createSelector(
  selectASRFeature,
  (s) => s.isEnabled,
);
export const selectASRLanguages = createSelector(
  selectASRFeature,
  (s) => s.asrLanguages,
);
export const selectMausLanguages = createSelector(
  selectASRFeature,
  (s) => s.mausLanguages,
);
export const selectASRLanguageSettings = createSelector(
  selectASRFeature,
  (s) => s.languageSettings,
);
