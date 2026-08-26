import { computed, effect, EventEmitter, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskDto, TaskInputOutputDto } from '@octra/api-types';
import {
  AnnotationAnySegment,
  AnnotationLevelType,
  ASRContext,
  OEvent,
  OItem,
  TextConverter,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { TrattGuidelines } from '@tratt/assets';
import { getTranscriptFromIO, SubscriptionManager } from '@tratt/utilities';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { OLogging } from '../../../obj/Settings/logging';
import { StatisticElem } from '../../../obj/statistics/StatisticElement';
import { AudioService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { ApplicationStoreService } from '../../application/application-store.service';
import { ApplicationActions } from '../../application/application.actions';
import { getModeState, LoginMode, RootState } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';
import { AnnotationTextProcessingService } from './annotation-text-processing.service';
import {
  selectAnnotationCurrentLevel,
  selectAnnotationCurrentLevelIndex,
  selectAnnotationTranscript,
  selectCurrentSession,
  selectCurrentTask,
  selectGuidelines,
  selectImportConverter,
  selectImportOptions,
} from './annotation.selectors';

@Injectable({
  providedIn: 'root',
})
export class AnnotationStoreService {
  public segmentrequested = new EventEmitter<number>();

  get silencePlaceholder(): string | undefined {
    const g = this.guidelinesValue;
    if (g?.markers) {
      return g.markers.find((a) => a.type === 'break')?.code;
    }
    return undefined;
  }

  private currentLevelForStats = this.store.selectSignal(
    selectAnnotationCurrentLevel,
  );
  private guidelinesForStats = this.store.selectSignal(selectGuidelines);

  statistics = computed(() => {
    const level = this.currentLevelForStats();
    const guidelines = this.guidelinesForStats();
    const result = {
      transcribed: 0,
      empty: 0,
      pause: 0,
    };

    if (level instanceof TrattAnnotationSegmentLevel) {
      const breakMarkerCode = guidelines?.selected?.json?.markers?.find(
        (a) => a.type === 'break',
      )?.code;
      for (let i = 0; i < level.items.length; i++) {
        const item = level.items[i];
        const labelIndex = item.labels.findIndex((a) => a.name !== 'Speaker');

        if (
          labelIndex > -1 &&
          item.labels[labelIndex].value.trim().length > 0
        ) {
          if (
            breakMarkerCode !== undefined &&
            item.labels[labelIndex].value.indexOf(breakMarkerCode) > -1
          ) {
            result.pause++;
          } else {
            result.transcribed++;
          }
        } else {
          result.empty++;
        }
      }
    }
    return result;
  });

  get breakMarker() {
    const g = this.guidelinesValue;
    return g?.markers?.find((a) => a.type === 'break');
  }

  private _validationArray: {
    level: number;
    segment: number;
    validation: any[];
  }[] = [];
  private subscrManager = new SubscriptionManager();

  get validationArray(): {
    segment: number;
    validation: any[];
    level: number;
  }[] {
    return this._validationArray;
  }

  private _transcriptValid = false;
  get transcriptValid(): boolean {
    return this._transcriptValid;
  }

  private currentSessionForInput =
    this.store.selectSignal(selectCurrentSession);

  textInput = computed(() => {
    const session = this.currentSessionForInput();
    if (!session) return undefined;
    if (
      this.appStoreService.useMode === undefined ||
      this.appStoreService.useMode === LoginMode.LOCAL ||
      this.appStoreService.useMode === LoginMode.URL
    ) {
      return undefined;
    }
    return getTranscriptFromIO(
      session.task?.inputs ?? [],
    ) as TaskInputOutputDto;
  });

  private currentSessionForStatus =
    this.store.selectSignal(selectCurrentSession);
  status = computed(() => this.currentSessionForStatus()?.status);

  private transcriptForString = this.store.selectSignal(
    selectAnnotationTranscript,
  );

  transcriptString = computed(() => {
    const transcript = this.transcriptForString();
    if (transcript) {
      const annotation = transcript.serialize(
        this.audio.audioManager.resource.name,
        this.audio.audioManager.resource.info.sampleRate,
        this.audio.audioManager.resource.info.duration.clone(),
      );

      const result = new TextConverter().export(
        annotation,
        this.audio.audioManager.resource.getOAudioFile(),
        transcript.selectedLevelIndex!,
      )!.file!;

      return result.content;
    }
    return '';
  });

  private _currentLevel?: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  private _currentLevelIndex = 0;
  private _transcript?: TrattAnnotation<ASRContext, TrattAnnotationSegment>;
  private _task?: TaskDto;
  private _guidelines?: TrattGuidelines;
  private _feedback: any;
  private _statistics = { transcribed: 0, empty: 0, pause: 0 };

  // Signals
  transcriptSignal = this.store.selectSignal(selectAnnotationTranscript);
  currentLevelSignal = this.store.selectSignal(selectAnnotationCurrentLevel);
  currentLevelIndexSignal = this.store.selectSignal(
    selectAnnotationCurrentLevelIndex,
  );
  taskSignal = this.store.selectSignal(selectCurrentTask);
  guidelinesSignal = this.store.selectSignal(selectGuidelines);

  // Observable compatibility for components using subscribe()
  transcript$: Observable<
    TrattAnnotation<ASRContext, TrattAnnotationSegment> | undefined
  >;
  currentLevel$: Observable<
    TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined
  >;
  currentLevelIndex$: Observable<number>;
  task$: Observable<TaskDto | undefined>;
  guidelines$: Observable<any>;
  feedback$: Observable<any>;
  textInput$: Observable<any>;
  transcriptString$: Observable<string>;

  // Value properties for backward compatibility with components
  get transcript():
    | TrattAnnotation<ASRContext, TrattAnnotationSegment>
    | undefined {
    return this._transcript;
  }

  get currentLevel():
    | TrattAnnotationAnyLevel<TrattAnnotationSegment>
    | undefined {
    return this._currentLevel;
  }

  get currentLevelIndex(): number {
    return this._currentLevelIndex;
  }

  get task(): TaskDto | undefined {
    return this._task;
  }

  get guidelines(): TrattGuidelines | undefined {
    return this.guidelinesValue;
  }

  get guidelinesValue(): TrattGuidelines | undefined {
    return this._guidelines;
  }

  get feedback(): any {
    return this._feedback;
  }

  get additionalSpeakerIds(): string[] {
    return getModeState(this.appStorage.snapshot)?.additionalSpeakerIds ?? [];
  }

  private currentSessionForFeedback =
    this.store.selectSignal(selectCurrentSession);
  private guidelinesForBreakMarker = this.store.selectSignal(selectGuidelines);

  importOptions$ = new BehaviorSubject<Record<string, any> | undefined>(
    undefined,
  );
  importConverter$ = new BehaviorSubject<string | undefined>(undefined);

  public set comment(value: string | undefined) {
    this.changeComment(value ?? '');
  }

  public get comment(): string {
    return getModeState(this.appStorage.snapshot)?.currentSession.comment ?? '';
  }

  constructor(
    private store: Store<RootState>,
    private audio: AudioService,
    private appStoreService: ApplicationStoreService,
    private appStorage: AppStorageService,
    private textProcessing: AnnotationTextProcessingService,
  ) {
    // Initialize observables for backward compatibility
    this.transcript$ = this.store.select(selectAnnotationTranscript);
    this.currentLevel$ = this.store.select(selectAnnotationCurrentLevel);
    this.currentLevelIndex$ = this.store.select(
      selectAnnotationCurrentLevelIndex,
    );
    this.task$ = this.store.select(selectCurrentTask);
    this.guidelines$ = this.store.select(selectGuidelines);
    this.feedback$ = this.store
      .select(selectCurrentSession)
      .pipe(map((session: any) => session?.assessment));
    this.textInput$ = this.store.select(selectCurrentSession).pipe(
      map((session: any) => {
        if (!session) return undefined;
        if (
          this.appStoreService.useMode === undefined ||
          this.appStoreService.useMode === LoginMode.LOCAL ||
          this.appStoreService.useMode === LoginMode.URL
        ) {
          return undefined;
        }
        return getTranscriptFromIO(
          session.task?.inputs ?? [],
        ) as TaskInputOutputDto;
      }),
    );
    this.transcriptString$ = this.store.select(selectAnnotationTranscript).pipe(
      map((transcript: any) => {
        if (transcript) {
          const annotation = transcript.serialize(
            this.audio.audioManager.resource.name,
            this.audio.audioManager.resource.info.sampleRate,
            this.audio.audioManager.resource.info.duration.clone(),
          );
          const result = new TextConverter().export(
            annotation,
            this.audio.audioManager.resource.getOAudioFile(),
            transcript.selectedLevelIndex!,
          )!.file!;
          return result.content;
        }
        return '';
      }),
    );

    effect(() => {
      this._transcript = this.transcriptSignal();
    });
    effect(() => {
      this._task = this.taskSignal();
    });
    effect(() => {
      this._guidelines = this.guidelinesSignal()?.selected?.json;
    });
    effect(() => {
      this._currentLevel = this.currentLevelSignal();
    });
    effect(() => {
      this._currentLevelIndex = this.currentLevelIndexSignal();
    });
    effect(() => {
      this._feedback = this.currentSessionForFeedback()?.assessment;
    });
    effect(() => {
      const stats = this.statistics();
      this._statistics = stats;
    });

    this.store.select(selectImportOptions).subscribe(this.importOptions$);

    this.store.select(selectImportConverter).subscribe(this.importConverter$);
  }

  quit(clearSession: boolean, freeTask: boolean, redirectToProjects = false) {
    this.store.dispatch(
      AnnotationActions.quit.do({
        clearSession,
        freeTask,
        redirectToProjects,
      }),
    );
  }

  sendOnlineAnnotation() {
    this.store.dispatch(
      AnnotationActions.sendOnlineAnnotation.do({
        mode: this.appStorage.snapshot.application.mode!,
      }),
    );
  }

  changeComment(comment: string) {
    this.store.dispatch(
      LoginModeActions.changeComment.do({
        mode: this.appStoreService.useMode!,
        comment,
      }),
    );
  }

  changeLevelName(index: number, name: string) {
    this.store.dispatch(
      AnnotationActions.changeLevelName.do({
        mode: this.appStorage.snapshot.application.mode!,
        index,
        name,
      }),
    );
  }

  resumeTaskManually() {
    this.store.dispatch(AnnotationActions.resumeTaskManually.do());
  }

  addSpeakerId(id: string) {
    this.store.dispatch(
      AnnotationActions.addSpeakerId.do({
        id,
        mode: this.appStorage.useMode,
      }),
    );
  }

  removeSpeakerId(id: string) {
    this.store.dispatch(
      AnnotationActions.removeSpeakerId.do({
        id,
        mode: this.appStorage.useMode,
      }),
    );
  }

  public addAnnotationLevel(levelType: AnnotationLevelType) {
    this.store.dispatch(
      AnnotationActions.addAnnotationLevel.do({
        levelType,
        audioDuration: this.audio.audiomanagers[0].resource.info.duration,
        mode: this.appStorage.useMode,
      }),
    );
  }

  public duplicateLevel(index: number) {
    this.store.dispatch(
      AnnotationActions.duplicateLevel.do({
        index,
        mode: this.appStorage.useMode,
      }),
    );
  }

  removeLevel(id: number) {
    this.store.dispatch(
      AnnotationActions.removeAnnotationLevel.do({
        id,
        mode: this.appStorage.useMode,
      }),
    );
  }

  detachLinkedLevel(id: number) {
    this.store.dispatch(
      AnnotationActions.detachLinkedLevel.do({
        id,
        mode: this.appStorage.useMode,
      }),
    );
  }

  addTranslatedLevel(sourceLevelId: number, targetLanguageLabel: string) {
    this.store.dispatch(
      AnnotationActions.addTranslatedLevel.do({
        sourceLevelId,
        targetLanguageLabel,
        mode: this.appStorage.useMode,
      }),
    );
  }

  applyTranslationToLinkedLevel(
    linkedLevelId: number,
    translated: import('../../../workers/translation.worker').TranslationSegment[],
  ) {
    this.store.dispatch(
      AnnotationActions.applyTranslationToLinkedLevel.do({
        linkedLevelId,
        translated,
        mode: this.appStorage.useMode,
      }),
    );
  }

  /***
   * destroys audio service and transcr service. Call this after quit.
   * @param destroyaudio
   */
  public endTranscription = (destroyaudio = true) => {
    this.audio.destroy(destroyaudio);
    this.store.dispatch(ApplicationActions.finishLoading());
  };

  public destroy() {
    this.subscrManager.destroy();
  }

  public validate(rawText: string): any[] {
    return this.textProcessing.validate(rawText, this.guidelinesValue);
  }

  public replaceSingleTags(html: string) {
    return this.textProcessing.replaceSingleTags(html);
  }

  public extractUI(uiElements: StatisticElem[]): OLogging {
    return this.textProcessing.extractUI(uiElements);
  }

  /**
   * converts raw text of markers to html
   */
  public async rawToHTML(rawtext: string): Promise<string> {
    return this.textProcessing.rawToHTML(rawtext, this.guidelinesValue);
  }

  public underlineTextRed(rawtext: string, validation: any[]) {
    return this.textProcessing.underlineTextRed(
      rawtext,
      validation,
      this.guidelinesValue,
    );
  }

  public async getErrorDetails(code: string) {
    return this.textProcessing.getErrorDetails(code, this.guidelinesValue);
  }

  public requestSegment(segnumber: number) {
    this.segmentrequested.emit(segnumber);
  }

  public validateAll() {
    const result = this.textProcessing.validateAll(
      this._transcript,
      this.guidelinesValue,
    );
    this._validationArray = result.validationArray;
    if (result.transcriptValid !== undefined) {
      this._transcriptValid = result.transcriptValid;
    }
  }

  public getMarkerPositions(
    rawText: string,
    guidelines: any,
  ): { start: number; end: number }[] {
    return this.textProcessing.getMarkerPositions(rawText, guidelines);
  }

  setLevelIndex(currentLevelIndex: number) {
    this.store.dispatch(
      AnnotationActions.setLevelIndex.do({
        currentLevelIndex,
        mode: this.appStoreService.useMode!,
      }),
    );
  }

  changeFeedback(feedback: any) {
    this.store.dispatch(
      AnnotationActions.changeFeedback.do({
        feedback,
      }),
    );
  }

  public analyse() {
    this._statistics = this.textProcessing.analyse(
      this._currentLevel,
      this.breakMarker,
    );
  }

  overwriteTranscript(
    transcript: TrattAnnotation<ASRContext, TrattAnnotationSegment>,
  ) {
    this.store.dispatch(
      AnnotationActions.overwriteTranscript.do({
        transcript,
        mode: this.appStoreService.useMode!,
        saveToDB: true,
      }),
    );
  }

  changeCurrentItemById(
    id: number,
    item: OItem | OEvent | TrattAnnotationSegment,
  ) {
    this.store.dispatch(
      AnnotationActions.changeCurrentItemById.do({
        id,
        item,
        mode: this.appStoreService.useMode!,
      }),
    );
  }

  changeCurrentLevelItems(items: AnnotationAnySegment[]) {
    this.store.dispatch(
      AnnotationActions.changeCurrentLevelItems.do({
        items,
        mode: this.appStoreService.useMode!,
      }),
    );
  }

  removeCurrentLevelItems(
    items: { index?: number; id?: number }[],
    silenceCode?: string,
    mergeTranscripts?: boolean,
  ) {
    this.store.dispatch(
      AnnotationActions.removeCurrentLevelItems.do({
        items,
        mode: this.appStoreService.useMode!,
        removeOptions: {
          silenceCode,
          mergeTranscripts,
        },
      }),
    );
  }

  addCurrentLevelItems(items: AnnotationAnySegment[]) {
    this.store.dispatch(
      AnnotationActions.addCurrentLevelItems.do({
        items,
        mode: this.appStoreService.useMode!,
      }),
    );
  }

  combinePhrases(options: any) {
    this.store.dispatch(
      AnnotationActions.combinePhrases.do({
        options,
        mode: this.appStorage.useMode!,
      }),
    );
  }

  overwriteTidyUpAnnotation() {
    const tidyUp = (window as any).tidyUpAnnotation;

    (window as any).tidyUpAnnotation = (transcript: any, guidelines: any) => {
      transcript = tidyUp(transcript, guidelines);

      // make sure there is only one speaker label for each unit if exists
      if (
        this.importOptions$.value &&
        this.importConverter$.value === 'SRT' &&
        this.importOptions$.value['SRT']?.speakerIdentifierPattern
      ) {
        const pattern =
          this.importOptions$.value['SRT'].speakerIdentifierPattern;
        const regex = new RegExp(pattern, 'g');
        const matches: RegExpExecArray[] = [];
        let match = regex.exec(transcript);

        while (match) {
          matches.push(match);
          match = regex.exec(transcript);
        }

        for (let i = matches.length - 1; i > 0; i--) {
          match = matches[i];
          transcript =
            transcript.substring(0, match.index) +
            transcript.substring(match.index + match[0].length);
          match = regex.exec(transcript);
        }
      }
      return transcript;
    };
  }

  setImportConverter(mode: LoginMode, importConverter: string) {
    this.store.dispatch(
      LoginModeActions.setImportConverter.do({ mode, importConverter }),
    );
  }
}
