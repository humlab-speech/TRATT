import { SampleUnit } from '@tratt/media';
import { Serializable } from '@tratt/utilities';
import { ISegment, OItem, OLabel, OSegment } from './annotjson';

export interface SegmentWithContext {
  id: number;
  labels: OLabel[];
  time: SampleUnit;
  /**
   * Whether a human has verified the transcription of this segment (listened
   * to its part of the recording, or edited the text). Missing on legacy
   * state = treated as verified.
   */
  verified?: boolean;
}

export class TrattAnnotationEvent implements Serializable<
  TrattAnnotationEvent,
  TrattAnnotationEvent
> {
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

  static deserialize(jsonObject: TrattAnnotationEvent): TrattAnnotationEvent {
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

export class TrattAnnotationSegment
  implements
    SegmentWithContext,
    Serializable<SegmentWithContext, TrattAnnotationSegment>
{
  public readonly type: 'segment' | 'event' | 'item' = 'segment';

  get id(): number {
    return this._id;
  }

  public time: SampleUnit;

  private _id: number;
  public labels: OLabel[];
  /**
   * Whether a human has verified this segment's transcription: listened to
   * this part of the recording, or edited the text. Automatically produced
   * transcription starts `false`; manual text and legacy data default `true`.
   */
  public verified: boolean;

  constructor(
    id: number,
    time: SampleUnit,
    labels?: OLabel[],
    verified = true,
  ) {
    this.time = time;
    this._id = id;
    this.labels = labels ?? [];
    this.verified = verified;
  }

  serialize(): SegmentWithContext {
    return {
      id: this.id,
      time: this.time,
      labels: this.labels,
      verified: this.verified,
    };
  }

  serializeToOSegment(sampleStart: number): OSegment {
    return new OSegment(
      this.id,
      sampleStart,
      this.time.samples - sampleStart,
      this.labels,
      this.verified,
    );
  }

  deserialize(jsonObject: SegmentWithContext): TrattAnnotationSegment {
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

  static deserialize(jsonObject: SegmentWithContext): TrattAnnotationSegment {
    const result = new TrattAnnotationSegment(
      jsonObject.id,
      jsonObject.time,
      jsonObject.labels.map((a) => OLabel.deserialize(a)),
      jsonObject.verified ?? true,
    );
    return result;
  }

  static deserializeFromOSegment(
    jsonObject: ISegment,
    sampleRate: number,
  ): TrattAnnotationSegment {
    return new TrattAnnotationSegment(
      jsonObject.id,
      new SampleUnit(jsonObject.sampleStart + jsonObject.sampleDur, sampleRate),
      jsonObject.labels.map((a) => OLabel.deserialize(a)),
      jsonObject.verified ?? true,
    );
  }

  clone(id?: number): TrattAnnotationSegment {
    return new TrattAnnotationSegment(
      id ?? this._id,
      this.time,
      [...this.labels],
      this.verified,
    );
  }

  isEqualWith(other: TrattAnnotationSegment) {
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
      this.verified === other.verified &&
      labelsEqual
    );
  }
}

export type AnnotationAnySegment =
  TrattAnnotationSegment | OItem | TrattAnnotationEvent;
