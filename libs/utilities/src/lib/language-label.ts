/**
 * Format a BCP-47 language code into a label of the form
 * `<native name> (<English name>, <base code>)`.
 *
 * Region subtags are intentionally dropped — only the base language code
 * (e.g. `en`, `de`, `zh`) is used for lookups and shown in the suffix.
 *
 * For native names, a static lookup table is consulted first because
 * `Intl.DisplayNames` silently falls back to its default locale (usually
 * English) when ICU data for the requested language is not bundled —
 * which would make the native name identical to the English one.
 * `Intl.DisplayNames` is used only as a secondary enrichment and for the
 * English part.
 */
export function formatLanguageLabel(
  code: string,
  fallbackDescription: string,
): string {
  if (!code) {
    return fallbackDescription ?? '';
  }

  const base = code.split('-')[0].toLowerCase();
  const cleanedFallback = stripTrailingParens(fallbackDescription ?? '');

  let english = lookupDisplayName(base, 'en');
  let intlNative = lookupDisplayName(base, base);

  english = english ? stripTrailingParens(english) : cleanedFallback;
  intlNative = intlNative ? stripTrailingParens(intlNative) : undefined;

  const staticNative = NATIVE_LANGUAGE_NAMES[base];
  const native =
    staticNative ??
    (intlNative && intlNative.toLowerCase() !== (english ?? '').toLowerCase()
      ? intlNative
      : undefined);

  if (!english) {
    return cleanedFallback || base;
  }

  if (!native || native.toLowerCase() === english.toLowerCase()) {
    return `${english} (${base})`;
  }

  return `${native} (${english}, ${base})`;
}

function stripTrailingParens(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

function lookupDisplayName(base: string, locale: string): string | undefined {
  try {
    const DisplayNames = (Intl as unknown as { DisplayNames?: unknown })
      .DisplayNames as
      | { new (locales: string[], opts: { type: string }): { of(c: string): string | undefined } }
      | undefined;
    if (typeof DisplayNames === 'function') {
      return new DisplayNames([locale], { type: 'language' }).of(base);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function baseCode(code?: string): string | undefined {
  if (!code) return undefined;
  const base = code.split('-')[0].toLowerCase();
  return base || undefined;
}

export function getEnglishLanguageLabel(code: string): string {
  const base = baseCode(code);
  if (!base) return code;
  const english = lookupDisplayName(base, 'en');
  const cleaned = english ? stripTrailingParens(english) : undefined;
  return cleaned ? `${cleaned} (${base})` : base;
}

export function endonymToLanguageCode(name: string): string | undefined {
  if (!name) return undefined;
  return ENDONYM_TO_CODE.get(name.trim().toLowerCase());
}

/**
 * Native (endonym) names by ISO-639-1/2 base code. Covers languages
 * commonly offered by BAS / Whisper ASR providers. English is omitted on
 * purpose so it falls through to the `native === english` collapse.
 */
const NATIVE_LANGUAGE_NAMES: Record<string, string> = {
  af: 'Afrikaans',
  am: 'አማርኛ',
  ar: 'العربية',
  as: 'অসমীয়া',
  az: 'Azərbaycan dili',
  ba: 'Башҡортса',
  be: 'Беларуская',
  bg: 'Български',
  bn: 'বাংলা',
  bo: 'བོད་སྐད་',
  br: 'Brezhoneg',
  bs: 'Bosanski',
  ca: 'Català',
  cs: 'Čeština',
  cy: 'Cymraeg',
  da: 'Dansk',
  de: 'Deutsch',
  el: 'Ελληνικά',
  eo: 'Esperanto',
  es: 'Español',
  et: 'Eesti',
  eu: 'Euskara',
  fa: 'فارسی',
  fi: 'Suomi',
  fo: 'Føroyskt',
  fr: 'Français',
  ga: 'Gaeilge',
  gl: 'Galego',
  gu: 'ગુજરાતી',
  ha: 'Hausa',
  haw: 'ʻŌlelo Hawaiʻi',
  he: 'עברית',
  hi: 'हिन्दी',
  hr: 'Hrvatski',
  ht: 'Kreyòl Ayisyen',
  hu: 'Magyar',
  hy: 'Հայերեն',
  id: 'Bahasa Indonesia',
  is: 'Íslenska',
  it: 'Italiano',
  ja: '日本語',
  jv: 'Basa Jawa',
  jw: 'Basa Jawa',
  ka: 'ქართული',
  kk: 'Қазақша',
  km: 'ខ្មែរ',
  kn: 'ಕನ್ನಡ',
  ko: '한국어',
  ky: 'Кыргызча',
  la: 'Latina',
  lb: 'Lëtzebuergesch',
  ln: 'Lingála',
  lo: 'ລາວ',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  mg: 'Malagasy',
  mi: 'Māori',
  mk: 'Македонски',
  ml: 'മലയാളം',
  mn: 'Монгол',
  mr: 'मराठी',
  ms: 'Bahasa Melayu',
  mt: 'Malti',
  my: 'မြန်မာ',
  ne: 'नेपाली',
  nl: 'Nederlands',
  nn: 'Nynorsk',
  no: 'Norsk',
  oc: 'Occitan',
  pa: 'ਪੰਜਾਬੀ',
  pl: 'Polski',
  ps: 'پښتو',
  pt: 'Português',
  ro: 'Română',
  ru: 'Русский',
  sa: 'संस्कृतम्',
  sd: 'سنڌي',
  si: 'සිංහල',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sn: 'ChiShona',
  so: 'Soomaali',
  sq: 'Shqip',
  sr: 'Српски',
  su: 'Basa Sunda',
  sv: 'Svenska',
  sw: 'Kiswahili',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  tg: 'Тоҷикӣ',
  th: 'ไทย',
  tk: 'Türkmen',
  tl: 'Tagalog',
  tr: 'Türkçe',
  tt: 'Татарча',
  uk: 'Українська',
  ur: 'اردو',
  uz: 'Oʻzbekcha',
  vi: 'Tiếng Việt',
  yi: 'ייִדיש',
  yo: 'Yorùbá',
  yue: '粵語',
  zh: '中文',
};

const ENDONYM_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(NATIVE_LANGUAGE_NAMES).map(([code, native]) => [
    native.toLowerCase(),
    code,
  ]),
);
