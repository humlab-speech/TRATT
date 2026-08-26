import { OAudiofile } from '@tratt/media';
import { escapeXmlEntities } from '@tratt/utilities';
import { OAnnotJSON } from '../annotjson';
import { SupportedApplication } from './SupportedApplications';

export type TrattAnnotationFormatType =
  | 'AnnotJSON'
  | 'BundleJSON'
  | 'CTM'
  | 'DOCX'
  | 'ELAN'
  | 'BASPartitur'
  | 'PraatTextTable'
  | 'SRT'
  | 'PlainText'
  | 'TextGrid'
  | 'WhisperJSON'
  | 'WebVTT'
  | 'ODT';

export type ExportCategory = 'general' | 'linguistic' | 'specialist';

export interface IFile {
  name: string;
  content: string;
  type: string;
  encoding: string;
}

export interface ImportResult {
  annotjson?: OAnnotJSON;
  audiofile?: OAudiofile;
  error?: string;
}

export interface ExportResult {
  file?: IFile;
  error?: string;
}

export abstract class Converter {
  protected _conversion = {
    import: false,
    export: false,
  };

  get conversion(): { import: boolean; export: boolean } {
    return this._conversion;
  }

  protected _applications: {
    application: SupportedApplication;
    recommended?: boolean;
  }[] = [];

  public defaultImportOptions: any;

  get applications(): {
    application: SupportedApplication;
    recommended?: boolean;
  }[] {
    return this._applications;
  }

  protected _name!: TrattAnnotationFormatType;

  get name(): TrattAnnotationFormatType {
    return this._name;
  }

  protected _extensions: string[] = [];

  get extensions(): string[] {
    return this._extensions;
  }

  protected _encoding = '';

  get encoding(): string {
    return this._encoding;
  }

  protected _notice = '';

  get notice(): string {
    return this._notice;
  }

  protected _multitiers = true;
  public options: any;
  protected _category: ExportCategory = 'linguistic';

  /**
   * When true, the export modal shows a multi-tier selection (checkbox list)
   * for this converter, and `export()` should consult the `levelnums`
   * argument to emit several tiers in one file. Distinct from `_multitiers`
   * which describes whether the format itself can carry multiple tiers in
   * its native structure.
   */
  protected _multiTierExport = false;

  get category(): ExportCategory {
    return this._category;
  }

  get multitiers(): boolean {
    return this._multitiers;
  }

  get multiTierExport(): boolean {
    return this._multiTierExport;
  }

  protected msToTimeString(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${this.pad(h)}:${this.pad(m)}:${this.pad(s)}`;
  }

  protected pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  protected escapeXml(s: string): string {
    return escapeXmlEntities(s, '&apos;');
  }

  /**
   * exports AnnotJSON to another annotation format considering an audio file and a level number (optional).
   * @param annotation the AnnotJSON
   * @param audiofile information about the audio file
   * @param levelnum the level number for export. When `levelnums` is supplied
   *   it takes precedence over `levelnum`.
   * @param levelnums optional list of level indices for converters that
   *   support multi-tier export (currently DOCX, ODT, PlainText). When
   *   present, each tier is emitted in order and prefixed with its name.
   * returns resulted file or error.
   */
  public abstract export(
    annotation: OAnnotJSON,
    audiofile: OAudiofile,
    levelnum?: number,
    levelnums?: number[],
  ): ExportResult;

  /**
   * converts an file to AnnotJSON considering the audio file. The audio file must be the one used for this transcript file.
   * @param file the transcript file
   * @param audiofile information about the audio file.
   * returns object with an annotjson or an error.
   */
  public abstract import(
    file: IFile,
    audiofile: OAudiofile,
    options?: any,
  ): ImportResult;

  /**
   * checks if the converter needs further options to import the file.
   * @param file the transcript file
   * @param audiofile information about the audio file.
   */
  public abstract needsOptionsForImport(
    file: IFile,
    audiofile: OAudiofile,
  ): any | undefined;
}
