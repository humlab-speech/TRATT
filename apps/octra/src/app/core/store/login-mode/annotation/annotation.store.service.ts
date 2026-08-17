import { computed, effect, EventEmitter, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AnnotationAnySegment,
  AnnotationLevelType,
  ASRContext,
  OctraAnnotation,
  OctraAnnotationAnyLevel,
  OctraAnnotationSegment,
  OctraAnnotationSegmentLevel,
  OEvent,
  OItem,
  TextConverter,
} from '@octra/annotation';
import { TaskDto, TaskInputOutputDto } from '@octra/api-types';
import { OctraGuidelines } from '@octra/assets';
import { MultiThreadingService } from '@octra/ngx-components';
import {
  escapeRegex,
  getTranscriptFromIO,
  insertString,
  SubscriptionManager,
  TsWorkerJob,
} from '@octra/utilities';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { OLog, OLogging } from '../../../obj/Settings/logging';
import { KeyStatisticElem } from '../../../obj/statistics/KeyStatisticElem';
import { MouseStatisticElem } from '../../../obj/statistics/MouseStatisticElem';
import { StatisticElem } from '../../../obj/statistics/StatisticElement';
import { AudioService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { ApplicationStoreService } from '../../application/application-store.service';
import { ApplicationActions } from '../../application/application.actions';
import { getModeState, LoginMode, RootState } from '../../index';
import { LoginModeActions } from '../login-mode.actions';
import { AnnotationActions } from './annotation.actions';
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

    if (level instanceof OctraAnnotationSegmentLevel) {
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

  private _currentLevel?: OctraAnnotationAnyLevel<OctraAnnotationSegment>;
  private _currentLevelIndex = 0;
  private _transcript?: OctraAnnotation<ASRContext, OctraAnnotationSegment>;
  private _task?: TaskDto;
  private _guidelines?: OctraGuidelines;
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
    OctraAnnotation<ASRContext, OctraAnnotationSegment> | undefined
  >;
  currentLevel$: Observable<
    OctraAnnotationAnyLevel<OctraAnnotationSegment> | undefined
  >;
  currentLevelIndex$: Observable<number>;
  task$: Observable<TaskDto | undefined>;
  guidelines$: Observable<any>;
  feedback$: Observable<any>;
  textInput$: Observable<any>;
  transcriptString$: Observable<string>;

  // Value properties for backward compatibility with components
  get transcript():
    | OctraAnnotation<ASRContext, OctraAnnotationSegment>
    | undefined {
    return this._transcript;
  }

  get currentLevel():
    | OctraAnnotationAnyLevel<OctraAnnotationSegment>
    | undefined {
    return this._currentLevel;
  }

  get currentLevelIndex(): number {
    return this._currentLevelIndex;
  }

  get task(): TaskDto | undefined {
    return this._task;
  }

  get guidelines(): OctraGuidelines | undefined {
    return this.guidelinesValue;
  }

  get guidelinesValue(): OctraGuidelines | undefined {
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
    private multiThreading: MultiThreadingService,
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
    if (!this.guidelinesValue) {
      return [];
    }
    const results = validateAnnotation(rawText, this.guidelinesValue);

    // check if selection is in the raw text
    const sPos = rawText.indexOf('✉✉✉sel-start/📩📩📩');
    const sLen = '✉✉✉sel-start/✉✉✉'.length;
    const ePos = rawText.indexOf('✉✉✉sel-end/📩📩📩');
    const eLen = '✉✉✉sel-end/📩📩📩'.length;

    // look for segment boundaries like {23423424}
    const segRegex = new RegExp(/{[0-9]+}/g);

    for (let i = 0; i < results.length; i++) {
      const validation = results[i];

      if (sPos > -1 && ePos > -1) {
        // check if error is between the selection marks
        if (
          (validation.start >= sPos &&
            validation.start + validation.length <= sPos + sLen) ||
          (validation.start >= ePos &&
            validation.start + validation.length <= ePos + eLen)
        ) {
          // remove
          results.splice(i, 1);
          i--;
        }
      }

      let match = segRegex.exec(rawText);
      while (match != undefined) {
        if (
          validation.start >= match.index &&
          validation.start + validation.length <= match.index + match[0].length
        ) {
          // remove
          results.splice(i, 1);
          i--;
        }

        match = segRegex.exec(rawText);
      }
    }

    return results;
  }

  public replaceSingleTags(html: string) {
    html = html.replace(/(<)([^<>]+)(>)/g, (g0, g1, g2) => {
      return `✉✉✉${g2}📩📩📩`;
    });

    html = html.replace(/([<>])/g, (g0, g1) => {
      if (g1 === '<') {
        return '&lt;';
      }
      return '&gt;';
    });

    html = html.replace(/((?:✉✉✉)|(?:📩📩📩))/g, (g0, g1) => {
      if (g1 === '✉✉✉') {
        return '<';
      }

      return '>';
    });

    return html;
  }

  public extractUI(uiElements: StatisticElem[]): OLogging {
    const now = new Date();
    const result: OLogging = new OLogging(
      '1.0',
      'UTF-8',
      this.appStorage.onlineSession?.currentProject?.name === undefined
        ? 'local'
        : this.appStorage.onlineSession?.currentProject?.name,
      now.toUTCString(),
      this.audio.audioManager.resource.name,
      this.audio.audioManager.resource.info.sampleRate,
      this.audio.audioManager.resource.info.duration.samples,
      [],
    );

    if (uiElements) {
      for (const elem of uiElements) {
        const newElem = new OLog(
          elem.timestamp,
          elem.type,
          elem.context,
          '',
          elem.playpos,
          elem.textSelection,
          elem.audioSelection,
          elem.transcriptionUnit,
        );

        if (elem instanceof MouseStatisticElem) {
          newElem.value = elem.value;
        } else if (elem instanceof KeyStatisticElem) {
          newElem.value = (elem as KeyStatisticElem).value;
        } else {
          newElem.value = (elem as StatisticElem).value;
        }

        result.logs.push(newElem);
      }
    }

    return result;
  }

  /**
   * converts raw text of markers to html
   */
  public async rawToHTML(rawtext: string): Promise<string> {
    const job = new TsWorkerJob<[rawtext: string, guidelines: any], string>(
      (rawtext: string, guidelines: any) => {
        return new Promise<string>((resolve, reject) => {
          try {
            let result: string = rawtext;

            if (rawtext !== '') {
              result = result.replace(/\r?\n/g, ' '); // .replace(/</g, "&lt;").replace(/>/g, "&gt;");
              // replace markers with no wrap

              const escapeRegex = function (regexStr: string) {
                // escape special chars in regex
                return regexStr.replace(/[-/\\^$*+?ß%.()|[\]{}]/g, '\\$&');
              };
              const markers = guidelines.markers;
              // replace all tags that are not markers
              result = result.replace(
                new RegExp(/(<\/?)?([^<>]+)(>)/, 'g'),
                (g0, g1, g2, g3) => {
                  g1 = g1 === undefined ? '' : g1;
                  g2 = g2 === undefined ? '' : g2;
                  g3 = g3 === undefined ? '' : g3;

                  // check if its an html tag
                  if (
                    g2 === 'img' &&
                    g2 === 'span' &&
                    g2 === 'div' &&
                    g2 === 'i' &&
                    g2 === 'b' &&
                    g2 === 'u' &&
                    g2 === 's'
                  ) {
                    return `✉✉✉${g2}📩📩📩`;
                  }

                  // check if it's a marker
                  for (const marker of markers) {
                    if (`${g1}${g2}${g3}` === marker.code) {
                      return `✉✉✉${g2}📩📩📩`;
                    }
                  }

                  return `${g1}${g2}${g3}`;
                },
              );

              // replace
              result = result.replace(/([<>])/g, (g0, g1) => {
                if (g1 === '<') {
                  return '&lt;';
                }

                return '&gt;';
              });

              result = result.replace(/(✉✉✉)|(📩📩📩)/g, (g0, g1, g2) => {
                if (g2 === undefined && g1 !== undefined) {
                  return '<';
                } else {
                  return '>';
                }
              });

              for (const marker of markers) {
                // replace {<number>} with boundary HTMLElement
                result = result.replace(/\s?{([0-9]+)}\s?/g, (x, g1) => {
                  return (
                    ' <img src="assets/img/components/transcr-editor/boundary.png" ' +
                    'class="btn-icon-text boundary" style="height:16px;" ' +
                    'data-samples="' +
                    g1 +
                    '" alt="[|' +
                    g1 +
                    '|]"> '
                  );
                });

                // replace markers
                const regex = new RegExp(
                  '( )*(' + escapeRegex(marker.code) + ')( )*',
                  'g',
                );
                result = result.replace(regex, (x, g1, g2, g3) => {
                  const s1 = g1 ? g1 : '';
                  const s3 = g3 ? g3 : '';

                  let img = '';
                  if (
                    !(marker.icon === undefined || marker.icon === '') &&
                    (marker.icon.indexOf('.png') > -1 ||
                      marker.icon.indexOf('.jpg') > -1 ||
                      marker.icon.indexOf('.gif') > -1)
                  ) {
                    const markerCode = marker.code
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;');

                    img =
                      "<img src='" +
                      marker.icon +
                      "' class='btn-icon-text boundary' style='height:16px;' " +
                      "data-marker-code='" +
                      markerCode +
                      "' alt='" +
                      markerCode +
                      "'/>";
                  } else {
                    // is text or ut8 symbol
                    if (marker.icon !== undefined && marker.icon !== '') {
                      img = marker.icon;
                    } else {
                      img = marker.code
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    }
                  }

                  return s1 + img + s3;
                });
              }
              // replace more than one empty spaces
              result = result.replace(/\s+$/g, '&nbsp;');
            }

            // wrap result with <p>. Missing this would cause the editor fail on marker insertion
            result =
              result !== '' && result !== ' ' ? '<p>' + result + '</p>' : '';

            resolve(result.replace(/\uFEFF/gm, ''));
          } catch (e) {
            reject(e);
          }
        });
      },
      rawtext,
      this.guidelines,
    );

    return this.multiThreading.run(job);
  }

  public underlineTextRed(rawtext: string, validation: any[]) {
    let result = rawtext;

    try {
      const sPos = rawtext.indexOf('✉✉✉sel-start/📩📩📩');
      const sLen = '✉✉✉sel-start/📩📩📩'.length;

      interface Pos {
        start: number;
        puffer: string;
      }

      const markerPositions = this.getMarkerPositions(rawtext, this.guidelines);

      let insertions: Pos[] = [];

      if (validation.length > 0) {
        // prepare insertions
        for (const validationElement of validation) {
          const foundMarker = markerPositions.find((a) => {
            return (
              validationElement.start > a.start &&
              validationElement.start + validationElement.length < a.end
            );
          });

          if (foundMarker === undefined) {
            let insertStart = insertions.find((val) => {
              return val.start === validationElement.start;
            });

            if (insertStart === undefined) {
              insertStart = {
                start:
                  sPos < 0 || validationElement.start < sPos
                    ? validationElement.start
                    : sPos + sLen + validationElement.start,
                puffer:
                  "✉✉✉span class='val-error' data-errorcode='" +
                  validationElement.code +
                  "'📩📩📩",
              };
              insertions.push(insertStart);
            } else {
              insertStart.puffer +=
                "✉✉✉span class='val-error' data-errorcode='" +
                validationElement.code +
                "'📩📩📩";
            }

            let insertEnd = insertions.find((val) => {
              return (
                val.start === validationElement.start + validationElement.length
              );
            });

            if (insertEnd === undefined) {
              insertEnd = {
                start: insertStart.start + validationElement.length,
                puffer: '',
              };
              insertEnd.puffer = '✉✉✉/span📩📩📩';
              insertions.push(insertEnd);
            } else {
              insertEnd.puffer = '✉✉✉/span📩📩📩' + insertEnd.puffer;
            }
          }
        }

        insertions = insertions.sort((a: Pos, b: Pos) => {
          if (a.start === b.start) {
            return 0;
          } else if (a.start < b.start) {
            return -1;
          }
          return 1;
        });

        let puffer = '';
        for (const insertion of insertions) {
          const offset = puffer.length;
          const pos = insertion.start;

          result = insertString(result, pos + offset, insertion.puffer);
          puffer += insertion.puffer;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return result;
  }

  public async getErrorDetails(code: string) {
    if (this.guidelinesValue?.instructions !== undefined) {
      const instructions = this.guidelinesValue.instructions;

      for (const instruction of instructions) {
        if (
          instruction.entries !== undefined &&
          Array.isArray(instruction.entries)
        ) {
          for (const entry of instruction.entries) {
            const newEntry = { ...entry };
            if (newEntry.code === code) {
              newEntry.description = newEntry.description.replace(
                /{{([^{}]+)}}/g,
                (g0: string, g1: string) => {
                  return ''; // (await this.rawToHTML(g1)).replace(/(<p>)|(<\/p>)/g, '');
                },
              );
              return newEntry;
            }
          }
        }
      }
    }
    return undefined;
  }

  public requestSegment(segnumber: number) {
    this.segmentrequested.emit(segnumber);
  }

  public validateAll() {
    this._validationArray = [];
    const projectSettings = getModeState(
      this.appStorage.snapshot,
    )?.projectConfig;

    if (
      this.appStorage.useMode !== LoginMode.URL &&
      (this.appStorage.useMode === LoginMode.DEMO ||
        projectSettings?.tratt?.validationEnabled === true)
    ) {
      let invalid = false;
      const transcript = this._transcript;
      if (transcript) {
        for (const level of transcript.levels) {
          for (let i = 0; i < level!.items.length; i++) {
            const segment = level!.items[i];

            let segmentValidation = [];
            const labelIndex = segment.labels.findIndex(
              (a: any) => a.name !== 'Speaker',
            );
            if (
              labelIndex > -1 &&
              segment.labels[labelIndex].value.length > 0
            ) {
              segmentValidation = this.validate(
                segment.labels[labelIndex].value,
              );
            }

            this._validationArray.push({
              level: level.id,
              segment: i,
              validation: segmentValidation,
            });

            if (segmentValidation.length > 0) {
              invalid = true;
            }
          }
        }
        this._transcriptValid = !invalid;
      } else {
        this._transcriptValid = true;
      }
    }
  }

  public getMarkerPositions(
    rawText: string,
    guidelines: any,
  ): { start: number; end: number }[] {
    const result = [];
    let regexStr = '';
    for (let i = 0; i < guidelines.markers.length; i++) {
      const marker = guidelines.markers[i];
      regexStr += `(${escapeRegex(marker.code)})`;

      if (i < guidelines.markers.length - 1) {
        regexStr += '|';
      }
    }
    const regex = new RegExp(regexStr, 'g');

    let match = regex.exec(rawText);
    while (match != undefined) {
      result.push({
        start: match.index,
        end: match.index + match[0].length,
      });
      match = regex.exec(rawText);
    }

    return result;
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
    this._statistics = {
      transcribed: 0,
      empty: 0,
      pause: 0,
    };

    if (this.currentLevel instanceof OctraAnnotationSegmentLevel) {
      for (let i = 0; i < this._currentLevel!.items.length; i++) {
        const segment = this._currentLevel!.items[i];
        const valueLabel = segment.getFirstLabelWithoutName('Speaker');

        if (segment.getFirstLabelWithoutName('Speaker')?.value !== '') {
          if (
            this.breakMarker !== undefined &&
            valueLabel!.value.indexOf(this.breakMarker.code) > -1
          ) {
            this._statistics.pause++;
          } else {
            this._statistics.transcribed++;
          }
        } else {
          this._statistics.empty++;
        }
      }
    }
  }

  overwriteTranscript(
    transcript: OctraAnnotation<ASRContext, OctraAnnotationSegment>,
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
    item: OItem | OEvent | OctraAnnotationSegment,
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
