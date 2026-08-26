import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  ISegment,
  OLabel,
  PraatTextgridConverter,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { exhaustMap, of, tap, withLatestFrom } from 'rxjs';
import { AlertService, AudioService } from '../../../shared/service';
import { getModeState, RootState } from '../../index';
import { ASRQueueItemType } from '../../asr';
import { AnnotationActions } from './annotation.actions';

@Injectable()
export class AnnotationToolsEffects {
  combinePhrases$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.combinePhrases.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        const modeState = getModeState(state)!;

        if (
          modeState.transcript.currentLevel &&
          modeState.transcript.currentLevel.type === 'SEGMENT'
        ) {
          let transcript = modeState.transcript.clone();
          let currentLevel: TrattAnnotationSegmentLevel<TrattAnnotationSegment> =
            modeState.transcript.currentLevel.clone() as TrattAnnotationSegmentLevel<TrattAnnotationSegment>;
          const breakMarker =
            modeState.guidelines?.selected?.json?.markers?.find(
              (a) => a.type === 'break',
            );

          const maxWords = action.options.maxWordsPerSegment;
          const minSilenceLength = action.options.minSilenceLength;
          const isSilence = (segment: TrattAnnotationSegment) => {
            return (
              segment.getFirstLabelWithoutName('Speaker')?.value.trim() ===
                '' ||
              segment.getFirstLabelWithoutName('Speaker')?.value.trim() ===
                breakMarker?.code ||
              segment.getFirstLabelWithoutName('Speaker')?.value.trim() ===
                '<p:>' ||
              segment.getFirstLabelWithoutName('Speaker')?.value.trim() ===
                breakMarker?.code
            );
          };

          const countWords = (text: string) => {
            return text.trim().split(' ').length;
          };

          let wordCounter = 0;

          for (let i = 0; i < currentLevel.items.length; i++) {
            const segment = currentLevel.items[i];

            let startPos = 0;
            if (i > 0) {
              startPos = currentLevel.items[i - 1].time.unix;
            }
            let duration = segment.time.unix - startPos;
            if (!isSilence(segment) || duration < minSilenceLength) {
              if (maxWords > 0 && wordCounter >= maxWords) {
                wordCounter = isSilence(segment)
                  ? 0
                  : countWords(
                      segment.getFirstLabelWithoutName('Speaker')?.value ?? '',
                    );
              } else {
                if (i > 0) {
                  const lastSegment = currentLevel.items[i - 1];
                  startPos = 0;
                  if (i > 1) {
                    startPos = currentLevel.items[i - 2].time.unix;
                  }
                  duration = lastSegment.time.unix - startPos;
                  if (!isSilence(lastSegment) || duration < minSilenceLength) {
                    let lastSegmentText =
                      lastSegment.getFirstLabelWithoutName('Speaker')?.value;
                    let segmentText =
                      segment.getFirstLabelWithoutName('Speaker')?.value;

                    if (isSilence(lastSegment)) {
                      lastSegmentText = '';
                    }

                    if (!isSilence(segment)) {
                      segment.changeFirstLabelWithoutName(
                        'Speaker',
                        `${lastSegmentText} ${segmentText}`,
                      );
                      wordCounter = countWords(
                        `${lastSegmentText} ${segmentText}`,
                      );
                    } else {
                      segmentText = '';
                      segment.changeFirstLabelWithoutName(
                        'Speaker',
                        `${lastSegmentText}`,
                      );
                    }
                    transcript = transcript!.removeItemByIndex(
                      i - 1,
                      '',
                      false,
                      (transcript: string) => {
                        const guidelinesJson =
                          modeState.guidelines?.selected?.json;
                        if (!guidelinesJson) {
                          return transcript;
                        }
                        return tidyUpAnnotation(transcript, guidelinesJson);
                      },
                    );
                    currentLevel = transcript.currentLevel as any;
                    i--;
                  }
                }
              }
            }
          }
          return of(
            AnnotationActions.combinePhrases.success({
              mode: state.application.mode!,
              transcript,
            }),
          );
        }
        return of(
          AnnotationActions.combinePhrases.fail({
            error:
              "Can't combine phrases: current level must be of type SEGMENT.",
          }),
        );
      }),
    ),
  );

  combinePhrasesSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.combinePhrases.success),
        withLatestFrom(this.store),
        tap(() => {
          this.alertService.showAlert(
            'success',
            this.transloco.translate('tools.alerts.done', {
              value: 'Combine Phrases',
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  combinePhrasesFailed$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(AnnotationActions.combinePhrases.fail),
        tap((action) => {
          this.alertService.showAlert(
            'danger',
            this.transloco.translate('tools.alerts.fail', {
              value: 'Combine Phrases',
              error: action.error,
            }),
          );
        }),
      ),
    { dispatch: false },
  );

  asrRunWordAlignmentSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AnnotationActions.updateASRSegmentInformation.do),
      withLatestFrom(this.store),
      exhaustMap(([action, state]) => {
        if (
          (action.itemType === ASRQueueItemType.ASRMAUS ||
            action.itemType === ASRQueueItemType.MAUS) &&
          action.result
        ) {
          const segmentBoundary = new SampleUnit(
            action.timeInterval.sampleStart +
              action.timeInterval.sampleLength / 2,
            getModeState(state)!.audio.sampleRate!,
          );
          const segmentIndex =
            getModeState(
              state,
            )!.transcript.getCurrentSegmentIndexBySamplePosition(
              segmentBoundary,
            );

          const converter = new PraatTextgridConverter();
          const audioManager = this.audio.audioManager;
          const audiofile = audioManager.resource.getOAudioFile();
          audiofile.name = `OCTRA_ASRqueueItem_${segmentIndex}.wav`;

          if (action.result) {
            const convertedResult = converter.import(
              {
                name: `OCTRA_ASRqueueItem_${segmentIndex}.TextGrid`,
                content: action.result,
                type: 'text',
                encoding: 'utf-8',
              },
              audiofile,
            );

            if (convertedResult?.annotjson) {
              const wordsTier = convertedResult.annotjson.levels.find(
                (a: any) => {
                  return a.name === 'ORT-MAU';
                },
              );

              if (wordsTier !== undefined) {
                let counter = 0;

                if (segmentIndex < 0) {
                  return of(
                    AnnotationActions.addMultipleASRSegments.fail({
                      error: `could not find segment to be precessed by ASRMAUS!`,
                    }),
                  );
                } else {
                  const segmentID =
                    getModeState(state)!.transcript.currentLevel!.items[
                      segmentIndex
                    ].id;
                  const newSegments: TrattAnnotationSegment[] = [];

                  let itemCounter =
                    getModeState(state)?.transcript.idCounters.item ?? 1;

                  for (const wordItem of wordsTier.items as ISegment[]) {
                    const itemEnd =
                      action.timeInterval.sampleStart +
                      action.timeInterval.sampleLength;
                    let wordItemEnd =
                      action.timeInterval.sampleStart +
                      Math.ceil(wordItem.sampleStart + wordItem.sampleDur);
                    wordItemEnd = Math.min(itemEnd, wordItemEnd);

                    if (wordItemEnd >= action.timeInterval.sampleStart) {
                      const readSegment = new TrattAnnotationSegment(
                        itemCounter++,
                        new SampleUnit(
                          wordItemEnd,
                          this.audio.audioManager.resource.info.sampleRate,
                        ),
                        wordItem.labels.map((a) =>
                          OLabel.deserialize({
                            ...a,
                            name:
                              a.name === 'ORT-MAU'
                                ? getModeState(state)!.transcript!.currentLevel!
                                    .name!
                                : a.name,
                          }),
                        ),
                      );

                      const labelIndex = readSegment.labels.findIndex(
                        (a) => a.value === '<p:>' || a.value === '',
                      );

                      if (labelIndex > -1) {
                        readSegment.labels[labelIndex].value =
                          getModeState(
                            state,
                          )!.guidelines?.selected?.json.markers.find(
                            (a) => a.type === 'break',
                          )?.code ?? '';
                      }

                      newSegments.push(readSegment);
                      // the last segment is the original segment
                    } else {
                      // tslint:disable-next-line:max-line-length
                      console.error(
                        `Invalid word item boundary:! ${wordItemEnd} <= ${action.timeInterval.sampleStart}`,
                      );
                      return of(
                        AnnotationActions.addMultipleASRSegments.fail({
                          error: `wordItem samples are out of the correct boundaries.`,
                        }),
                      );
                    }
                    counter++;
                  }
                  return of(
                    AnnotationActions.addMultipleASRSegments.success({
                      mode: state.application.mode!,
                      segmentID,
                      newSegments,
                    }),
                  );
                }
              } else {
                return of(
                  AnnotationActions.addMultipleASRSegments.fail({
                    error: 'word tier not found!',
                  }),
                );
              }
            } else {
              return of(
                AnnotationActions.addMultipleASRSegments.fail({
                  error: 'importresult ist undefined',
                }),
              );
            }
          } else {
            return of(
              AnnotationActions.addMultipleASRSegments.fail({
                error: 'Result is undefined',
              }),
            );
          }
        }
        return of();
      }),
    ),
  );

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private alertService: AlertService,
    private audio: AudioService,
    private transloco: TranslocoService,
  ) {}
}
