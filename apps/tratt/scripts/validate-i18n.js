#!/usr/bin/env node
// Validates that all locale files contain the same keys as en.json.
// Exits with code 1 if any locale is missing keys.

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

const files = fs.readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'));
const sourceFile = path.join(I18N_DIR, `${SOURCE_LOCALE}.json`);
const sourceKeys = new Set(
  collectKeys(JSON.parse(fs.readFileSync(sourceFile, 'utf8'))),
);

let failed = false;

for (const file of files) {
  const locale = path.basename(file, '.json');
  if (locale === SOURCE_LOCALE) continue;

  const localeKeys = new Set(
    collectKeys(JSON.parse(fs.readFileSync(path.join(I18N_DIR, file), 'utf8'))),
  );

  const missing = [...sourceKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !sourceKeys.has(k));

  if (missing.length > 0) {
    console.error(`\n[${locale}] Missing ${missing.length} key(s):`);
    for (const k of missing) console.error(`  - ${k}`);
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
