import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { AnnotationState } from './index';

export const DEFAULT_BUNDLE_ID = 'bundle-1';

export const localBundleAdapter: EntityAdapter<AnnotationState> =
  createEntityAdapter<AnnotationState>({
    selectId: () => DEFAULT_BUNDLE_ID,
  });

export interface LocalBundleCollectionState {
  bundles: EntityState<AnnotationState>;
  selectedBundleId: string;
}

export function resolveLocalBundleState(
  state: LocalBundleCollectionState | undefined,
): AnnotationState | undefined {
  return state?.bundles.entities[state.selectedBundleId];
}
