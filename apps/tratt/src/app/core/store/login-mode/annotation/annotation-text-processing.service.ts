import { Injectable } from '@angular/core';
import {
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { TrattGuidelines } from '@tratt/assets';
import { MultiThreadingService } from '@tratt/ngx-components';
import { escapeRegex, insertString, TsWorkerJob } from '@tratt/utilities';
import { OLog, OLogging } from '../../../obj/Settings/logging';
import { KeyStatisticElem } from '../../../obj/statistics/KeyStatisticElem';
import { MouseStatisticElem } from '../../../obj/statistics/MouseStatisticElem';
import { StatisticElem } from '../../../obj/statistics/StatisticElement';
import { AudioService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { getModeState, LoginMode } from '../../index';

/**
 * Pure text-processing / marker-parsing logic extracted from
 * AnnotationStoreService (S3). These methods have no NgRx-effect
 * dependency; any state that previously came from AnnotationStoreService's
 * own signals/fields is now passed in explicitly by the caller.
 */
@Injectable({ providedIn: 'root' })
export class AnnotationTextProcessingService {
  constructor(
    private audio: AudioService,
    private appStorage: AppStorageService,
    private multiThreading: MultiThreadingService,
  ) {}

  public validate(
    rawText: string,
    guidelines: TrattGuidelines | undefined,
  ): any[] {
    if (!guidelines) {
      return [];
    }
    const results = validateAnnotation(rawText, guidelines);

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
          break;
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
  public async rawToHTML(
    rawtext: string,
    guidelines: TrattGuidelines | undefined,
  ): Promise<string> {
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
      guidelines,
    );

    return this.multiThreading.run(job);
  }

  public underlineTextRed(
    rawtext: string,
    validation: any[],
    guidelines: TrattGuidelines | undefined,
  ) {
    let result = rawtext;

    try {
      const sPos = rawtext.indexOf('✉✉✉sel-start/📩📩📩');
      const sLen = '✉✉✉sel-start/📩📩📩'.length;

      interface Pos {
        start: number;
        puffer: string;
      }

      const markerPositions = this.getMarkerPositions(rawtext, guidelines);

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

  public async getErrorDetails(
    code: string,
    guidelines: TrattGuidelines | undefined,
  ) {
    if (guidelines?.instructions !== undefined) {
      const instructions = guidelines.instructions;

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

  public validateAll(
    transcript: TrattAnnotation<TrattAnnotationSegment> | undefined,
    guidelines: TrattGuidelines | undefined,
  ): {
    validationArray: { level: number; segment: number; validation: any[] }[];
    transcriptValid: boolean | undefined;
  } {
    const validationArray: {
      level: number;
      segment: number;
      validation: any[];
    }[] = [];
    let transcriptValid: boolean | undefined = undefined;

    const projectSettings = getModeState(
      this.appStorage.snapshot,
    )?.projectConfig;

    if (
      this.appStorage.useMode !== LoginMode.URL &&
      (this.appStorage.useMode === LoginMode.DEMO ||
        projectSettings?.tratt?.validationEnabled === true)
    ) {
      let invalid = false;
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
                guidelines,
              );
            }

            validationArray.push({
              level: level.id,
              segment: i,
              validation: segmentValidation,
            });

            if (segmentValidation.length > 0) {
              invalid = true;
            }
          }
        }
        transcriptValid = !invalid;
      } else {
        transcriptValid = true;
      }
    }

    return { validationArray, transcriptValid };
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

  public analyse(
    currentLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment> | undefined,
    breakMarker: TrattGuidelines['markers'][number] | undefined,
  ): { transcribed: number; empty: number; pause: number } {
    const statistics = { transcribed: 0, empty: 0, pause: 0 };

    if (currentLevel instanceof TrattAnnotationSegmentLevel) {
      for (let i = 0; i < currentLevel.items.length; i++) {
        const segment = currentLevel.items[i];
        const valueLabel = segment.getFirstLabelWithoutName('Speaker');

        if (segment.getFirstLabelWithoutName('Speaker')?.value !== '') {
          if (
            breakMarker !== undefined &&
            valueLabel!.value.indexOf(breakMarker.code) > -1
          ) {
            statistics.pause++;
          } else {
            statistics.transcribed++;
          }
        } else {
          statistics.empty++;
        }
      }
    }

    return statistics;
  }
}
