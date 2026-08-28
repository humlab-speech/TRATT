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

  /**
   * Base URL of the TRATT user manual. Every page of the manual lives directly
   * under this URL. Overridden at startup from `tratt.manual.url` in
   * appconfig.json, so a deployment that publishes the manual somewhere else
   * only has to change its configuration file.
   */
  private static _manualURL = 'https://humlab-speech.github.io/TRATT/manual/';

  /**
   * Extension appended to a manual page name by {@link manualLink}. The manual
   * is generated to HTML by scripts/build-manual.mjs and published to GitHub
   * Pages. A deployment that links to the Markdown sources instead sets this to
   * '.md' in `tratt.manual.pageExtension`.
   */
  private static _manualPageExtension = '.html';

  /**
   * Languages the manual is published in. The first entry is the default and
   * lives at the root of the manual site; every other language lives in a
   * subdirectory named after its code (…/manual/sv/). Overridden from
   * `tratt.manual.locales`.
   */
  private static _manualLocales = ['en', 'sv'];

  /** Language the manual is currently linked in — follows the interface language. */
  private static _manualLocale = 'en';

  /** Base URL of the manual site, ignoring language. */
  static get manualSiteURL(): string {
    return AppInfo._manualURL.endsWith('/')
      ? AppInfo._manualURL
      : `${AppInfo._manualURL}/`;
  }

  static get manualLocales(): string[] {
    return [...AppInfo._manualLocales];
  }

  static get manualLocale(): string {
    return AppInfo._manualLocale;
  }

  /**
   * Follow the interface language, so that a reader of the Swedish interface
   * gets the Swedish manual. Languages the manual has not been translated into
   * fall back to the default one.
   */
  static setManualLocale(language?: string): void {
    const code = (language ?? '').toLowerCase().split(/[-_]/)[0];
    AppInfo._manualLocale = AppInfo._manualLocales.includes(code)
      ? code
      : (AppInfo._manualLocales[0] ?? 'en');
  }

  /** Base URL of the manual in the current language. */
  static get manualURL(): string {
    const isDefault = AppInfo._manualLocale === AppInfo._manualLocales[0];
    return isDefault
      ? AppInfo.manualSiteURL
      : `${AppInfo.manualSiteURL}${AppInfo._manualLocale}/`;
  }

  static get manualPageExtension(): string {
    return AppInfo._manualPageExtension;
  }

  /**
   * Apply the manual settings from appconfig.json. Called once, while the
   * application configuration is loaded.
   */
  static applyManualSettings(manual?: {
    url?: string;
    pageExtension?: string;
    locales?: string[];
  }): void {
    if (manual?.url) {
      AppInfo._manualURL = manual.url;
    }
    if (manual?.pageExtension) {
      AppInfo._manualPageExtension = manual.pageExtension;
    }
    if (manual?.locales && manual.locales.length > 0) {
      AppInfo._manualLocales = manual.locales.map((l) => l.toLowerCase());
      // Re-resolve, in case the current language is not in the new list.
      AppInfo.setManualLocale(AppInfo._manualLocale);
    }
  }

  /**
   * Build a link to one page of the manual, optionally to an anchor within it.
   * Anchors referenced from the application are declared explicitly in the
   * manual sources (see docs/manual/CONTRIBUTING.md) so that they survive a
   * heading rewrite or a change of renderer.
   *
   * @example AppInfo.manualLink('using-tools', 'cutting-audio-files')
   */
  static manualLink(page: string, anchor?: string): string {
    return `${AppInfo.manualURL}${page}${AppInfo.manualPageExtension}${
      anchor ? `#${anchor}` : ''
    }`;
  }

  static readonly maxAudioFileSize = 3000;

  public static readonly queryParamsHandling: NavigationExtras = {
    queryParamsHandling: 'merge',
    preserveFragment: false,
  };

  public static BUILD: typeof BUILD_INFO = { ...BUILD_INFO };
}
