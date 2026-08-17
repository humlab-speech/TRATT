import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ApplicationState } from './index';

export const selectApplicationFeature =
  createFeatureSelector<ApplicationState>('application');

export const selectLoading = createSelector(
  selectApplicationFeature,
  (s) => s.loading,
);
export const selectLoadingStatus = createSelector(
  selectLoading,
  (l) => l.status,
);
export const selectAppConfiguration = createSelector(
  selectApplicationFeature,
  (s) => s.appConfiguration,
);
export const selectIdb = createSelector(selectApplicationFeature, (s) => s.idb);
export const selectIdbLoaded = createSelector(selectIdb, (idb) => idb.loaded);
export const selectLoggedIn = createSelector(
  selectApplicationFeature,
  (s) => s.loggedIn,
);
export const selectInitialized = createSelector(
  selectApplicationFeature,
  (s) => s.initialized,
);
export const selectShortcutsEnabled = createSelector(
  selectApplicationFeature,
  (s) => s.shortcutsEnabled,
);
export const selectOptions = createSelector(
  selectApplicationFeature,
  (s) => s.options,
);
export const selectMode = createSelector(
  selectApplicationFeature,
  (s) => s.mode,
);
export const selectReloaded = createSelector(
  selectApplicationFeature,
  (s) => s.reloaded,
);
export const selectLanguage = createSelector(
  selectApplicationFeature,
  (s) => s.language,
);
export const selectConsoleEntries = createSelector(
  selectApplicationFeature,
  (s) => s.consoleEntries,
);
