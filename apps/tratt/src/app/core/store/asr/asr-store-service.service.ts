import { Injectable, effect } from '@angular/core';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { RootState } from '../index';
import { ASRActions } from './asr.actions';
import {
  selectASREnabled,
  selectASRLanguageSettings,
  selectASRLanguages,
  selectASRQueue,
  selectASRSettings,
  selectMausLanguages,
} from './asr.selectors';
import { ASRQueueItemType, ASRStateSettings, ASRTimeInterval } from './index';

@Injectable({
  providedIn: 'root',
})
export class AsrStoreService {
  asrOptionsSignal = this.store.selectSignal(selectASRSettings);
  queueSignal = this.store.selectSignal(selectASRQueue);
  languageSettingsSignal = this.store.selectSignal(selectASRLanguageSettings);
  mausLanguagesSignal = this.store.selectSignal(selectMausLanguages);
  asrLanguagesSignal = this.store.selectSignal(selectASRLanguages);
  asrEnabledSignal = this.store.selectSignal(selectASREnabled);

  // Cached values for backward compatibility
  private _asrOptions: ASRStateSettings | undefined;
  private _queue: any;
  private _languageSettings: any;
  private _mausLanguages: any;
  private _asrLanguages: any;
  private _asrEnabled: boolean | undefined;

  // Value accessors for backward compatibility
  get asrOptions(): ASRStateSettings | undefined {
    return this._asrOptions;
  }

  get queue(): any {
    return this._queue;
  }

  get languageSettings(): any {
    return this._languageSettings;
  }

  get mausLanguages(): any {
    return this._mausLanguages;
  }

  get asrLanguages(): any {
    return this._asrLanguages;
  }

  get asrEnabled(): boolean | undefined {
    return this._asrEnabled;
  }

  // Observable compatibility for components using subscribe()
  asrOptions$: Observable<ASRStateSettings | undefined>;
  queue$: Observable<any>;
  languageSettings$: Observable<any>;
  mausLanguages$: Observable<any>;
  asrLanguages$: Observable<any>;
  asrEnabled$: Observable<boolean | undefined>;

  itemChange$ = this.actions$.pipe(
    ofType(
      ASRActions.processQueueItem.success,
      ASRActions.processQueueItem.fail,
    ),
    map((action) => action.item),
  );

  constructor(
    private store: Store<RootState>,
    private actions$: Actions,
  ) {
    // Create observables from signals for compatibility
    this.asrOptions$ = this.store.select(selectASRSettings);
    this.queue$ = this.store.select(selectASRQueue);
    this.languageSettings$ = this.store.select(selectASRLanguageSettings);
    this.mausLanguages$ = this.store.select(selectMausLanguages);
    this.asrLanguages$ = this.store.select(selectASRLanguages);
    this.asrEnabled$ = this.store.select(selectASREnabled);

    // Setup effects to sync signal values to cached properties
    effect(() => {
      this._asrOptions = this.asrOptionsSignal();
    });
    effect(() => {
      this._queue = this.queueSignal();
    });
    effect(() => {
      this._languageSettings = this.languageSettingsSignal();
    });
    effect(() => {
      this._mausLanguages = this.mausLanguagesSignal();
    });
    effect(() => {
      this._asrLanguages = this.asrLanguagesSignal();
    });
    effect(() => {
      this._asrEnabled = this.asrEnabledSignal();
    });
  }

  startProcessing() {
    this.store.dispatch(ASRActions.startProcessing.do());
  }

  stopItemProcessing(time: ASRTimeInterval) {
    this.store.dispatch(
      ASRActions.stopItemProcessing.do({
        time,
      }),
    );
  }

  addToQueue(
    timeInterval: ASRTimeInterval,
    type: ASRQueueItemType,
    transcript?: string,
  ) {
    this.store.dispatch(
      ASRActions.addToQueue.do({
        item: {
          timeInterval,
          type,
          transcript,
        },
      }),
    );
  }

  stopProcessing() {
    this.store.dispatch(ASRActions.stopProcessing.do());
  }

  setASRSettings(settings: ASRStateSettings) {
    this.store.dispatch(ASRActions.setASRSettings.do({ settings }));
  }
}
