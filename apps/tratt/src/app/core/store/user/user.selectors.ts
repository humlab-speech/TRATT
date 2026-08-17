import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UserState } from './index';

export const selectUserFeature = createFeatureSelector<UserState>('user');

export const selectUserName = createSelector(selectUserFeature, (s) => s.name);
export const selectUserEmail = createSelector(
  selectUserFeature,
  (s) => s.email,
);
