import { Action, ActionReducer, on } from '@ngrx/store';
import {
  OAnnotJSON,
  OLabel,
  TrattAnnotation,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { getProperties } from '@tratt/utilities';
import { undoRedo } from 'ngrx-wieder';
import { ProjectSettings } from '../../obj';
import { SessionFile } from '../../obj/SessionFile';
import {
  DefaultModeOptions,
  IIDBModeOptions,
} from '../../shared/tratt-database';
import { ApplicationActions } from '../application/application.actions';
import { AuthenticationActions } from '../authentication';
import { IDBActions } from '../idb/idb.actions';
import { LoginMode } from '../index';
import { AnnotationState } from './annotation';
import { AnnotationActions } from './annotation/annotation.actions';
import * as fromAnnotation from './annotation/annotation.reducer';
import { AnnotationStateReducers } from './annotation/annotation.reducer';
import {
  DEFAULT_BUNDLE_ID,
  IdentifiedAnnotationState,
  LocalBundleCollectionState,
  localBundleAdapter,
  resolveLocalBundleState,
} from './annotation/local-bundle-collection';
import { LoginModeActions } from './login-mode.actions';

export const initialState: AnnotationState = {
  ...fromAnnotation.initialState,
  currentSession: {},
};

/**
 * Pure field-mapping helper: writes a single IDB-persisted option (keyed by
 * `attribute`) into the corresponding `AnnotationState` field. Hoisted out of
 * `LoginModeReducers` (it never referenced `this`) so it's callable both from
 * `create()`'s `loadOptions.success` handler and from the plain
 * `wrapAsLocalBundleCollectionReducer` function's `createBundle` case.
 */
function writeOptionToStore(
  state: AnnotationState,
  attribute: string,
  value: any,
): AnnotationState {
  switch (attribute) {
    case 'comment':
      state.currentSession = {
        ...state.currentSession,
        comment: value,
      };
      break;
    case 'project':
      state = {
        ...state,
        previousSession: {
          ...state.previousSession,
          project: {
            id: value?.id as string,
          },
        } as any,
      };
      break;
    case 'transcriptID':
      state = {
        ...state,
        previousSession: {
          ...state.previousSession,
          task: {
            id: value,
          },
        } as any,
      };
      break;
    case 'sessionfile':
      state = {
        ...state,
        sessionFile: SessionFile.fromAny(value),
      };
      break;
    case 'importConverter':
      state = {
        ...state,
        importConverter: value,
      };
      break;
  }

  return state;
}

/**
 * Wraps an `AnnotationState` reducer so its output is stored as the single
 * entity of a `LocalBundleCollectionState`, keyed by `DEFAULT_BUNDLE_ID`.
 * Used only for LOCAL mode; ONLINE/DEMO/URL keep the flat `AnnotationState`.
 */
function wrapAsLocalBundleCollectionReducer(
  innerReducer: ActionReducer<AnnotationState, Action>,
): ActionReducer<LocalBundleCollectionState, Action> {
  const initialInner = innerReducer(undefined, {
    type: '@ngrx/store/init',
  } as Action);
  const initialCollectionState: LocalBundleCollectionState = {
    bundles: localBundleAdapter.setOne(
      { ...initialInner, bundleId: DEFAULT_BUNDLE_ID },
      localBundleAdapter.getInitialState(),
    ),
    selectedBundleId: DEFAULT_BUNDLE_ID,
  };

  return (
    state: LocalBundleCollectionState = initialCollectionState,
    action: Action,
  ): LocalBundleCollectionState => {
    if (action.type === LoginModeActions.createBundle.type) {
      const { bundleId, sessionFile, restoredOptions, restoredAnnotation } =
        action as ReturnType<typeof LoginModeActions.createBundle>;
      let entity: IdentifiedAnnotationState = {
        ...initialInner,
        bundleId,
        sessionFile,
      };
      if (restoredOptions) {
        for (const [name, value] of getProperties(restoredOptions)) {
          entity = {
            ...writeOptionToStore(entity, name, value),
            bundleId,
            sessionFile,
          };
        }
      }
      if (restoredAnnotation) {
        const deserializedAnnotation =
          OAnnotJSON.deserialize(restoredAnnotation);
        if (deserializedAnnotation) {
          entity = {
            ...entity,
            transcript: TrattAnnotation.deserialize(deserializedAnnotation),
          };
        }
      }
      return {
        ...state,
        bundles: localBundleAdapter.addOne(entity, state.bundles),
        selectedBundleId: bundleId,
      };
    }
    if (action.type === LoginModeActions.selectBundle.type) {
      const { bundleId } = action as ReturnType<
        typeof LoginModeActions.selectBundle
      >;
      if (!state.bundles.entities[bundleId]) {
        return state;
      }
      return { ...state, selectedBundleId: bundleId };
    }
    if (action.type === LoginModeActions.setBundleTranscript.type) {
      const { bundleId, transcript } = action as ReturnType<
        typeof LoginModeActions.setBundleTranscript
      >;
      const existing = state.bundles.entities[bundleId];
      if (!existing) {
        return state;
      }
      // Written straight onto the entity, bypassing the undo-wrapped inner
      // reducer on purpose: a pipeline result is a machine-produced
      // document replacement, not a user edit, and pushing it onto that
      // bundle's ngrx-wieder history would let Ctrl+Z "undo" a
      // transcription the user never typed.
      return {
        ...state,
        bundles: localBundleAdapter.setOne(
          { ...existing, transcript },
          state.bundles,
        ),
      };
    }
    if (action.type === LoginModeActions.removeBundles.type) {
      const { bundleIds } = action as ReturnType<
        typeof LoginModeActions.removeBundles
      >;
      const removed = new Set(bundleIds);
      const remainingIds = (state.bundles.ids as string[]).filter(
        (id) => !removed.has(id),
      );
      if (remainingIds.length === 0) {
        // Never leave the collection empty — hasAnyBundles() and the rest
        // of the shell assume at least one entity always exists (the
        // DEFAULT_BUNDLE_ID sentinel this same function seeds on init).
        return {
          ...state,
          bundles: localBundleAdapter.setOne(
            { ...initialInner, bundleId: DEFAULT_BUNDLE_ID },
            localBundleAdapter.removeMany(bundleIds, state.bundles),
          ),
          selectedBundleId: DEFAULT_BUNDLE_ID,
        };
      }
      return {
        ...state,
        bundles: localBundleAdapter.removeMany(bundleIds, state.bundles),
        selectedBundleId: removed.has(state.selectedBundleId)
          ? remainingIds[0]
          : state.selectedBundleId,
      };
    }
    const currentInner = resolveLocalBundleState(state) ?? initialInner;
    const nextInner = innerReducer(currentInner, action);
    if (nextInner === currentInner) {
      return state;
    }
    return {
      ...state,
      bundles: localBundleAdapter.setOne(
        { ...nextInner, bundleId: state.selectedBundleId },
        state.bundles,
      ),
    };
  };
}

// initialize ngrx-wieder with custom config
const { createUndoRedoReducer } = undoRedo({
  allowedActionTypes: [
    AnnotationActions.changeAnnotationLevel.do.type,
    AnnotationActions.addAnnotationLevel.do.type,
    AnnotationActions.addCurrentLevelItems.do.type,
    AnnotationActions.removeAnnotationLevel.do.type,
    AnnotationActions.changeCurrentLevelItems.do.type,
    AnnotationActions.removeCurrentLevelItems.do.type,
    AnnotationActions.changeCurrentItemById.do.type,
    AnnotationActions.combinePhrases.success.type,
  ],
});

export class LoginModeReducers {
  constructor(private mode: LoginMode) {}

  public create():
    | ActionReducer<AnnotationState, Action>
    | ActionReducer<LocalBundleCollectionState, Action> {
    const inner: ActionReducer<AnnotationState, Action> = createUndoRedoReducer(
      initialState,
      ...(new AnnotationStateReducers(this.mode).create() as any),
      on(
        LoginModeActions.clearWholeSession.success,
        (state: AnnotationState, { mode }) => {
          if (this.mode === mode) {
            return {
              ...initialState,
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.clearOnlineSession.do,
        (state: AnnotationState, { mode }) => {
          if (this.mode === mode) {
            return {
              ...initialState,
              currentEditor: state.currentEditor,
              currentSession: {
                currentProject: state.currentSession.currentProject,
              },
            };
          }
          return state;
        },
      ),
      on(
        AuthenticationActions.logout.success,
        LoginModeActions.endTranscription.do,
        (state: AnnotationState, { clearSession, mode }) => {
          return mode === this.mode && clearSession
            ? {
                ...initialState,
                currentSession: {
                  ...initialState.currentSession,
                },
              }
            : {
                ...state,
                savingNeeded: false,
                isSaving: false,
                audio: {
                  fileName: '',
                  sampleRate: 0,
                  loaded: false,
                },
                histories: {},
              };
        },
      ),
      on(
        LoginModeActions.setFeedback,
        (state: AnnotationState, { feedback, mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                assessment: feedback,
              },
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.changeComment.do,
        (state: AnnotationState, { comment, mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                comment,
              },
            };
          }
          return state;
        },
      ),
      on(
        IDBActions.loadOptions.success,
        (
          state: AnnotationState,
          { onlineOptions, demoOptions, localOptions },
        ) => {
          let result = state;

          let options: IIDBModeOptions;
          if (this.mode === LoginMode.ONLINE) {
            options = onlineOptions;
          } else if (this.mode === LoginMode.DEMO) {
            options = demoOptions;
          } else if (this.mode === LoginMode.LOCAL) {
            options = localOptions;
          } else {
            options = DefaultModeOptions;
          }

          for (const [name, value] of getProperties(options)) {
            result = writeOptionToStore(result, name, value);
          }

          return result;
        },
      ),
      on(
        LoginModeActions.loadProjectAndTaskInformation.success,
        (state: AnnotationState, { currentProject, task, mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                currentProject,
                task,
                comment: state.currentSession.comment ?? task?.comment ?? '',
              },
              logging: {
                ...state.logging,
                enabled:
                  (task?.tool_configuration?.value as ProjectSettings)?.logging
                    ?.forced === true
                    ? true
                    : state.logging.enabled,
              },
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.loadProjectAndTaskInformation.do,
        (state: AnnotationState, { mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                loadFromServer: true,
              },
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.startAnnotation.do,
        (state: AnnotationState, { mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              transcript: new TrattAnnotation<TrattAnnotationSegment>(),
              currentSession: {},
            };
          }
          return state;
        },
      ),
      on(
        AuthenticationActions.loginLocal.prepare,
        (
          state: AnnotationState,
          { mode, sessionFile, removeData, files, annotation },
        ) => {
          if (this.mode === mode) {
            if (removeData || annotation) {
              // remove or overwrite data
              if (!annotation) {
                return {
                  ...state,
                  logging: {
                    ...state.logging,
                    startTime: undefined,
                    startReference: undefined,
                    logs: [],
                  },
                  transcript: new TrattAnnotation<TrattAnnotationSegment>(),
                  currentSession: {},
                  sessionFile,
                };
              } else {
                const deserialized = TrattAnnotation.deserialize(annotation);
                return {
                  ...state,
                  logging: {
                    ...state.logging,
                    startTime: undefined,
                    startReference: undefined,
                    logs: [],
                  },
                  transcript: deserialized,
                  currentSession: {},
                  sessionFile,
                };
              }
            } else {
              return {
                ...state,
                currentSession: {},
                sessionFile,
              };
            }
          }
          return state;
        },
      ),
      on(
        LoginModeActions.startAnnotation.success,
        (
          state: AnnotationState,
          {
            task,
            project,
            mode,
            projectSettings,
            guidelines,
            selectedGuidelines,
          },
        ) => {
          if (this.mode === mode) {
            // Normalize empty/whitespace-only segments to the break marker so
            // they display as "Silent transcription units" rather than "Empty".
            const breakMarkerCode = (
              selectedGuidelines as any
            )?.json?.markers?.find((m: any) => m.type === 'break')?.code as
              | string
              | undefined;
            let transcript = state.transcript;
            if (breakMarkerCode && transcript) {
              transcript = transcript.clone();
              for (const level of transcript.levels) {
                if (level instanceof TrattAnnotationSegmentLevel) {
                  for (const item of (
                    level as TrattAnnotationSegmentLevel<TrattAnnotationSegment>
                  ).items) {
                    const idx = item.labels.findIndex(
                      (l) => l.name !== 'Speaker',
                    );
                    if (
                      idx > -1 &&
                      item.labels[idx].value.trim().length === 0
                    ) {
                      item.labels = [
                        ...item.labels.slice(0, idx),
                        new OLabel(item.labels[idx].name, breakMarkerCode),
                        ...item.labels.slice(idx + 1),
                      ];
                    }
                  }
                }
              }
            }

            return {
              ...state,
              transcript,
              projectConfig: projectSettings,
              logging: {
                ...state.logging,
                enabled:
                  projectSettings.logging?.forced === true
                    ? true
                    : state.logging.enabled,
                startTime: Date.now(),
                startReference:
                  state.logging.logs.length > 0
                    ? state.logging.logs[state.logging.logs.length - 1]
                    : undefined,
              },
              currentSession: {
                ...state.currentSession,
                loadFromServer: true,
                currentProject: {
                  ...project,
                  statistics: project.statistics
                    ? {
                        ...project.statistics,
                        tasks:
                          project.statistics?.tasks.map((a) => {
                            if (a.type === 'annotation') {
                              return {
                                ...a,
                                status: {
                                  ...a.status,
                                  free: a.status.free - 1,
                                },
                              };
                            }
                            return a;
                          }) ?? [],
                      }
                    : undefined,
                },
                task,
              },
              guidelines: {
                selected: selectedGuidelines,
                list: guidelines,
              },
              changedTask: task,
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.changeImportOptions.do,
        IDBActions.loadImportOptions.success,
        (state: AnnotationState, { mode, importOptions }) => {
          if (mode === this.mode) {
            return {
              ...state,
              importOptions,
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.setImportConverter.do,
        (state: AnnotationState, { mode, importConverter }) => {
          if (mode === this.mode) {
            return {
              ...state,
              importConverter,
              currentSession: {
                ...state.currentSession,
              },
            };
          }
          return state;
        },
      ),
      on(
        ApplicationActions.setAppLanguage,
        (state: AnnotationState, { language }) => {
          if (state.guidelines?.list && state.guidelines?.list.length > 0) {
            let guideline = state.guidelines.list.find(
              (a) => a.filename === `guidelines_${language}.json`,
            );
            // fallback to english
            guideline =
              guideline ??
              state.guidelines.list.find(
                (a) => a.filename === `guidelines_en.json`,
              );
            // fallback to first language
            guideline = guideline ?? state.guidelines.list[0];

            return {
              ...state,
              guidelines: {
                ...state.guidelines,
                selected: guideline,
              },
            };
          }
          return state;
        },
      ),
    );

    return this.mode === LoginMode.LOCAL
      ? wrapAsLocalBundleCollectionReducer(inner)
      : inner;
  }
}
