import { NavigationExtras } from '@angular/router';
import {
  AnnotJSONConverter,
  BundleJSONConverter,
  Converter,
  CTMConverter,
  DocxConverter,
  ELANConverter,
  OdtConverter,
  PartiturConverter,
  PraatTableConverter,
  PraatTextgridConverter,
  SRTConverter,
  TextConverter,
  WebVTTConverter,
  WhisperJSONConverter,
} from '@tratt/annotation';
import { LibavFormat, MusicMetadataFormat, WavFormat } from '@tratt/web-media';
import { BUILD_INFO } from './build-info';

export class AppInfo {
  public static readonly audioformats = [
    new WavFormat(),
    new MusicMetadataFormat(),
    new LibavFormat(),
  ];

  public static readonly converters: Converter[] = [
    new DocxConverter(),
    new OdtConverter(),
    new SRTConverter(),
    new AnnotJSONConverter(),
    new WhisperJSONConverter(),
    new TextConverter(),
    new PraatTableConverter(),
    new PraatTextgridConverter(),
    new ELANConverter(),
    new BundleJSONConverter(),
    new WebVTTConverter(),
    new PartiturConverter(),
    new CTMConverter(),
  ];

  public static readonly themes: string[] = ['default', 'shortAudioFiles'];
  static readonly manualURL =
    'https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/';

  static readonly maxAudioFileSize = 3000;

  public static readonly queryParamsHandling: NavigationExtras = {
    queryParamsHandling: 'merge',
    preserveFragment: false,
  };

  public static BUILD: typeof BUILD_INFO = { ...BUILD_INFO };
}
