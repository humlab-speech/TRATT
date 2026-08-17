/**
 * BCP-47 base code → Flores-200 tag, for NLLB-200 translation models.
 * Covers the languages exposed in the auto-translate UI.
 */
export const BCP47_TO_FLORES: Record<string, string> = {
  en: 'eng_Latn',
  de: 'deu_Latn',
  fr: 'fra_Latn',
  es: 'spa_Latn',
  it: 'ita_Latn',
  pt: 'por_Latn',
  nl: 'nld_Latn',
  sv: 'swe_Latn',
  da: 'dan_Latn',
  no: 'nob_Latn',
  fi: 'fin_Latn',
  pl: 'pol_Latn',
  cs: 'ces_Latn',
  sk: 'slk_Latn',
  hu: 'hun_Latn',
  ro: 'ron_Latn',
  bg: 'bul_Cyrl',
  el: 'ell_Grek',
  tr: 'tur_Latn',
  ru: 'rus_Cyrl',
  uk: 'ukr_Cyrl',
  ar: 'arb_Arab',
  he: 'heb_Hebr',
  fa: 'pes_Arab',
  hi: 'hin_Deva',
  zh: 'zho_Hans',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  vi: 'vie_Latn',
  id: 'ind_Latn',
  th: 'tha_Thai',
};

export function toFloresCode(code: string): string {
  const base = code.split('-')[0].toLowerCase();
  return BCP47_TO_FLORES[base] ?? code;
}

/**
 * Pick the right language tag for a given translation model.
 * NLLB → Flores-200 codes (eng_Latn …). m2m100 / opus-mt → ISO-639-1.
 */
export function toModelLangCode(modelId: string, code: string): string {
  if (/nllb/i.test(modelId)) {
    return toFloresCode(code);
  }
  return code.split('-')[0].toLowerCase();
}
