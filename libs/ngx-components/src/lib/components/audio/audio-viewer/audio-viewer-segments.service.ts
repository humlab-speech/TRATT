import { EventEmitter, Injectable } from '@angular/core';
import {
  AnnotationAnySegment,
  betweenWhichSegment,
  OItem,
  OLabel,
  TrattAnnotation,
  TrattAnnotationAnyLevel,
  TrattAnnotationEvent,
  TrattAnnotationLink,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { AudioSelection, SampleUnit } from '@tratt/media';
import { AudioChunk, AudioManager, AudioTimeCalculator } from '@tratt/web-media';
import { CurrentLevelChangeEvent } from './audio-viewer.component';

/**
 * The subset of AudioviewerConfig's `boundaries` shape that
 * addOrRemoveSegment reads. Declared locally (rather than importing
 * AudioviewerConfig) for the same reason as AudioViewerTimeUtils'
 * AudioViewerLineSettings: importing AudioviewerConfig drags in
 * ng-bootstrap via the `obj` barrel, which fails to load in vitest's node
 * test environment; a plain object satisfying this shape exercises the
 * same code paths, and a real AudioviewerConfig instance satisfies it
 * structurally so callers can keep passing `this.settings` unchanged.
 */
export interface AudioViewerBoundarySettings {
  enabled: boolean;
  readonly: boolean;
  width: number;
}

/**
 * A single detected difference between an "old" and "new" TrattAnnotation,
 * as produced by AudioViewerSegmentsService.getChanges(). Moved here
 * (verbatim) from audio-viewer.service.ts, which now re-exports it for
 * backward compatibility with existing imports (e.g.
 * audio-viewer.component.ts's `import { AnnotationChange } from
 * './audio-viewer.service'`).
 */
export interface AnnotationChange {
  type: 'add' | 'remove' | 'change';
  level?: {
    old?: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
    new?: TrattAnnotationAnyLevel<TrattAnnotationSegment>;
  };
  item?: {
    old?: AnnotationAnySegment;
    new?: AnnotationAnySegment;
  };
  link?: {
    old?: TrattAnnotationLink;
    new?: TrattAnnotationLink;
  };
}

/**
 * Bookkeeping used while diffing two annotations in getChanges(): the IDs
 * still "unaccounted for" on each side, filtered down as matches are found
 * so that whatever remains at the end represents additions.
 */
interface DiffIdState {
  old: {
    levelIDs: number[];
    itemIDs: number[];
    linkIDs: number[];
  };
  new: {
    levelIDs: number[];
    itemIDs: number[];
    linkIDs: number[];
  };
}

/**
 * AudioViewerSegmentsService holds the segment-model logic extracted from
 * AudioViewerService (S1 split, task 13/21): computing diffs between
 * annotation snapshots, adding/changing/removing segments, and resolving
 * segment selections/IDs. It owns no rendering or canvas state — per the
 * task-13 scope amendment, `applyChanges` and `selectSegment` (which do
 * both segment-model work AND rendering calls, tangled together) were left
 * on AudioViewerService untouched.
 *
 * Most methods here don't own their annotation/audio state as fields:
 * `annotation`, `audioChunk`, `drawnSelection`, etc. are read/written by
 * many other methods elsewhere in the still-5000+-line
 * AudioViewerService, well outside this task's scope, so this service
 * follows the same pattern AudioViewerTimeUtils (task 12) established —
 * `this.X` field reads become method parameters, callers keep owning the
 * fields. The exception is `itemIDCounter`/`itemIDCounterChange`, which
 * (confirmed by repo-wide grep) are read/written nowhere except inside
 * `getNextItemID` itself, so this service owns that pair outright.
 */
@Injectable()
export class AudioViewerSegmentsService {
  public itemIDCounter = 1;
  public itemIDCounterChange = new EventEmitter<number>();

  public getNextItemID(): number {
    this.itemIDCounter++;
    this.itemIDCounterChange.emit(this.itemIDCounter);
    return this.itemIDCounter - 1;
  }

  /**
   * get selection of segment
   * @returns AudioSelection
   */
  public getSegmentSelection(
    positionSamples: number,
    annotation: TrattAnnotation<TrattAnnotationSegment> | undefined,
    audioManager: AudioManager | undefined,
  ): AudioSelection | undefined {
    // complex decision needed because there are no segments at position 0 and the end of the file
    let result = undefined;
    if (annotation?.currentLevel?.items && annotation.currentLevel.items.length > 0) {
      const segments = annotation.currentLevel.items;
      const length = annotation.currentLevel.items.length;

      if (length > 0 && segments !== undefined && audioManager !== undefined) {
        const firstSegment = segments[0] as TrattAnnotationSegment;
        const lastSegment = segments[
          segments.length - 1
        ] as TrattAnnotationSegment;

        if (firstSegment.time.samples !== lastSegment.time.samples) {
          if (positionSamples < firstSegment.time.samples) {
            // select in first Boundary
            result = new AudioSelection(
              audioManager.createSampleUnit(0),
              firstSegment.time,
            );
          } else if (positionSamples > lastSegment.time.samples) {
            // select in first Boundary
            const seg = lastSegment.time.clone();
            result = new AudioSelection(seg, audioManager.resource.info.duration);
          } else {
            for (let i = 1; i < length; i++) {
              const currentSegment = segments[
                i
              ] as TrattAnnotationSegment;
              const previousSegment = segments[
                i - 1
              ] as TrattAnnotationSegment;

              if (
                previousSegment?.time !== undefined &&
                currentSegment?.time !== undefined
              ) {
                if (
                  positionSamples > previousSegment.time.samples &&
                  positionSamples < currentSegment.time.samples
                ) {
                  result = new AudioSelection(
                    previousSegment.time,
                    currentSegment.time,
                  );
                  return result;
                }
              }
            }
          }
        }
      }
    }
    return result;
  }

  public removeSegmentByIndex(
    annotation: TrattAnnotation<TrattAnnotationSegment> | undefined,
    index: number,
    silenceCode: string | undefined,
    mergeTranscripts: boolean,
    triggerChange: boolean,
    currentLevelChange: EventEmitter<CurrentLevelChangeEvent>,
    annotationChange: EventEmitter<TrattAnnotation<TrattAnnotationSegment>>,
    changeTranscript?: (transcript: string) => string,
  ): void {
    if (annotation?.currentLevel) {
      annotation.removeItemByIndex(
        index,
        silenceCode,
        mergeTranscripts,
        changeTranscript,
      );
      if (triggerChange) {
        currentLevelChange.emit({
          type: 'remove',
          items: [
            {
              index,
            },
          ],
          removeOptions: {
            silenceCode,
            mergeTranscripts,
          },
        });
        annotationChange.emit(annotation);
      }
    } else {
      throw new Error(
        "Can't remove segment by index: current level is undefined",
      );
    }
  }

  public addSegment(
    annotation: TrattAnnotation<TrattAnnotationSegment>,
    currentLevelChange: EventEmitter<CurrentLevelChangeEvent>,
    annotationChange: EventEmitter<TrattAnnotation<TrattAnnotationSegment>>,
    start: SampleUnit,
    value?: string,
  ): void {
    const result = annotation.addItemToCurrentLevel(
      start,
      value ? [new OLabel(annotation.currentLevel!.name, value)] : undefined,
    );
    currentLevelChange.emit({
      type: 'add',
      items: [
        {
          instance: annotation.createSegment(
            start,
            value ? [new OLabel(annotation.currentLevel!.name, value)] : undefined,
          ),
        },
      ],
    });
    annotationChange.emit(result);
  }

  public changeSegment(
    annotation: TrattAnnotation<TrattAnnotationSegment>,
    currentLevelChange: EventEmitter<CurrentLevelChangeEvent>,
    annotationChange: EventEmitter<TrattAnnotation<TrattAnnotationSegment>>,
    start: SampleUnit,
    segment: TrattAnnotationSegment,
  ): void {
    const result = annotation.changeCurrentSegmentBySamplePosition(start, segment);
    currentLevelChange.emit({
      type: 'change',
      items: [
        {
          instance: segment,
        },
      ],
    });
    annotationChange.emit(result);
  }

  public addOrRemoveSegment(context: {
    settings: { boundaries: AudioViewerBoundarySettings };
    audioTCalculator: AudioTimeCalculator | undefined;
    audioChunk: AudioChunk | undefined;
    audioPxW: number;
    mouseCursor: SampleUnit | undefined;
    annotation: TrattAnnotation<TrattAnnotationSegment> | undefined;
    audioManager: AudioManager | undefined;
    silencePlaceholder: string | undefined;
    drawnSelection: AudioSelection | undefined;
    currentLevelChange: EventEmitter<CurrentLevelChangeEvent>;
    annotationChange: EventEmitter<TrattAnnotation<TrattAnnotationSegment>>;
  }):
    | {
        type: string;
        seg_samples: number;
        seg_ID: number;
        msg: { type: string; text: string };
      }
    | undefined {
    const {
      settings,
      audioTCalculator,
      audioChunk,
      audioPxW,
      mouseCursor,
      annotation,
      audioManager,
      silencePlaceholder,
      drawnSelection,
      currentLevelChange,
      annotationChange,
    } = context;
    let i = 0;

    if (
      settings.boundaries.enabled &&
      !settings.boundaries.readonly &&
      audioTCalculator !== undefined &&
      audioChunk !== undefined &&
      mouseCursor !== undefined &&
      annotation?.currentLevel?.items &&
      annotation.currentLevel.items.length > 0
    ) {
      audioTCalculator.audioPxWidth = audioPxW;
      const absXTime = !audioChunk.isPlaying
        ? mouseCursor.samples
        : audioChunk.absolutePlayposition.samples;
      let bWidthTime = audioTCalculator.absXtoSamples2(
        settings.boundaries.width * 2,
        audioChunk,
      );
      bWidthTime = Math.round(bWidthTime);

      if (annotation.currentLevel.items.length > 0 && !audioChunk.isPlaying) {
        for (i = 0; i < annotation.currentLevel.items.length; i++) {
          const segment = annotation.currentLevel.items[
            i
          ] as TrattAnnotationSegment;
          if (
            segment?.time !== undefined &&
            audioManager !== undefined &&
            segment.time.samples >= absXTime - bWidthTime &&
            segment.time.samples <= absXTime + bWidthTime &&
            segment.time.samples !== audioManager.resource.info.duration.samples
          ) {
            const segSamples = segment.time.samples;
            this.removeSegmentByIndex(
              annotation,
              i,
              silencePlaceholder,
              true,
              true,
              currentLevelChange,
              annotationChange,
            );

            return {
              type: 'remove',
              seg_samples: segSamples,
              seg_ID: segment.id,
              msg: {
                type: 'success',
                text: '',
              },
            };
          }
        }
      }

      const selection: number =
        drawnSelection !== undefined ? drawnSelection.length : 0;

      if (
        selection > 0 &&
        drawnSelection !== undefined &&
        absXTime >= drawnSelection.start.samples &&
        absXTime <= drawnSelection.end.samples
      ) {
        // some part selected
        const segm1 = betweenWhichSegment(
          annotation.currentLevel.items as TrattAnnotationSegment[],
          drawnSelection.start.samples,
        );
        const segm2 = betweenWhichSegment(
          annotation.currentLevel.items as TrattAnnotationSegment[],
          drawnSelection.end.samples,
        );

        if (
          drawnSelection !== undefined &&
          ((segm1 === undefined && segm2 === undefined) ||
            segm1 === segm2 ||
            (segm1 !== undefined &&
              segm2 !== undefined &&
              segm1.getFirstLabelWithoutName('Speaker')?.value === '' &&
              segm2.getFirstLabelWithoutName('Speaker')?.value === ''))
        ) {
          if (drawnSelection.start.samples > 0) {
            // prevent setting boundary if first sample selected
            this.addSegment(
              annotation,
              currentLevelChange,
              annotationChange,
              drawnSelection.start,
            );
          }

          this.addSegment(
            annotation,
            currentLevelChange,
            annotationChange,
            drawnSelection.end,
          );

          return {
            type: 'add',
            seg_samples: drawnSelection.start.samples,
            seg_ID: -1,
            msg: {
              type: 'success',
              text: '',
            },
          };
        } else {
          return {
            type: 'add',
            seg_samples: -1,
            seg_ID: -1,
            msg: {
              type: 'error',
              text: 'boundary cannot set',
            },
          };
        }
      } else {
        // no selection

        this.addSegment(
          annotation,
          currentLevelChange,
          annotationChange,
          audioManager!.createSampleUnit(Math.round(absXTime)),
        );

        return {
          type: 'add',
          seg_samples: absXTime,
          seg_ID: -1,
          msg: {
            type: 'success',
            text: '',
          },
        };
      }
    }
    return undefined;
  }

  /**
   * Diffs two annotation snapshots and returns the list of level/item/link
   * changes between them. Decomposed (task 13) into `collectIds`,
   * `diffLevels`, `diffItems`, `diffAddedItems` and `diffLinks` — the
   * original 296-line method mixed level, item and link comparisons in one
   * body; item comparison is nested inside the level loop (items are a
   * level's children) so `diffItems` is called from within `diffLevels`
   * rather than run as an independent top-level pass, while "added items on
   * existing levels" only becomes knowable once the whole level loop has
   * finished narrowing `state`, so that stays a separate step
   * (`diffAddedItems`) run once at the end. `diffLinks` is fully
   * independent of levels/items, so it stays a single top-level pass.
   */
  public getChanges(
    oldAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    newAnnotation: TrattAnnotation<TrattAnnotationSegment>,
  ): AnnotationChange[] {
    if (!oldAnnotation || !newAnnotation) {
      return [];
    }

    const result: AnnotationChange[] = [];
    const state: DiffIdState = {
      old: this.collectIds(oldAnnotation),
      new: this.collectIds(newAnnotation),
    };

    this.diffLevels(oldAnnotation, newAnnotation, state, result);
    this.diffAddedItems(newAnnotation, state, result);
    this.diffLinks(oldAnnotation, newAnnotation, state, result);

    return result;
  }

  /**
   * Reads every level/item/link ID out of an annotation. Used to seed the
   * "still unaccounted for" ID sets that diffLevels/diffItems/diffLinks
   * narrow down as they find matches, leaving only additions behind.
   */
  private collectIds(
    annotation: TrattAnnotation<TrattAnnotationSegment>,
  ): {
    levelIDs: number[];
    itemIDs: number[];
    linkIDs: number[];
  } {
    const idResult: {
      levelIDs: number[];
      itemIDs: number[];
      linkIDs: number[];
    } = {
      levelIDs: [],
      itemIDs: [],
      linkIDs: [],
    };

    // read level ids
    for (const level of annotation.levels) {
      idResult.levelIDs.push(level.id);
      for (const item of level.items) {
        idResult.itemIDs.push(item.id);
      }
    }

    // read link ids
    for (const link of annotation.links) {
      idResult.linkIDs.push(link.id);
    }

    return idResult;
  }

  /**
   * Iterates old levels: emits a 'remove' change for any old level with no
   * matching new level, otherwise delegates item comparison for the
   * matched pair to diffItems. After the loop, whatever level IDs remain
   * unmatched in state.new are levels that were added; items belonging to
   * a newly-added level are filtered out of state.new.itemIDs here (they're
   * already covered by the level's own 'add' change, not reported again
   * individually by diffAddedItems).
   */
  private diffLevels(
    oldAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    newAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    state: DiffIdState,
    result: AnnotationChange[],
  ): void {
    for (const oldAnnoLevel of oldAnnotation.levels) {
      const newLevel = newAnnotation.levels.find((a) => a.id === oldAnnoLevel.id);

      if (!newLevel) {
        // level was removed
        result.push({
          type: 'remove',
          level: {
            old: oldAnnoLevel,
            new: undefined,
          },
        });
      } else {
        this.diffItems(oldAnnoLevel, newLevel, state, result);

        state.old.levelIDs = state.old.levelIDs.filter(
          (a) => a !== oldAnnoLevel.id,
        );
        state.new.levelIDs = state.new.levelIDs.filter(
          (a) => a !== oldAnnoLevel.id,
        );
      }
    }
    if (state.new.levelIDs.length > 0) {
      // new levels added
      for (const id of state.new.levelIDs) {
        const level: TrattAnnotationAnyLevel<TrattAnnotationSegment> =
          newAnnotation.levels.find((a) => a.id === id)!;
        result.push({
          type: 'add',
          level: {
            old: undefined,
            new: level,
          },
        });

        state.new.itemIDs = state.new.itemIDs.filter(
          (a) => level.items.find((b) => b.id === a) === undefined,
        );
      }
    }
  }

  /**
   * Compares the items of one matched old/new level pair, pushing a
   * 'change' entry for items whose content differs (segment/event/item
   * type-specific isEqualWith, or a bare type-change) and a 'remove' entry
   * for items missing from the new level. Filters matched item IDs out of
   * `state` either way, so whatever's left in state.new.itemIDs after all
   * levels are processed represents additions (handled by
   * diffAddedItems).
   */
  private diffItems(
    oldLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>,
    newLevel: TrattAnnotationAnyLevel<TrattAnnotationSegment>,
    state: DiffIdState,
    result: AnnotationChange[],
  ): void {
    for (const item of oldLevel.items) {
      const found = newLevel.items.find((a) => a.id === item.id);

      if (found) {
        // compare changes
        if (item.type === found.type) {
          if (item.type === 'segment' && found.type === 'segment') {
            if (
              !(item as TrattAnnotationSegment).isEqualWith(
                found as TrattAnnotationSegment,
              )
            ) {
              // changed
              result.push({
                type: 'change',
                level: {
                  old: newLevel,
                  new: newLevel,
                },
                item: {
                  old: item,
                  new: found,
                },
              });
            }
            state.old.itemIDs = state.old.itemIDs.filter((a) => a !== item.id);
            state.new.itemIDs = state.new.itemIDs.filter((a) => a !== item.id);
          } else if (item.type === 'event' && found.type === 'event') {
            if (
              !(item as TrattAnnotationEvent).isEqualWith(
                found as TrattAnnotationEvent,
              )
            ) {
              // changed
              result.push({
                type: 'change',
                level: {
                  old: newLevel,
                  new: newLevel,
                },
                item: {
                  old: item,
                  new: found,
                },
              });
            }
            state.old.itemIDs = state.old.itemIDs.filter((a) => a !== item.id);
            state.new.itemIDs = state.new.itemIDs.filter((a) => a !== item.id);
          } else if (item.type === 'item' && found.type === 'item') {
            if (!(item as OItem).isEqualWith(found as OItem)) {
              // changed
              result.push({
                type: 'change',
                level: {
                  old: newLevel,
                  new: newLevel,
                },
                item: {
                  old: item,
                  new: found,
                },
              });
            }
            state.old.itemIDs = state.old.itemIDs.filter((a) => a !== item.id);
            state.new.itemIDs = state.new.itemIDs.filter((a) => a !== item.id);
          } else {
            throw new Error("Can't find correct item instance");
          }
        } else {
          // types changed
          result.push({
            type: 'change',
            level: {
              old: newLevel,
              new: newLevel,
            },
            item: {
              old: item,
              new: found,
            },
          });
          state.old.itemIDs = state.old.itemIDs.filter((a) => a !== item.id);
          state.new.itemIDs = state.new.itemIDs.filter((a) => a !== item.id);
        }
      } else {
        // newAnnotation doesn't have this item => was removed
        result.push({
          type: 'remove',
          item: {
            old: item,
            new: undefined,
          },
        });
        state.old.itemIDs = state.old.itemIDs.filter((a) => a !== item.id);
        state.new.itemIDs = state.new.itemIDs.filter((a) => a !== item.id);
      }
    }
  }

  /**
   * Whatever item IDs are still left in state.new.itemIDs once diffLevels
   * has finished are items present in newAnnotation that weren't matched
   * against any old item — i.e. items added to an existing level (items
   * belonging to a wholly new level were already filtered out by
   * diffLevels).
   */
  private diffAddedItems(
    newAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    state: DiffIdState,
    result: AnnotationChange[],
  ): void {
    if (state.new.itemIDs.length > 0) {
      // new items added
      for (const id of state.new.itemIDs) {
        let item: AnnotationAnySegment | undefined;
        const level: TrattAnnotationAnyLevel<TrattAnnotationSegment> =
          newAnnotation.levels.find((a) => {
            const found = a.items.find((b) => b.id === id);
            if (found) {
              item = found;
              return true;
            }
            return false;
          })!;

        result.push({
          type: 'add',
          item: {
            old: undefined,
            new: item,
          },
          level: {
            old: level,
            new: level,
          },
        });
      }
    }
  }

  /**
   * Diffs oldAnnotation.links against newAnnotation.links: 'change' for
   * links whose endpoints moved, and 'add' for links only present in
   * newAnnotation. Fully independent of the level/item diffing above.
   */
  private diffLinks(
    oldAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    newAnnotation: TrattAnnotation<TrattAnnotationSegment>,
    state: DiffIdState,
    result: AnnotationChange[],
  ): void {
    for (const link of oldAnnotation.links) {
      const found = newAnnotation.links.find((a) => a.id === link.id);
      if (found) {
        if (
          link.link.fromID !== found.link.fromID ||
          link.link.toID !== found.link.toID
        ) {
          // changed
          result.push({
            type: 'change',
            link: {
              old: link,
              new: found,
            },
          });
          state.old.linkIDs = state.old.linkIDs.filter((a) => a !== link.id);
          state.new.linkIDs = state.new.linkIDs.filter((a) => a !== link.id);
        }
      } else {
        // removed
        state.old.linkIDs = state.old.linkIDs.filter((a) => a !== link.id);
      }
    }

    if (state.new.linkIDs.length > 0) {
      for (const id of state.new.linkIDs) {
        const link: TrattAnnotationLink = newAnnotation.links.find(
          (a) => a.id === id,
        )!;
        result.push({
          type: 'add',
          link: {
            old: undefined,
            new: link,
          },
        });
      }
    }
  }
}
