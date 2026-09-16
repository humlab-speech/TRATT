import { createFeatureSelector, createSelector } from '@ngrx/store';
import { PipelineState } from './index';

// login.component.html reads `transcription.<field>`/`translation.<field>`
// extensively across many fields at once (progress bars, phase text,
// elapsed time, error banners — see login.component.html lines ~263-490),
// not one field in isolation at a time. Whole-object selectors match that
// usage pattern; splitting into one selector per field (as
// application.selectors.ts does for its more independently-read fields)
// would just add indirection Task 4's template doesn't need. Task 4 is free
// to add narrower derived selectors on top of these if it turns out to want
// them.
export const selectPipelineFeature =
  createFeatureSelector<PipelineState>('pipeline');

export const selectTranscription = createSelector(
  selectPipelineFeature,
  (s) => s.transcription,
);

export const selectTranslation = createSelector(
  selectPipelineFeature,
  (s) => s.translation,
);

export const selectDiarizationWarning = createSelector(
  selectPipelineFeature,
  (s) => s.diarizationWarning,
);
