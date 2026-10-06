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
}
