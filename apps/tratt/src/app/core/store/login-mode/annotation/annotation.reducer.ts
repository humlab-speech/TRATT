import { ActionCreator, on, ReducerTypes } from '@ngrx/store';
import {
  AnnotationLevelType,
  ASRContext,
  OLabel,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { getProperties } from '@tratt/utilities';
import { IIDBModeOptions } from '../../../shared/tratt-database';
import { AuthenticationActions } from '../../authentication';
import { IDBActions } from '../../idb/idb.actions';
import { LoginMode } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';
import { AnnotationState } from './index';

export const initialState: AnnotationState = {
  transcript: new TrattAnnotation<
    ASRContext,
    TrattAnnotationSegment<ASRContext>
  >(),
  savingNeeded: false,
  isSaving: false,
  additionalSpeakerIds: [],
  audio: {
    loaded: false,
    sampleRate: 0,
    fileName: '',
  },
  logging: {
    enabled: false,
    logs: [],
  },
  currentSession: {},
  histories: {},
};

export class AnnotationStateReducers {
  constructor(private mode: LoginMode) {}

  create<T>(): ReducerTypes<AnnotationState, ActionCreator[]>[] {
    return [
      on(
        AnnotationActions.clearAnnotation.do,
        (state: AnnotationState, { mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              transcript: initialState.transcript,
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.overwriteTranscript.do,
        (state: AnnotationState, { transcript, mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              transcript,
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.initTranscriptionService.success,
        (state: AnnotationState, { transcript, mode, feedback }) => {
          if (this.mode === mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                feedback,
              },
              transcript,
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.addMultipleASRSegments.success,
        (state, { mode, newSegments, segmentID }) => {
          if (this.mode === mode) {
            // 1. unblock current segment
            let transcript = state.transcript.clone();
            const currentSegment = transcript
              .currentLevel!.items.find((a) => a.id === segmentID)!
              .clone() as TrattAnnotationSegment;
            currentSegment.context = {
              ...currentSegment.context,
              asr: {
                progressInfo: undefined,
                isBlockedBy: undefined,
              },
            };
            transcript = transcript.changeCurrentItemById(
              segmentID,
              currentSegment,
            );

            // 2. ignore last segment from results
            const segments = newSegments.filter(
              (a, i) => i < newSegments.length - 1,
            );

            // 3. add new segments
            for (const segment of segments) {
              transcript = transcript.addItemToCurrentLevel(
                segment.time,
                segment.labels,
                {
                  asr: {
                    progressInfo: undefined,
                    isBlockedBy: undefined,
                  },
                },
              );
            }

            state.transcript = transcript;
          }
          return state;
        },
      ),
      on(AnnotationActions.loadAudio.do, (state: AnnotationState, { mode }) => {
        if (this.mode === mode) {
          return {
            ...state,
            audio: {
              ...state.audio,
              loaded: false,
            },
          };
        }
        return state;
      }),
      on(
        AnnotationActions.loadAudio.success,
        (state: AnnotationState, { mode, audioFile }) => {
          if (this.mode === mode) {
            return {
              ...state,
              audio: {
                ...state.audio,
                loaded: true,
                sampleRate: audioFile?.metadata?.sampleRate ?? 0,
                fileName: audioFile!.filename,
                file: audioFile,
              },
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.changeAnnotationLevel.do,
        (state: AnnotationState, { level, mode }) => {
          if (this.mode === mode) {
            const annotationLevels = state.transcript.levels;
            const index = annotationLevels.findIndex((a) => a.id === level.id);

            if (index > -1 && index < annotationLevels.length) {
              return {
                ...state,
                transcript: state.transcript.changeLevelByIndex(index, level),
              };
            } else {
              console.error(`can't change level because index not valid.`);
            }
          }

          return state;
        },
      ),
      on(
        AuthenticationActions.loginURL.success,
        (state: AnnotationState, { mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              currentEditor: '2D-Editor',
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.combinePhrases.success,
        (state: AnnotationState, { transcript, mode }) => {
          if (this.mode === mode) {
            state.transcript = transcript;
          }

          return state;
        },
      ),
      on(
        AnnotationActions.changeLevelName.do,
        (state: AnnotationState, { index, mode, name }) => {
          if (mode === this.mode) {
            const transcript = state.transcript.clone();
            transcript.changeLevelNameByIndex(index, name);
            state.transcript = transcript;
          }

          return state;
        },
      ),
      on(
        AnnotationActions.addAnnotationLevel.do,
        (state: AnnotationState, { levelType, mode, audioDuration }) => {
          if (this.mode === mode) {
            const transcript = state.transcript.clone();
            let level:
              | TrattAnnotationAnyLevel<TrattAnnotationSegment<ASRContext>>
              | undefined = undefined;

            if (levelType === AnnotationLevelType.SEGMENT) {
              level = transcript.createSegmentLevel(
                `OCTRA_${transcript.idCounters.level + 1}`,
                [
                  transcript.createSegment(audioDuration.clone(), [
                    new OLabel(`OCTRA_${transcript.idCounters.level + 1}`, ''),
                    new OLabel(`Speaker`, ''),
                  ]),
                ],
              );
            } else {
              console.error(`Can't add other level types. not supported.`);
            }

            if (level) {
              return {
                ...state,
                transcript: transcript.addLevel(level),
              };
            }
          }
          return state;
        },
      ),
      on(
        AnnotationActions.addTranslatedLevel.do,
        (
          state: AnnotationState,
          { sourceLevelId, targetLanguageLabel, mode },
        ) => {
          if (this.mode !== mode) {
            return state;
          }
          const transcript = state.transcript.clone();
          const source = transcript.levels.find((l) => l.id === sourceLevelId);
          if (!(source instanceof TrattAnnotationSegmentLevel)) {
            console.warn(
              `addTranslatedLevel: source level ${sourceLevelId} is not a segment level.`,
            );
            return state;
          }
          if (source.linkedToLevelId !== undefined) {
            console.warn(
              `addTranslatedLevel: source level "${source.name}" is itself linked. Pick the original source instead.`,
            );
            return state;
          }

          const usedNames = new Set(transcript.levels.map((l) => l.name));
          let uniqueName = targetLanguageLabel;
          let counter = 2;
          while (usedNames.has(uniqueName)) {
            uniqueName = `${targetLanguageLabel} (${counter++})`;
          }

          const targetItems = source.items.map((item) => {
            const cloned = (item as TrattAnnotationSegment).clone(
              transcript.idCounters.item++,
            );
            const speakerLabel = item.labels.find((l) => l.name === 'Speaker');
            cloned.labels = [
              new OLabel(uniqueName, ''),
              ...(speakerLabel
                ? [new OLabel('Speaker', speakerLabel.value)]
                : []),
            ];
            return cloned;
          });

          const targetLevel = new TrattAnnotationSegmentLevel<
            TrattAnnotationSegment<ASRContext>
          >(
            transcript.idCounters.level++,
            uniqueName,
            targetItems as any,
            source.id,
            'translation',
          );
          transcript.addLevel(targetLevel as any);
          return { ...state, transcript };
        },
      ),
      on(
        AnnotationActions.applyTranslationToLinkedLevel.do,
        (state: AnnotationState, { linkedLevelId, translated, mode }) => {
          if (this.mode !== mode) {
            return state;
          }
          const transcript = state.transcript.clone();
          const level = transcript.levels.find((l) => l.id === linkedLevelId);
          if (
            !(level instanceof TrattAnnotationSegmentLevel) ||
            level.linkedToLevelId === undefined
          ) {
            console.warn(
              `applyTranslationToLinkedLevel: level ${linkedLevelId} is not a linked translation tier.`,
            );
            return state;
          }

          const updatedItems = level.items.map((item, idx) => {
            const tr = translated.find((t) => t.id === idx);
            if (!tr || !tr.text || !tr.text.trim()) {
              return item;
            }

            // Find the primary translation label — the one whose name matches
            // the level name (mirrors local-translation.service.ts:351-358).
            // Fall back to the first non-Speaker label.
            const primaryIdx = item.labels.findIndex(
              (l) => l.name === level.name,
            );
            const targetIdx =
              primaryIdx >= 0
                ? primaryIdx
                : item.labels.findIndex((l) => l.name !== 'Speaker');

            if (targetIdx < 0) {
              const cloned = (item as TrattAnnotationSegment).clone();
              cloned.labels = [new OLabel(level.name, tr.text), ...item.labels];
              return cloned;
            }

            const existing = item.labels[targetIdx];
            if (existing.value && existing.value.trim().length > 0) {
              // Only-fill-empty policy: preserve manual edits.
              return item;
            }
            const cloned = (item as TrattAnnotationSegment).clone();
            cloned.labels = [
              ...item.labels.slice(0, targetIdx),
              new OLabel(existing.name, tr.text),
              ...item.labels.slice(targetIdx + 1),
            ];
            return cloned;
          });

          level.overwriteItems(updatedItems as any);
          return { ...state, transcript };
        },
      ),
      on(
        AnnotationActions.detachLinkedLevel.do,
        (state: AnnotationState, { id, mode }) => {
          if (this.mode === mode) {
            const transcript = state.transcript.clone();
            const level = transcript.levels.find((l) => l.id === id);
            if (level && 'linkedToLevelId' in level) {
              (level as any).linkedToLevelId = undefined;
              (level as any).linkedKind = undefined;
              return { ...state, transcript };
            }
          }
          return state;
        },
      ),
      on(
        AnnotationActions.removeAnnotationLevel.do,
        (state: AnnotationState, { id, mode }) => {
          if (this.mode === mode) {
            if (id > -1) {
              return {
                ...state,
                transcript: state.transcript.clone().removeLevel(id),
              };
            } else {
              console.error(`can't remove level because id not valid.`);
            }
          }

          return state;
        },
      ),
      on(
        IDBActions.loadAnnotation.success,
        (state: AnnotationState, annotations) => {
          return {
            ...state,
            transcript: (annotations as any)[this.mode],
          };
        },
      ),
      on(
        AnnotationActions.setSavingNeeded.do,
        (state: AnnotationState, { savingNeeded }) => ({
          ...state,
          savingNeeded,
        }),
      ),
      on(
        AnnotationActions.changeCurrentLevelItems.do,
        (state: AnnotationState, { items, mode }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              for (const item of items) {
                const index = state.transcript.currentLevel?.items.findIndex(
                  (a) => a.id === item.id,
                );
                if (index !== undefined && index > -1) {
                  state.transcript = state.transcript
                    .clone()
                    .changeCurrentItemByIndex(index, item);
                } else {
                  // add item
                  state.transcript = state.transcript
                    .clone()
                    .addItemToCurrentLevel(
                      (item as any).time,
                      item.labels,
                      (item as any).context,
                    );
                }
              }
            }
          }

          return state;
        },
      ),
      on(
        AnnotationActions.addCurrentLevelItems.do,
        (state: AnnotationState, { items, mode }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              for (const item of items) {
                state.transcript = state.transcript
                  .clone()
                  .addItemToCurrentLevel(
                    (item as any).time,
                    item.labels,
                    (item as any).context,
                  );
              }
            }
          }

          return state;
        },
      ),
      on(
        AnnotationActions.removeCurrentLevelItems.do,
        (state: AnnotationState, { items, mode, removeOptions }) => {
          if (this.mode === mode) {
            const currentLevel = state.transcript.currentLevel;

            if (currentLevel) {
              for (const item of items) {
                if (item.id !== undefined && item.id !== null) {
                  state.transcript = state.transcript
                    .clone()
                    .removeItemById(
                      item.id,
                      removeOptions?.silenceCode,
                      removeOptions?.mergeTranscripts,
                      (transcript: string) => {
                        if (!state.guidelines?.selected?.json) {
                          return transcript;
                        }
                        return tidyUpAnnotation(
                          transcript,
                          state.guidelines.selected.json,
                        );
                      },
                    );
                } else if (item.index !== undefined && item.index !== null) {
                  state.transcript = state.transcript
                    .clone()
                    .removeItemByIndex(
                      item.index,
                      removeOptions?.silenceCode,
                      removeOptions?.mergeTranscripts,
                      (transcript: string) => {
                        if (!state.guidelines?.selected?.json) {
                          return transcript;
                        }
                        return tidyUpAnnotation(
                          transcript,
                          state.guidelines.selected.json,
                        );
                      },
                    );
                } else {
                  console.error(
                    `removeCurrentLevelItems: Can't remove item, missing index or ID.`,
                  );
                }
              }
            }
          }

          return state;
        },
      ),
      on(
        AnnotationActions.changeCurrentItemById.do,
        (state: AnnotationState, { id, item, mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              transcript: state.transcript
                .clone()
                .changeCurrentItemById(id, item),
            };
          }

          return state;
        },
      ),
      on(
        AnnotationActions.setIsSaving.do,
        (state: AnnotationState, { isSaving }) => ({
          ...state,
          isSaving,
        }),
      ),
      on(
        AnnotationActions.setCurrentEditor.do,
        (state: AnnotationState, { currentEditor }) => ({
          ...state,
          currentEditor,
        }),
      ),

      on(
        AnnotationActions.addLog.do,
        (state: AnnotationState, { log, mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              logging: {
                ...state.logging,
                logs: !Array.isArray(state.logging.logs)
                  ? [log]
                  : [...state.logging.logs, log],
              },
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.saveLogs.do,
        (state: AnnotationState, { logs, mode }) => {
          if (this.mode === mode) {
            return {
              ...state,
              logging: {
                ...state.logging,
                logs,
              },
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.setLogging.do,
        (state: AnnotationState, { logging }) => ({
          ...state,
          logging: {
            ...state.logging,
            enabled: logging,
            startTime: Date.now(),
            startReference:
              state.logging.logs.length > 0
                ? state.logging.logs[state.logging.logs.length - 1]
                : undefined,
          },
        }),
      ),
      on(
        AnnotationActions.setLevelIndex.do,
        (state: AnnotationState, { currentLevelIndex, mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              transcript: state.transcript
                .clone()
                .changeLevelIndex(currentLevelIndex),
            };
          }
          return state;
        },
      ),
      on(
        LoginModeActions.loadProjectAndTaskInformation.success,
        (state: AnnotationState, { currentProject, task, mode }) => {
          if (mode === this.mode) {
            return {
              ...state,
              currentSession: {
                ...state.currentSession,
                task,
                currentProject,
              },
            };
          }
          return state;
        },
      ),
      on(AnnotationActions.clearLogs.do, (state) => ({
        ...state,
        logging: {
          ...state.logging,
          logs: [],
        },
      })),
      on(AnnotationActions.startNewAnnotation.do, (state, { mode }) => {
        if (mode === this.mode) {
          console.log(`startNewAnnotation for mode ${mode}`);
          // Reset the transcript to a new empty annotation
          return {
            ...state,
            transcript: new TrattAnnotation<
              ASRContext,
              TrattAnnotationSegment<ASRContext>
            >(),
          };
        }
        return state;
      }),
      on(IDBActions.loadLogs.success, (state: AnnotationState, logs) => {
        return {
          ...state,
          logging: {
            ...state.logging,
            logs: (logs as any)[this.mode],
          },
        };
      }),
      on(
        AnnotationActions.updateASRSegmentInformation.do,
        (
          state: AnnotationState,
          { mode, timeInterval, progress, isBlockedBy, itemType, result },
        ) => {
          const currentLevel = state.transcript.currentLevel;
          if (
            this.mode === mode &&
            currentLevel instanceof TrattAnnotationSegmentLevel
          ) {
            const segmentBoundary = new SampleUnit(
              timeInterval.sampleStart + timeInterval.sampleLength / 2,
              state.audio.sampleRate,
            );
            const segmentIndex =
              state.transcript.getCurrentSegmentIndexBySamplePosition(
                segmentBoundary,
              );

            if (segmentIndex > -1) {
              const segment = (
                currentLevel as TrattAnnotationSegmentLevel<TrattAnnotationSegment>
              ).level.items[segmentIndex];

              return {
                ...state,
                transcript: state.transcript.clone().changeCurrentItemByIndex(
                  segmentIndex,
                  TrattAnnotationSegment.deserialize<ASRContext>({
                    ...segment.clone(segment.id),
                    id: segment.id,
                    labels: result
                      ? segment.labels.map((a: OLabel) =>
                          a.name !== 'Speaker' ? new OLabel(a.name, result) : a,
                        )
                      : segment.labels,
                    context: {
                      asr: {
                        progressInfo: {
                          progress,
                          statusLabel: itemType,
                        },
                        isBlockedBy,
                      },
                    },
                  }),
                ),
              };
            } else {
              console.error(`item not found`);
            }
            return state;
          }
          return state;
        },
      ),
      on(
        IDBActions.loadOptions.success,
        (
          state: AnnotationState,
          { demoOptions, localOptions, onlineOptions },
        ) => {
          let result = state;

          let options: IIDBModeOptions;
          if (this.mode === LoginMode.DEMO) {
            options = demoOptions;
          } else if (this.mode === LoginMode.ONLINE) {
            options = onlineOptions;
          } else if (this.mode === LoginMode.LOCAL) {
            options = localOptions;
          }

          for (const [name, value] of getProperties(options!)) {
            result = this.writeOptionToStore(result, name, value);
          }

          return result;
        },
      ),
      on(
        AnnotationActions.sendOnlineAnnotation.do,
        (state: AnnotationState, { mode }) => {
          if (mode === this.mode) {
            state.currentSession = {
              ...state.currentSession,
              status: 'sending',
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.sendOnlineAnnotation.fail,
        AnnotationActions.sendOnlineAnnotation.success,
        (state: AnnotationState, { mode }) => {
          if (mode === this.mode) {
            state.currentSession = {
              ...state.currentSession,
              status: 'processing',
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.duplicateLevel.do,
        (state: AnnotationState, { mode, index }) => {
          if (mode === this.mode) {
            state.transcript = state.transcript.clone().duplicateLevel(index);
          }
          return state;
        },
      ),
      on(
        AnnotationActions.addSpeakerId.do,
        (state: AnnotationState, { mode, id }) => {
          if (mode === this.mode && !state.additionalSpeakerIds.includes(id)) {
            return {
              ...state,
              additionalSpeakerIds: [...state.additionalSpeakerIds, id],
            };
          }
          return state;
        },
      ),
      on(
        AnnotationActions.removeSpeakerId.do,
        (state: AnnotationState, { mode, id }) => {
          if (mode === this.mode) {
            return {
              ...state,
              additionalSpeakerIds: state.additionalSpeakerIds.filter(
                (s) => s !== id,
              ),
            };
          }
          return state;
        },
      ),
    ];
  }

  writeOptionToStore(
    state: AnnotationState,
    attribute: string,
    value: any,
  ): AnnotationState {
    switch (attribute) {
      case 'currentEditor':
        return {
          ...state,
          currentEditor: value ?? '2D-Editor',
        };
      case 'currentLevel':
        return {
          ...state,
          previousCurrentLevel: value,
        };
      case 'logging':
        return {
          ...state,
          logging: {
            ...state.logging,
            enabled: value === true,
          },
        };
      case 'additionalSpeakerIds':
        return {
          ...state,
          additionalSpeakerIds: Array.isArray(value) ? value : [],
        };
    }

    return state;
  }
}
