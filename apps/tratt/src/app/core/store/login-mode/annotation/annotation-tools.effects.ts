import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { exhaustMap, of, tap, withLatestFrom } from 'rxjs';
import { AlertService } from '../../../shared/service';
import { getModeState, RootState } from '../../index';
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

  constructor(
    private actions$: Actions,
    private store: Store<RootState>,
    private alertService: AlertService,
    private transloco: TranslocoService,
  ) {}
}
