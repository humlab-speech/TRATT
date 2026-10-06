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
 * The parts of an `AnnotationState` that describe the SESSION — project,
 * task, project configuration, transcription guidelines and the guideline
 * validation methods — as opposed to one recording's transcript, audio and
 * logs.
 *
 * The login chain (`loadProjectAndTaskInformation` -> `startAnnotation`)
 * writes these into whichever bundle is selected at that moment. Every other
 * bundle must carry the same values: a bundle that wasn't selected then
 * (every file after the first in a multi-file drop, every file dropped later)
 * otherwise opened without guidelines — no markers in the 2D editor's segment
 * popup, an empty overview, no validation.
 */
function sessionScopeChanged(
  before: AnnotationState,
  after: AnnotationState,
): boolean {
  return (
    before.guidelines !== after.guidelines ||
    before.projectConfig !== after.projectConfig ||
    before.methods !== after.methods ||
    before.currentSession?.currentProject !==
      after.currentSession?.currentProject ||
    before.currentSession?.task !== after.currentSession?.task
  );
}

function hasSessionScope(state: AnnotationState | undefined): boolean {
  return !!(state?.guidelines || state?.projectConfig);
}

/**
 * Where the session's scope currently lives: the selected bundle when it has
 * it, otherwise any bundle that does. The selected bundle can legitimately
 * lack it — e.g. the empty placeholder bundle the collection falls back to
 * once every file was removed — and copying from it alone handed every file
 * dropped afterwards no guidelines and no project config.
 */
function sessionScopeSource(
  state: LocalBundleCollectionState,
): AnnotationState | undefined {
  const selected = resolveLocalBundleState(state);
  if (hasSessionScope(selected)) {
    return selected;
  }
  return (state.bundles.ids as string[])
    .map((id) => state.bundles.entities[id])
    .find((entity) => hasSessionScope(entity));
}

function withSessionScopeOf<T extends AnnotationState>(
  target: T,
  source: AnnotationState,
): T {
  return {
    ...target,
    guidelines: source.guidelines,
    projectConfig: source.projectConfig,
    methods: source.methods,
    currentSession: {
      ...target.currentSession,
      currentProject: source.currentSession?.currentProject,
      task: source.currentSession?.task,
    },
  };
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
      const {
        bundleId,
        sessionFile,
        restoredOptions,
        restoredAnnotation,
        selectAfterCreate = true,
        audioLoaded = false,
      } = action as ReturnType<typeof LoginModeActions.createBundle>;
      let entity: IdentifiedAnnotationState = {
        ...initialInner,
        bundleId,
        sessionFile,
        // Per-recording, but only ever set by loadAudio.success for the
        // bundle selected during the login chain; without it IDB saves of
        // this bundle's annotation were written with an empty media name.
        audio: {
          ...initialInner.audio,
          fileName: sessionFile?.name ?? initialInner.audio.fileName,
          loaded: audioLoaded || initialInner.audio.loaded,
        },
      };
      // A bundle created into a running session joins that session.
      const sessionSource = sessionScopeSource(state);
      if (sessionSource) {
        entity = withSessionScopeOf(entity, sessionSource);
      }
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
          const transcript = TrattAnnotation.deserialize(
            deserializedAnnotation,
          );
          // deserialize() selects no level; editors render the current one.
          if (
            transcript.levels.length > 0 &&
            transcript.selectedLevelIndex === undefined
          ) {
            transcript.changeCurrentLevelIndex(0);
          }
          entity = { ...entity, transcript };
        }
      }
      return {
        ...state,
        bundles: localBundleAdapter.addOne(entity, state.bundles),
        selectedBundleId: selectAfterCreate ? bundleId : state.selectedBundleId,
      };
    }
    if (action.type === LoginModeActions.selectBundle.type) {
      const { bundleId } = action as ReturnType<
        typeof LoginModeActions.selectBundle
      >;
      const target = state.bundles.entities[bundleId];
      if (!target) {
        return state;
      }
      // Self-heal a bundle that missed the session scope (created before
      // this reducer shared it, or restored from IndexedDB and selected
      // before any login chain ran): without guidelines the text editors
      // and the overview render nothing and the segment popup throws.
      const sessionSource = hasSessionScope(target)
        ? undefined
        : sessionScopeSource(state);
      return {
        ...state,
        bundles: sessionSource
          ? localBundleAdapter.setOne(
              withSessionScopeOf(target, sessionSource),
              state.bundles,
            )
          : state.bundles,
        selectedBundleId: bundleId,
      };
    }
    if (action.type === LoginModeActions.bundleAudioAttached.type) {
      const { bundleId } = action as ReturnType<
        typeof LoginModeActions.bundleAudioAttached
      >;
      const existing = state.bundles.entities[bundleId];
      if (!existing || existing.audio.loaded) {
        return state;
      }
      return {
        ...state,
        bundles: localBundleAdapter.setOne(
          { ...existing, audio: { ...existing.audio, loaded: true } },
          state.bundles,
        ),
      };
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
        // The session itself is still running, so the sentinel keeps its
        // scope: files dropped next are created from it.
        const sessionSource = sessionScopeSource(state);
        const sentinel: IdentifiedAnnotationState = {
          ...initialInner,
          bundleId: DEFAULT_BUNDLE_ID,
        };
        return {
          ...state,
          bundles: localBundleAdapter.setOne(
            sessionSource
              ? withSessionScopeOf(sentinel, sessionSource)
              : sentinel,
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
    let bundles = localBundleAdapter.setOne(
      { ...nextInner, bundleId: state.selectedBundleId },
      state.bundles,
    );
    if (sessionScopeChanged(currentInner, nextInner)) {
      // Session-wide data changed on the selected bundle: share it with
      // every other bundle (see sessionScopeChanged()).
      const others = (bundles.ids as string[])
        .filter((id) => id !== state.selectedBundleId)
        .map((id) => bundles.entities[id])
        .filter((e): e is IdentifiedAnnotationState => e !== undefined)
        .map((e) => withSessionScopeOf(e, nextInner));
      bundles = localBundleAdapter.setMany(others, bundles);
    }
    return { ...state, bundles };
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
