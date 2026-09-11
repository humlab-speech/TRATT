import { createEntityAdapter, EntityAdapter, EntityState } from '@ngrx/entity';
import { AnnotationState } from './index';

export const DEFAULT_BUNDLE_ID = 'bundle-1';

export function generateBundleId(): string {
  return crypto.randomUUID();
}

export interface IdentifiedAnnotationState extends AnnotationState {
  bundleId: string;
}

export const localBundleAdapter: EntityAdapter<IdentifiedAnnotationState> =
  createEntityAdapter<IdentifiedAnnotationState>({
    selectId: (entity) => entity.bundleId,
  });

export interface LocalBundleCollectionState {
  bundles: EntityState<IdentifiedAnnotationState>;
  selectedBundleId: string;
}

export function resolveLocalBundleState(
  state: LocalBundleCollectionState | undefined,
): AnnotationState | undefined {
  return state?.bundles.entities[state.selectedBundleId];
}
