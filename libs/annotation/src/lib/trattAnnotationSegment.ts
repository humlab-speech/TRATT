import { SampleUnit } from '@tratt/media';
import { Serializable } from '@tratt/utilities';
import { ISegment, OItem, OLabel, OSegment } from './annotjson';
import { ASRQueueItemType } from './asr';

export interface SegmentWithContext<T extends ASRContext> {
  id: number;
  labels: OLabel[];
  time: SampleUnit;
  context?: T;
}

export interface ASRContext {
  asr?: {
    isBlockedBy?: ASRQueueItemType;
    progressInfo?: { progress: number; statusLabel: string };
  };
}

export class TrattAnnotationEvent
  implements Serializable<TrattAnnotationEvent, TrattAnnotationEvent>
{
  public readonly type: 'segment' | 'event' | 'item' = 'event';
  id!: number;
  samplePoint!: SampleUnit;
  labels: OLabel[] = [];

  constructor(id: number, samplePoint: SampleUnit, labels?: OLabel[]) {
    this.id = id;
    this.samplePoint = samplePoint;
    this.labels = labels ?? [];
  }

  serialize(): TrattAnnotationEvent {
    return new TrattAnnotationEvent(this.id, this.samplePoint, this.labels);
  }

  deserialize(jsonObject: TrattAnnotationEvent): TrattAnnotationEvent {
    return TrattAnnotationEvent.deserialize(jsonObject);
  }

  static deserialize<T extends ASRContext>(
    jsonObject: TrattAnnotationEvent,
  ): TrattAnnotationEvent {
    return jsonObject;
  }

  clone(id?: number) {
    return new TrattAnnotationEvent(id ?? this.id, this.samplePoint.clone(), [
      ...this.labels,
    ]);
  }

  getFirstLabelWithoutName(notName: string) {
    return this.labels?.find((a) => a.name !== notName);
  }

  isEqualWith(other: TrattAnnotationEvent): boolean {
    if (!other) {
      return false;
    }

    let labelsEqual = true;

    if (this.labels.length === other.labels.length) {
      for (const label of this.labels) {
        const found = other.labels.find((a) => a.name === label.name);
        if (!found || found.value !== label.value) {
          labelsEqual = false;
          break;
        }
      }
    } else {
      labelsEqual = false;
    }

    return (
      other &&
      this.id === other.id &&
      this.samplePoint === other.samplePoint &&
      labelsEqual
    );
  }
}

export class TrattAnnotationSegment<T extends ASRContext = ASRContext>
  implements
    SegmentWithContext<T>,
    Serializable<SegmentWithContext<T>, TrattAnnotationSegment<T>>
{
  public readonly type: 'segment' | 'event' | 'item' = 'segment';

  get id(): number {
    return this._id;
  }

  public context?: T;
  public time: SampleUnit;

  private _id: number;
  public labels: OLabel[];

  constructor(id: number, time: SampleUnit, labels?: OLabel[], context?: T) {
    this.time = time;
    this._id = id;
    this.labels = labels ?? [];
    this.context = context;
    console.log(
      `Created segment with id ${this._id} at time ${this.time.samples}`,
    );
  }

  serialize(): SegmentWithContext<T> {
    return {
      id: this.id,
      time: this.time,
      labels: this.labels,
      context: this.context,
    };
  }

  serializeToOSegment(sampleStart: number): OSegment {
    return new OSegment(
      this.id,
      sampleStart,
      this.time.samples - sampleStart,
      this.labels,
    );
  }

  deserialize(jsonObject: SegmentWithContext<T>): TrattAnnotationSegment<T> {
    return TrattAnnotationSegment.deserialize(jsonObject);
  }

  getLabel(name: string) {
    return this.labels?.find((a) => a.name === name);
  }

  getFirstLabelWithoutName(notName: string) {
    return this.labels?.find((a) => a.name !== notName);
  }

  changeLabel(name: string, value: string) {
    const index = this.labels.findIndex((a) => a.name === name);
    if (index > -1) {
      this.labels = [
        ...this.labels.slice(0, index),
        new OLabel(this.labels[index].name, value),
        ...this.labels.slice(index + 1),
      ];
      return true;
    }
    return false;
  }

  changeFirstLabelWithoutName(notName: string, value: string) {
    const index = this.labels.findIndex((a) => a.name !== notName);
    if (index > -1) {
      this.labels = [
        ...this.labels.slice(0, index),
        new OLabel(this.labels[index].name, value),
        ...this.labels.slice(index + 1),
      ];
      return true;
    }
    return false;
  }

  static deserialize<T extends ASRContext>(
    jsonObject: SegmentWithContext<T>,
  ): TrattAnnotationSegment<T> {
    const result = new TrattAnnotationSegment<T>(
      jsonObject.id,
      jsonObject.time,
      jsonObject.labels.map((a) => OLabel.deserialize(a)),
      jsonObject.context,
    );
    return result;
  }

  static deserializeFromOSegment<T extends ASRContext>(
    jsonObject: ISegment,
    sampleRate: number,
    context?: T,
  ): TrattAnnotationSegment<T> {
    return new TrattAnnotationSegment<T>(
      jsonObject.id,
      new SampleUnit(jsonObject.sampleStart + jsonObject.sampleDur, sampleRate),
      jsonObject.labels.map((a) => OLabel.deserialize(a)),
      context,
    );
  }

  clone(id?: number): TrattAnnotationSegment<T> {
    return new TrattAnnotationSegment<T>(
      id ?? this._id,
      this.time,
      [...this.labels],
      {
        ...this.context,
      } as any,
    );
  }

  isEqualWith(other: TrattAnnotationSegment<T>) {
    let labelsEqual = true;

    if (this.labels.length === other.labels.length) {
      for (const label of this.labels) {
        const found = other.labels.find((a) => a.name === label.name);
        if (!found || found.value !== label.value) {
          labelsEqual = false;
          break;
        }
      }
    } else {
      labelsEqual = false;
    }

    return (
      this._id === other.id &&
      this.time.equals(other.time) &&
      JSON.stringify(this.context ?? {}) ==
        JSON.stringify(other.context ?? {}) &&
      labelsEqual
    );
  }
}

export type AnnotationAnySegment =
  | TrattAnnotationSegment<ASRContext>
  | OItem
  | TrattAnnotationEvent;
