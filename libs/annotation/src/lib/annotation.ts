import { SampleUnit } from '@tratt/media';
import {
  AnnotationLevelType,
  IItemLevel,
  OAnnotJSON,
  OEvent,
  OEventLevel,
  OItem,
  OItemLevel,
  OLabel,
  OLevel,
  OLink,
  OSegment,
  OSegmentLevel,
} from './annotjson';
import {
  AnnotationAnySegment,
  ASRContext,
  TrattAnnotationEvent,
  TrattAnnotationSegment,
} from './trattAnnotationSegment';

export class TrattAnnotationLink {
  get id(): number {
    return this._id;
  }

  get link(): OLink {
    return this._link;
  }

  constructor(
    private _id: number,
    private _link: OLink,
  ) {}

  clone() {
    return new TrattAnnotationLink(this._id, this._link.clone());
  }
}

export class TrattAnnotation<
  S extends ASRContext,
  T extends TrattAnnotationSegment<S>,
> {
  get selectedLevelIndex(): number | undefined {
    return this._selectedLevelIndex;
  }

  get links(): TrattAnnotationLink[] {
    return this._links;
  }

  get levels(): TrattAnnotationAnyLevel<T>[] {
    return this._levels;
  }

  get idCounters(): {
    item: number;
    level: number;
    link: number;
  } {
    return this._idCounters;
  }

  private _levels: TrattAnnotationAnyLevel<T>[] = [];
  private _links: TrattAnnotationLink[] = [];

  private _idCounters: {
    level: number;
    link: number;
    item: number;
  } = {
    level: 1,
    link: 1,
    item: 1,
  };

  private _selectedLevelIndex?: number;

  public get currentLevel(): TrattAnnotationAnyLevel<T> | undefined {
    if (this._selectedLevelIndex !== undefined) {
      return this._levels[this._selectedLevelIndex];
    }
    return undefined;
  }

  constructor(
    levels?: TrattAnnotationAnyLevel<T>[],
    links?: TrattAnnotationLink[],
    idCounters?: {
      level: number;
      link: number;
      item: number;
    },
  ) {
    this._levels = levels ?? [];
    this._links = links ?? [];

    if (idCounters) {
      this._idCounters = idCounters;
    } else {
      this.updateIDCounters();
    }
  }

  public updateIDCounters() {
    this.idCounters.item = Math.max(
      1,
      ...this.levels.map((a) => {
        if (
          a instanceof TrattAnnotationSegmentLevel ||
          a instanceof TrattAnnotationEventLevel
        ) {
          return Math.max(0, ...a.items.map((b) => b.id)) + 1;
        }
        return 1;
      }),
    );
    this.idCounters.link = Math.max(0, ...this.links.map((a) => a.id)) + 1;
    this.idCounters.level = Math.max(0, ...this.levels.map((a) => a.id)) + 1;
  }

  public changeLevelIndex(index: number) {
    this._selectedLevelIndex = index;
    return this;
  }

  createSegmentLevel(
    name: string,
    items?: T[],
  ): TrattAnnotationSegmentLevel<T> {
    return new TrattAnnotationSegmentLevel<T>(
      this._idCounters.level++,
      name,
      items,
    );
  }

  getItemById(id: number): AnnotationAnySegment | undefined {
    for (const level of this._levels) {
      const found = level.items.find((a) => a.id === id);
      if (found) {
        return found as AnnotationAnySegment;
      }
    }
    return undefined;
  }

  clearAllItemsFromCurrentLevel() {
    if (this.currentLevel) {
      this.currentLevel.clear();
    }
    return this;
  }

  createEventLevel(
    name: string,
    items: TrattAnnotationEvent[],
  ): TrattAnnotationEventLevel {
    return new TrattAnnotationEventLevel(this._idCounters.level++, name, items);
  }

  createItemLevel(name: string, items: OItem[]): TrattAnnotationItemLevel {
    return new TrattAnnotationItemLevel(this._idCounters.level++, name, items);
  }

  createSegment(time: SampleUnit, labels?: OLabel[], context?: S) {
    return new TrattAnnotationSegment<ASRContext>(
      this._idCounters.item++,
      time,
      labels,
      context,
    );
  }

  addLevel(level: TrattAnnotationAnyLevel<T>) {
    this._levels.push(level);
    return this;
  }

  duplicateLevel(index: number) {
    if (index > -1 && index < this._levels.length) {
      const level = this._levels[index];
      const duplicate = level.duplicate(
        this._idCounters.level++,
        this._idCounters.item,
      );

      this._levels = [
        ...this._levels.slice(0, index + 1),
        duplicate as TrattAnnotationAnyLevel<T>,
        ...this._levels.slice(index + 1),
      ];

      return this;
    } else {
      throw new Error(`Can't find level with index ${index}`);
    }
  }

  removeLevel(id: number) {
    const index = this.levels.findIndex((a) => a.id === id);

    if (this.selectedLevelIndex === index) {
      if (
        this._selectedLevelIndex !== undefined &&
        this._selectedLevelIndex > 0
      ) {
        this.changeCurrentLevelIndex(index - 1);
      } else {
        if (this._selectedLevelIndex === 0 && this._levels.length === 1) {
          this._selectedLevelIndex = undefined;
        }
      }
    }
    this._levels = this._levels.filter((a) => a.id !== id);
    return this;
  }

  changeLevelById(id: number, level: TrattAnnotationAnyLevel<T>) {
    const index = this._levels.findIndex((a) => a.id === id);
    if (index > -1) {
      this._levels[index] = level;
    } else {
      throw new Error(`Can't find level with id ${id}`);
    }
    return this;
  }

  changeLevelByIndex(index: number, level: TrattAnnotationAnyLevel<T>) {
    if (index > -1 && index < this._levels.length) {
      this._levels[index] = level;
    } else {
      throw new Error(`Can't find level with index ${index}`);
    }
    return this;
  }

  changeLevelNameByIndex(index: number, name: string) {
    if (index > -1 && index < this._levels.length) {
      this._levels[index].name = name;
    } else {
      throw new Error(`Can't find level with index ${index}`);
    }
    return this;
  }

  changeCurrentLevelIndex(index: number) {
    if (index > -1 && index < this._levels.length) {
      this._selectedLevelIndex = index;
    }
    return this;
  }

  changeCurrentItemById(id: number, item: OItem | OEvent | T) {
    if (this.currentLevel) {
      const index = this.currentLevel.items.findIndex((a) => a.id === id);
      if (index > -1) {
        return this.changeCurrentItemByIndex(index, item);
      }
    } else {
      throw new Error('Current level not selected');
    }
    return this;
  }

  changeCurrentItemByIndex(index: number, item: OItem | OEvent | T) {
    if (!this.currentLevel) {
      throw new Error('Current level not selected');
    }
    if (index < 0) {
      return this;
    }

    const curr = this.currentLevel;

    // Linked-tier guard + source→linked time mirror (segment levels only).
    if (curr instanceof TrattAnnotationSegmentLevel) {
      const prev = curr.items[index] as TrattAnnotationSegment | undefined;
      const prevSamples = prev?.time.samples;
      const newSamples = (item as any)?.time?.samples as number | undefined;
      const boundaryChanged =
        prevSamples !== undefined &&
        newSamples !== undefined &&
        newSamples !== prevSamples;

      if (curr.linkedToLevelId !== undefined && boundaryChanged) {
        console.warn(
          `Cannot move segment boundary on linked level "${curr.name}". Detach the level first to edit boundaries.`,
        );
        return this;
      }

      curr.changeItem(item as any);

      if (
        curr.linkedToLevelId === undefined &&
        boundaryChanged &&
        (item as any).time
      ) {
        const newTime = (item as any).time as SampleUnit;
        for (const linked of this.getLinkedLevelsOf(curr.id)) {
          if (index < linked.items.length) {
            const linkedItem = linked.items[index] as TrattAnnotationSegment;
            const updated = linkedItem.clone() as T;
            updated.time = newTime;
            linked.changeItem(updated as any);
          }
        }
      }
      return this;
    }

    this.currentLevel.changeItem(item as any);
    return this;
  }

  /**
   * Returns all segment levels linked to the given source level id. Used to
   * mirror boundary edits, inserts, and removes from a source tier to all
   * translation tiers derived from it.
   */
  private getLinkedLevelsOf(
    sourceId: number,
  ): TrattAnnotationSegmentLevel<T>[] {
    return this._levels.filter(
      (l) =>
        l instanceof TrattAnnotationSegmentLevel &&
        l.linkedToLevelId === sourceId,
    ) as TrattAnnotationSegmentLevel<T>[];
  }

  getCurrentSegmentIndexBySamplePosition(samples: SampleUnit): number {
    if (
      !this.currentLevel ||
      !(this.currentLevel instanceof TrattAnnotationSegmentLevel)
    ) {
      return -1;
    }

    let begin = 0;
    for (let i = 0; i < this.currentLevel.items.length; i++) {
      if (i > 0) {
        begin = this.currentLevel.items[i - 1].time.samples;
      }
      if (
        samples.samples > begin &&
        samples.samples <= this.currentLevel.items[i].time.samples
      ) {
        return i;
      }
    }
    return -1;
  }

  changeCurrentSegmentBySamplePosition(samples: SampleUnit, item: T) {
    const index = this.getCurrentSegmentIndexBySamplePosition(samples);
    if (index > -1) {
      return this.changeCurrentItemByIndex(index, item);
    }
    throw new Error(`Can't find segment at sample position ${samples.samples}`);
  }

  addItemToCurrentLevel(time?: SampleUnit, labels?: OLabel[], context?: S) {
    if (this.currentLevel) {
      if (
        this.currentLevel instanceof TrattAnnotationSegmentLevel &&
        this.currentLevel.linkedToLevelId !== undefined
      ) {
        console.warn(
          `Cannot add segment to linked level "${this.currentLevel.name}". Detach the level first to make it standalone.`,
        );
        return this;
      }
      if (this.currentLevel.type === 'SEGMENT') {
        const level = this.currentLevel as TrattAnnotationSegmentLevel<T>;
        this.insertSegmentIntoLevel(level, time!, labels, context);
        for (const linked of this.getLinkedLevelsOf(level.id)) {
          this.insertSegmentIntoLevel(linked, time!);
        }
      } else if (this.currentLevel.type === 'ITEM') {
        this.currentLevel.overwriteItems([
          ...this.currentLevel.items,
          new OItem(this.idCounters.item++, labels) as any,
        ]);
      } else {
        const newEvents = [
          ...this.currentLevel.items,
          new OEvent(this.idCounters.item++, time!.samples!, labels) as any,
        ];
        newEvents.sort(this.sortEventsBySampleUnit);
        this.currentLevel.overwriteItems(newEvents);
      }
    }

    return this;
  }

  removeItemByIndex(
    index: number,
    silenceValue?: string,
    mergeTranscripts?: boolean,
    changeTranscript?: (transcript: string) => string,
  ) {
    if (!this.currentLevel) {
      throw new Error('Current level is undefined');
    }

    if (
      this.currentLevel instanceof TrattAnnotationSegmentLevel &&
      this.currentLevel.linkedToLevelId !== undefined
    ) {
      console.warn(
        `Cannot remove segment from linked level "${this.currentLevel.name}". Detach the level first to make it standalone.`,
      );
      return this;
    }

    if (
      this._selectedLevelIndex !== undefined &&
      this._selectedLevelIndex !== null &&
      index > -1 &&
      index < this.currentLevel.items.length
    ) {
      if (this.currentLevel.type === 'SEGMENT') {
        const level = this.currentLevel as TrattAnnotationSegmentLevel<T>;
        this.removeSegmentFromLevel(
          level,
          index,
          silenceValue,
          mergeTranscripts,
          changeTranscript,
        );
        for (const linked of this.getLinkedLevelsOf(level.id)) {
          this.removeSegmentFromLevel(
            linked,
            index,
            silenceValue,
            mergeTranscripts,
            undefined,
          );
        }
      } else {
        this.currentLevel.overwriteItems([
          ...this.currentLevel.items.slice(0, index),
          ...this.currentLevel.items.slice(index + 1),
        ] as any);
      }
    }

    return this;
  }

  removeItemById(
    id: number,
    silenceCode?: string,
    mergeTranscripts?: boolean,
    changeTranscript?: (transcript: string) => string,
  ) {
    const index = this.currentLevel?.items.findIndex((a) => a.id === id);
    if (index !== undefined && index > -1) {
      return this.removeItemByIndex(
        index,
        silenceCode,
        mergeTranscripts,
        changeTranscript,
      );
    } else {
      throw new Error(`Can't find item with id ${id}`);
    }

    return this;
  }

  addLink(fromID: number, toID: number) {
    this._links.push(
      new TrattAnnotationLink(this.idCounters.link++, new OLink(fromID, toID)),
    );
  }

  changeLinkById(id: number, oLink: OLink) {
    const index = this._links.findIndex((a) => a.id === id);
    if (index > -1) {
      this._links[index] = new TrattAnnotationLink(id, oLink);
    } else {
      throw new Error(`Can't find link with id ${id}`);
    }
  }

  changeLinkByIndex(index: number, oLink: OLink) {
    if (index > -1) {
      this._links[index] = new TrattAnnotationLink(
        this._links[index].id,
        oLink,
      );
    } else {
      throw new Error(`Can't find link with index ${index}`);
    }
  }

  private insertSegmentIntoLevel(
    level: TrattAnnotationSegmentLevel<T>,
    time: SampleUnit,
    labels?: OLabel[],
    context?: S,
  ) {
    let items: T[] = level.items.map((a) => a.clone() as T);

    if (items.length > 0) {
      const index = items.findIndex((a) => a.time.samples > time.samples);
      if (index > -1) {
        const oldLabels =
          index === 0 ? [new OLabel(level.name, '')] : [...items[index].labels];
        items[index].labels =
          index === 0 ? items[index].labels : [new OLabel(level.name, '')];
        items = [
          ...items,
          new TrattAnnotationSegment(
            this.idCounters.item++,
            time,
            labels && labels.length > 0 ? labels : oldLabels,
            context ?? ({} as any),
          ) as any,
        ];
        items.sort(this.sortSegmentsBySampleUnit);
      }
    } else {
      items.push(
        new TrattAnnotationSegment(
          this.idCounters.item++,
          time,
          labels,
          context ?? ({} as any),
        ) as any,
      );
    }
    level.overwriteItems(items as any);
  }

  private removeSegmentFromLevel(
    level: TrattAnnotationSegmentLevel<T>,
    index: number,
    silenceValue?: string,
    mergeTranscripts?: boolean,
    changeTranscript?: (transcript: string) => string,
  ) {
    if (index < 0 || index >= level.items.length) {
      return;
    }

    if (index < level.items.length - 1) {
      const nextSegment = level.items[index + 1] as TrattAnnotationSegment;
      let transcript = (
        level.items[index] as TrattAnnotationSegment
      ).getFirstLabelWithoutName('Speaker')?.value;

      if (
        !silenceValue ||
        (nextSegment.getFirstLabelWithoutName('Speaker')?.value !==
          silenceValue &&
          transcript !== silenceValue &&
          mergeTranscripts)
      ) {
        if (
          nextSegment.getFirstLabelWithoutName('Speaker') &&
          transcript !== ''
        ) {
          transcript =
            transcript +
            ' ' +
            nextSegment.getFirstLabelWithoutName('Speaker')?.value;
          if (changeTranscript) {
            transcript = changeTranscript(transcript);
          }
          nextSegment.changeFirstLabelWithoutName('Speaker', transcript);
        } else if (
          !nextSegment.getFirstLabelWithoutName('Speaker') &&
          transcript !== ''
        ) {
          transcript = transcript ?? '';
          if (changeTranscript) {
            transcript = changeTranscript(transcript);
          }
          nextSegment.changeFirstLabelWithoutName('Speaker', transcript);
        }
      } else if (
        silenceValue &&
        nextSegment.getFirstLabelWithoutName('Speaker')?.value === silenceValue
      ) {
        transcript = transcript ?? '';
        if (changeTranscript) {
          transcript = changeTranscript(transcript);
        }
        nextSegment.changeFirstLabelWithoutName('Speaker', transcript);
      }
      level.changeItem(nextSegment as any);
    }

    level.overwriteItems([
      ...level.items.slice(0, index),
      ...level.items.slice(index + 1),
    ] as any);
  }

  private sortSegmentsBySampleUnit(a: T, b: T) {
    if (a.time.samples > b.time.samples) {
      return 1;
    } else if (a.time.samples < b.time.samples) {
      return -1;
    }
    return 0;
  }

  private sortEventsBySampleUnit(a: OEvent, b: OEvent) {
    if (a.samplePoint > b.samplePoint) {
      return 1;
    } else if (a.samplePoint < b.samplePoint) {
      return -1;
    }
    return 0;
  }

  deserialize(jsonObject: OAnnotJSON): TrattAnnotation<S, T> {
    return TrattAnnotation.deserialize(jsonObject);
  }

  changeSampleRate(sampleRate: number) {
    const levels = this._levels.map((level, i) => {
      if (level.type === 'SEGMENT') {
        return new TrattAnnotationSegmentLevel<
          TrattAnnotationSegment<ASRContext>
        >(
          level.id,
          level.name,
          (level.items as TrattAnnotationSegment<ASRContext>[]).map(
            (a) =>
              new TrattAnnotationSegment<ASRContext>(
                a.id,
                new SampleUnit(a.time.samples, sampleRate),
                a.labels,
                a.context,
              ),
          ),
        );
      } else if (level.type === 'EVENT') {
        return new TrattAnnotationEventLevel(
          level.id,
          level.name,
          (level.items as TrattAnnotationEvent[]).map(
            (a) =>
              new TrattAnnotationEvent(
                a.id,
                new SampleUnit(a.samplePoint.samples, a.samplePoint.sampleRate),
                a.labels,
              ),
          ),
        );
      }
      return level;
    }) as any;

    const result = new TrattAnnotation(
      levels,
      this._links.map((a) => a.clone()),
      this.idCounters,
    );
    result.changeCurrentLevelIndex(this._selectedLevelIndex!);
    return result;
  }

  serialize(
    mediaFileName: string,
    sampleRate: number,
    lastSegmentTime: SampleUnit,
  ): OAnnotJSON {
    return new OAnnotJSON(
      mediaFileName,
      mediaFileName.replace(/\.[^.]+$/g, ''),
      sampleRate,
      this.levels.map((a) => {
        const result = a.serialize();

        if (a.type === 'SEGMENT') {
          const lastItem = result.items[result.items.length - 1];
          if (
            lastItem.sampleStart + lastItem.sampleDur <
            lastSegmentTime.samples
          ) {
            result.items.push(
              this.createSegment(lastSegmentTime, [new OLabel(a.name, '')]),
            );
          }
          // Resolve linkedToLevelId → linkedToLevelName for round-trip.
          if (
            a instanceof TrattAnnotationSegmentLevel &&
            a.linkedToLevelId !== undefined
          ) {
            const source = this._levels.find((l) => l.id === a.linkedToLevelId);
            if (source) {
              (result as any).linkedToLevelName = source.name;
            }
          }
        }

        return result;
      }),
      this.links.map((a) => a.link.serialize()),
    );
  }

  static deserialize<S extends ASRContext, T extends TrattAnnotationSegment<S>>(
    jsonObject: OAnnotJSON,
  ): TrattAnnotation<S, T> {
    const result = new TrattAnnotation<S, T>();

    for (const jsonObjectElement of jsonObject.levels) {
      if (jsonObjectElement.type === AnnotationLevelType.SEGMENT) {
        const level = jsonObjectElement as OSegmentLevel<OSegment>;
        const segmentLevel = result.createSegmentLevel(
          level.name,
          level.items.map((a) =>
            TrattAnnotationSegment.deserializeFromOSegment(
              a,
              jsonObject.sampleRate,
            ),
          ) as T[],
        );
        // Carry link metadata; linkedToLevelName is resolved to id below
        // after all levels exist.
        (segmentLevel as any)._linkedToLevelNamePending =
          level.linkedToLevelName;
        segmentLevel.linkedKind = level.linkedKind;
        result.levels.push(segmentLevel);
      } else if (jsonObjectElement.type === AnnotationLevelType.EVENT) {
        const level = jsonObjectElement as OEventLevel;
        result.levels.push(
          result.createEventLevel(
            level.name,
            level.items.map(
              (a) =>
                new TrattAnnotationEvent(
                  a.id,
                  new SampleUnit(a.samplePoint, jsonObject.sampleRate),
                  a.labels,
                ),
            ),
          ),
        );
      } else {
        result.levels.push(
          result.createItemLevel(
            jsonObjectElement.name,
            jsonObjectElement.items,
          ),
        );
      }
    }

    for (const link of jsonObject.links) {
      result.addLink(link.fromID, link.toID);
    }

    // Resolve pending linkedToLevelName references → linkedToLevelId now that
    // every level has its final id assigned.
    for (const lvl of result.levels) {
      if (lvl instanceof TrattAnnotationSegmentLevel) {
        const pending = (lvl as any)._linkedToLevelNamePending as
          | string
          | undefined;
        if (pending) {
          const source = result.levels.find((l) => l.name === pending);
          if (source) {
            lvl.linkedToLevelId = source.id;
          }
        }
        delete (lvl as any)._linkedToLevelNamePending;
      }
    }

    result.updateIDCounters();
    return result;
  }

  clone() {
    const result = new TrattAnnotation([], [], {
      ...this._idCounters,
    });

    const levels = this.levels.map((a) => a.clone());
    const links = this.links.map((a) => a.clone());
    result.links.push(...links);
    result.levels.push(...levels);
    result.changeCurrentLevelIndex(this._selectedLevelIndex ?? -1);

    return result;
  }
}

export class TrattAnnotationLevel<T extends OLevel<S>, S extends OItem> {
  get sortorder(): number {
    return this._sortorder;
  }

  get id(): number {
    return this._id;
  }

  get items(): S[] {
    return this.level.items;
  }

  get name(): string {
    return this.level.name;
  }

  set name(value: string) {
    this.level.name = value;
  }

  private _sortorder = 0;

  level: T;

  public get type() {
    return this.level.type;
  }

  clear() {
    this.level.items = [];
  }

  constructor(
    protected _id: number,
    level: T,
  ) {
    this.level = level;
  }

  overwriteItems(items: S[]) {
    this.level.items = items;
  }

  duplicate(id: number, itemIDCounter: number): TrattAnnotationLevel<T, S> {
    const result = new TrattAnnotationLevel<T, S>(
      id,
      new OLevel<S>(this.level.name + '_2', this.level.type, [
        ...this.level.items.map((a) => {
          return a.clone(itemIDCounter++) as S;
        }),
      ]) as T,
    );
    return result;
  }

  serialize(): IItemLevel {
    return {
      items: this.level.items.map((a) => a.serialize()),
      name: this.level.name,
      type: this.type,
    };
  }

  changeItem(item: S) {
    const index = this.items.findIndex((a) => a.id === item.id);
    if (index > -1) {
      this.level.items = [
        ...this.level.items.slice(0, index),
        item,
        ...this.level.items.slice(index + 1),
      ];
    } else {
      throw new Error(`Can't change item with id ${item.id}: not found.`);
    }

    return this;
  }

  getLeftSibling(index: number) {
    return this.level.getLeftSibling(index);
  }

  getRightSibling(index: number) {
    return this.level.getRightSibling(index);
  }
}

export class TrattAnnotationSegmentLevel<
  T extends TrattAnnotationSegment<ASRContext>,
> extends TrattAnnotationLevel<OLevel<T>, T> {
  /**
   * Id of the source level this level is linked to. When set, this level
   * mirrors source segment boundaries and shares Speaker labels with the
   * source via the speaker-sync hook in {@link SpeakerManagementService}.
   * Resolved from {@link ISegmentLevel.linkedToLevelName} on deserialize.
   */
  linkedToLevelId?: number;
  linkedKind?: string;

  constructor(
    id: number,
    name: string,
    items?: T[],
    linkedToLevelId?: number,
    linkedKind?: string,
  ) {
    super(id, new OLevel<T>(name, AnnotationLevelType.SEGMENT, items));
    this.linkedToLevelId = linkedToLevelId;
    this.linkedKind = linkedKind;
  }

  override serialize(): any {
    let start = 0;
    const res: any = {
      items: this.level.items.map((a) => {
        const result = a.serializeToOSegment(start);
        start = a.time.samples;

        return result;
      }),
      name: this.level.name,
      type: this.type,
    };
    if (this.linkedKind !== undefined) {
      res.linkedKind = this.linkedKind;
    }
    // linkedToLevelName is resolved by TrattAnnotation.serialize() which has access to all levels
    return res;
  }

  clone() {
    return new TrattAnnotationSegmentLevel<T>(
      this._id,
      this.name,
      this.level.items.map((a) => a.clone() as any),
      this.linkedToLevelId,
      this.linkedKind,
    );
  }

  override duplicate(
    id: number,
    itemIDCounter: number,
  ): TrattAnnotationSegmentLevel<T> {
    return new TrattAnnotationSegmentLevel<T>(
      id,
      `${this.name}_2`,
      this.items.map(
        (a) =>
          new TrattAnnotationSegment<ASRContext>(
            itemIDCounter++,
            a.time,
            [...a.labels],
            { ...a.context },
          ) as T,
      ),
    );
    // Note: duplicate() intentionally drops linkedToLevelId — a duplicated
    // tier is a fresh standalone copy.
  }
}

export class TrattAnnotationItemLevel extends TrattAnnotationLevel<
  OItemLevel,
  OItem
> {
  constructor(id: number, name: string, items?: OItem[]) {
    super(id, new OItemLevel(name, items));
  }

  override serialize(): IItemLevel {
    return {
      items: this.level.items.map((a) => a.serialize()),
      name: this.level.name,
      type: this.type,
    };
  }

  clone() {
    return new TrattAnnotationItemLevel(
      this.id,
      this.name,
      this.items.map((a) => a.clone()),
    );
  }

  override duplicate(
    id: number,
    itemIDCounter: number,
  ): TrattAnnotationItemLevel {
    return new TrattAnnotationItemLevel(
      id,
      `${this.name}_2`,
      this.items.map((a) => new OItem(itemIDCounter++, [...a.labels])),
    );
  }
}

export class TrattAnnotationEventLevel {
  id!: number;
  name!: string;
  items!: TrattAnnotationEvent[];
  type = AnnotationLevelType.EVENT;

  constructor(id: number, name: string, items?: TrattAnnotationEvent[]) {
    this.id = id;
    this.name = name;
    this.items = items ?? [];
  }

  overwriteItems(items: TrattAnnotationEvent[]) {
    this.items = items;
  }

  serialize(): OEventLevel {
    return new OEventLevel(
      this.name,
      this.items.map((a) => new OEvent(a.id, a.samplePoint.samples, a.labels)),
    );
  }

  clone() {
    return new TrattAnnotationEventLevel(
      this.id,
      this.name,
      this.items.map((a) => a.clone()),
    );
  }

  clear() {
    this.items = [];
  }

  duplicate(id: number, itemIDCounter: number): TrattAnnotationEventLevel {
    const result = new TrattAnnotationEventLevel(
      id,
      this.name + '_2',
      this.items.map((a) => {
        return a.clone(itemIDCounter++);
      }),
    );
    return result;
  }

  changeItem(item: TrattAnnotationEvent) {
    const index = this.items.findIndex((a) => a.id === item.id);
    if (index > -1) {
      this.items = [
        ...this.items.slice(0, index),
        item,
        ...this.items.slice(index + 1),
      ];
    } else {
      throw new Error(`Can't change item with id ${item.id}: not found.`);
    }

    return this;
  }

  getLeftSibling(item: TrattAnnotationEvent) {
    const index = this.items.findIndex((a) => a.id === item.id);
    return index > 0 ? this.items[index - 1] : undefined;
  }

  getRightSibling(item: TrattAnnotationEvent) {
    const index = this.items.findIndex((a) => a.id === item.id);
    return index > -1 && index < this.items.length - 1
      ? this.items[index + 1]
      : undefined;
  }
}

export type TrattAnnotationAnyLevel<
  T extends TrattAnnotationSegment<ASRContext>,
> =
  | TrattAnnotationSegmentLevel<T>
  | TrattAnnotationItemLevel
  | TrattAnnotationEventLevel;
