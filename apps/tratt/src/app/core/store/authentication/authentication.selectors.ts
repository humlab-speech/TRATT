import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AuthenticationState } from './index';

export const selectAuthFeature =
  createFeatureSelector<AuthenticationState>('authentication');

export const selectAuthenticated = createSelector(
  selectAuthFeature,
  (s) => s.authenticated,
);
export const selectWebToken = createSelector(
  selectAuthFeature,
  (s) => s.webToken,
);
export const selectAuthMe = createSelector(selectAuthFeature, (s) => s.me);
export const selectServerOnline = createSelector(
  selectAuthFeature,
  (s) => s.serverOnline,
);
export const selectLoginErrorMessage = createSelector(
  selectAuthFeature,
  (s) => s.loginErrorMessage,
);
