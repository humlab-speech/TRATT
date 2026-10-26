import { Converter, OAnnotJSON } from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import { AudioManager, FileInfo } from '@tratt/web-media';

export interface FileProgress {
  id: number;
  status: 'progress' | 'valid' | 'invalid' | 'waiting';
  file: FileInfo;
  needsOptions?: any;
  options?: any;
  converter?: Converter;
  content?: string | ArrayBuffer;
  checked_converters: number;
  progress: number;
  error?: string;
  warning?: string;
  audioManager?: AudioManager;
  oaudiofile?: OAudiofile;
  /** Pairing mode: this transcript, imported against its recording. */
  annotation?: OAnnotJSON;
  /** Pairing mode: basename of the recording `annotation` belongs to. */
  pairedBasename?: string;
  /**
   * Pairing mode: explicit pairing group, set for files unpacked from a
   * catalogue archive. A transcript pairs with the recordings of its own
   * group instead of by basename, which the archive cannot guarantee to be
   * unique (`take.wav` and `take.wma` are two recordings).
   */
  pairKey?: string;
}
