import { parseBlob } from 'music-metadata';
import { AudioFormat } from './audio-format';

export class LibavFormat extends AudioFormat {
  protected override _decoder: 'web-audio' | 'tratt' | 'libav' = 'web-audio';

  constructor() {
    super();
    this._supportedFormats = [
      { extension: '.mp4', maxFileSize: 500_000_000 },
      { extension: '.m4v', maxFileSize: 500_000_000 },
      { extension: '.webm', maxFileSize: 500_000_000 },
      { extension: '.mkv', maxFileSize: 500_000_000 },
      { extension: '.wma', maxFileSize: 500_000_000 },
      { extension: '.opus', maxFileSize: 500_000_000 },
      { extension: '.aac', maxFileSize: 500_000_000 },
      { extension: '.3gp', maxFileSize: 500_000_000 },
      { extension: '.mka', maxFileSize: 500_000_000 },
      { extension: '.avi', maxFileSize: 500_000_000 },
      { extension: '.mov', maxFileSize: 500_000_000 },
      { extension: '.mp2', maxFileSize: 500_000_000 },
      { extension: '.amr', maxFileSize: 500_000_000 },
    ];
  }

  public isValid(_buffer: ArrayBuffer): boolean {
    return true;
  }

  override async readAudioInformation(buffer: ArrayBuffer): Promise<void> {
    try {
      const parsed = await parseBlob(
        new File([buffer], this._filename, { type: this._mimeType }),
      );
      const f = parsed.format;
      if (
        f.sampleRate &&
        f.numberOfChannels &&
        (f.numberOfSamples || f.duration)
      ) {
        this._sampleRate = f.sampleRate;
        this._channels = f.numberOfChannels;
        const samples =
          f.numberOfSamples ?? Math.ceil((f.duration ?? 0) * f.sampleRate);
        this._duration = {
          samples,
          seconds: f.duration ?? samples / f.sampleRate,
        };
        return;
      }
    } catch {
      // fall through to placeholder
    }
    // Stub — AudioResource requires sampleRate > 0 and samples > 0.
    // HtmlAudioMechanism replaces AudioInfo after libav decode with actual values.
    this._sampleRate = 44100;
    this._channels = 1;
    this._duration = { samples: 44100, seconds: 1 };
  }
}
