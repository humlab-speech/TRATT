#!/usr/bin/env node
// Validates that all locale files contain the same keys as en.json.
// Exits with code 1 if any locale is missing keys, or if a `workbench.*` value
// is still the untranslated English text (unless allow-listed below).

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../src/assets/i18n');
const SOURCE_LOCALE = 'en';

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function collectEntries(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      collectEntries(v, full, out);
    } else {
      out[full] = v;
    }
  }
  return out;
}

// Namespaces whose values must differ from English in every other locale.
const TRANSLATED_PREFIXES = ['workbench.'];
// Values that legitimately equal the English text (symbols, loanwords, ...).
const SAME_AS_ENGLISH_OK = new Set([
  'workbench.pipeline.translate_to',
  'workbench.capacity.storage_text',
  'workbench.capacity.memory_text',
]);
// Locales where individual words are legitimately identical to English.
const SAME_AS_ENGLISH_OK_PER_LOCALE = {
  sv: new Set(['workbench.editor_header.mono', 'workbench.editor_header.stereo']),
  nl: new Set(['workbench.editor_header.mono', 'workbench.editor_header.stereo']),
  it: new Set(['workbench.editor_header.mono', 'workbench.editor_header.stereo']),
};

const files = fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'));
const sourceFile = path.join(I18N_DIR, `${SOURCE_LOCALE}.json`);
const sourceJson = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const sourceKeys = new Set(collectKeys(sourceJson));
const sourceEntries = collectEntries(sourceJson);

let failed = false;

for (const file of files) {
  const locale = path.basename(file, '.json');
  if (locale === SOURCE_LOCALE) continue;

  const localeJson = JSON.parse(
    fs.readFileSync(path.join(I18N_DIR, file), 'utf8'),
  );
  const localeKeys = new Set(collectKeys(localeJson));
  const localeEntries = collectEntries(localeJson);

  const missing = [...sourceKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !sourceKeys.has(k));

  if (missing.length > 0) {
    console.error(`\n[${locale}] Missing ${missing.length} key(s):`);
    for (const k of missing) console.error(`  - ${k}`);
    failed = true;
  }
  const untranslated = Object.keys(sourceEntries).filter(
    (k) =>
      TRANSLATED_PREFIXES.some((p) => k.startsWith(p)) &&
      !SAME_AS_ENGLISH_OK.has(k) &&
      !SAME_AS_ENGLISH_OK_PER_LOCALE[locale]?.has(k) &&
      localeEntries[k] === sourceEntries[k],
  );
  if (untranslated.length > 0) {
    console.error(
      `\n[${locale}] ${untranslated.length} value(s) identical to English (untranslated):`,
    );
    for (const k of untranslated) console.error(`  ~ ${k}`);
    failed = true;
  }
  if (extra.length > 0) {
    console.warn(`\n[${locale}] Extra ${extra.length} key(s) not in en.json:`);
    for (const k of extra) console.warn(`  + ${k}`);
  }
}

if (failed) {
  console.error('\ni18n validation FAILED — add missing keys to locale files.');
  process.exit(1);
} else {
  console.log('i18n validation passed — all locales in sync with en.json.');
}
