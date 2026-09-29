import { hasProperty } from '@tratt/utilities';

export class SessionFile {
  get type(): string {
    return this._type;
  }

  set type(value: string) {
    this._type = value;
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    this._name = value;
  }

  get size(): number {
    return this._size;
  }

  set size(value: number) {
    this._size = value;
  }

  get timestamp(): Date | undefined {
    return this._timestamp;
  }

  set timestamp(value: Date | undefined) {
    this._timestamp = value;
  }

  constructor(
    private _name: string,
    private _size: number,
    private _timestamp: Date | undefined,
    private _type: string,
  ) {}

  public static fromAny(element: any) {
    if (!element) {
      return undefined;
    }

    if (
      hasProperty(element, 'name') &&
      hasProperty(element, 'type') &&
      hasProperty(element, 'size')
    ) {
      return new SessionFile(
        element.name,
        element.size,
        element.timestamp ? new Date(element.timestamp) : undefined,
        element.type,
      );
    } else {
      console.error(
        'Can not convert to SessionFile. Properties are not valid.',
      );
    }
    return undefined;
  }

  public toAny() {
    return {
      name: this._name,
      type: this._type,
      size: this._size,
      timestamp: this._timestamp,
    };
  }
}
