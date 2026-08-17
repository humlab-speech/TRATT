import { parseBlob } from 'music-metadata';
import { AudioFormat } from './audio-format';

export class MusicMetadataFormat extends AudioFormat {
  protected override _decoder: 'web-audio' | 'tratt' = 'web-audio';

  constructor() {
    super();
    this._supportedFormats = [
      {
        extension: '.flac',
        maxFileSize: 500_000_000,
        info: 'The duration in samples is going to be estimated and may differ with the used application.',
      },
      {
        extension: '.ogg',
        maxFileSize: 500_000_000,
      },
      {
        extension: '.mp3',
        maxFileSize: 500_000_000,
        info: 'The duration in samples is going to be estimated and may differ with the used application.',
      },
      {
        extension: '.m4a',
        maxFileSize: 500_000_000,
        info: 'The duration in samples is going to be estimated and may differ with the used application.',
      },
    ];
  }

  public isValid(buffer: ArrayBuffer): boolean {
    return true;
  }

  override async readAudioInformation(buffer: ArrayBuffer) {
    const parsed = await parseBlob(
      new File([buffer], this._filename, { type: this._mimeType }),
    );
    const format = parsed.format;

    if (!format.sampleRate || !format.numberOfChannels) {
      throw new Error(
        "Can't read audio information: sampleRate or numberOfChannels missing.",
      );
    } else {
      // duration/numberOfSamples may be absent for MPEG-2 Layer 3 files that
      // lack a Xing/Info header; use 0 as placeholder — the Web Audio decode
      // step overwrites info.duration with the correct value from AudioBuffer.
      const numberOfSamples =
        format.numberOfSamples ??
        (format.duration != null
          ? Math.ceil(format.duration * format.sampleRate)
          : 0);
      this._sampleRate = format.sampleRate;
      this._duration = {
        samples: numberOfSamples,
        seconds: format.duration ?? 0,
      };
      this._channels = format.numberOfChannels;
    }
  }
}
