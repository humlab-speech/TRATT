import { OAudiofile } from '@tratt/media';
import { MediaResource } from '../media-resource';
import { SourceType } from '../types';
import { AudioInfo } from './audio-info';

export class AudioResource extends MediaResource {
  private _info: AudioInfo;
  private readonly _originalType: string;

  get info(): AudioInfo {
    return this._info;
  }

  set info(value: AudioInfo) {
    this._info = value;
  }

  get originalType(): string {
    return this._originalType;
  }

  constructor(
    fullname: string,
    source: SourceType,
    info: AudioInfo,
    buffer?: ArrayBuffer,
    size?: number,
    url?: string,
  ) {
    super(fullname, source, buffer, size, url);
    if (
      info.duration &&
      info.sampleRate &&
      info.duration.samples >= 0 &&
      info.sampleRate > 0
    ) {
      this._info = info;
      this._originalType = info.type;
    } else {
      throw Error(
        'AudioResource needs a correct instance of AudioInfo as parameter',
      );
    }
  }

  getOAudioFile(): OAudiofile {
    const result = new OAudiofile();
    result.type = this._info.type;
    result.duration = this._info.duration.samples;
    result.size = this.size ?? 0;
    result.url = this._info.url;
    result.name = this._info.fullname;
    result.arraybuffer = this.arraybuffer;
    result.sampleRate = this._info.sampleRate;

    return result;
  }
}
