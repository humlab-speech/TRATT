import { AuthDtoMe } from '@octra/api-types';
import { IIDBModeOptions } from '../../shared/tratt-database';
import { AnnotationState } from '../login-mode/annotation';
import { BundleRunState } from '../pipeline-queue';

/**
 * The single definition of "what a persisted mode-options row contains",
 * hoisted out of `IDBEffects.savemodeOptions$` so the pipeline-queue's own
 * persistence effect writes the IDENTICAL field set for a bundle that isn't
 * the selected one.
 *
 * This shared definition is load-bearing, not tidiness: `TrattDatabase.
 * saveModeData()`'s LOCAL branch does `bundles.update([bundleId, name],
 * { value: prepared })` — it REPLACES the stored value object rather than
 * merging into it. Two writers with two different field sets would silently
 * erase each other's fields (a `{runState}`-only write would wipe
 * `sessionfile` and break bundle restore; an options write with no
 * `runState` would wipe a finished run's `'done'`). Both writers therefore
 * build the whole object here, and both pass the CURRENT `runState` from the
 * pipelineQueue slice.
 */
export function buildModeOptions(
  modeState: AnnotationState,
  me: AuthDtoMe | undefined,
  runState: BundleRunState | undefined,
): IIDBModeOptions {
  return {
    sessionfile:
      modeState?.sessionFile && Object.keys(modeState.sessionFile).length > 0
        ? modeState.sessionFile.toAny()
        : null,
    importConverter: modeState.importConverter,
    currentEditor: modeState.currentEditor ?? null,
    currentLevel: modeState.transcript?.selectedLevelIndex ?? null,
    logging: modeState.logging.enabled ?? null,
    project: modeState.currentSession?.loadFromServer
      ? (modeState.currentSession?.currentProject ?? null)
      : undefined,
    transcriptID: modeState.currentSession?.loadFromServer
      ? (modeState.currentSession?.task?.id ?? null)
      : undefined,
    feedback: modeState.currentSession?.assessment ?? null,
    comment: modeState.currentSession?.comment ?? null,
    additionalSpeakerIds: modeState.additionalSpeakerIds?.length
      ? modeState.additionalSpeakerIds
      : null,
    user: me
      ? {
          id: me.id,
          name: me.username,
          email: me.email,
        }
      : undefined,
    ...(runState !== undefined ? { runState } : {}),
  };
}
