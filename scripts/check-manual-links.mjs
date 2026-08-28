#!/usr/bin/env node
/**
 * Validates the user manual sources in docs/manual, in every language.
 *
 *  1. every relative link between manual pages resolves to a page that exists;
 *  2. every "#anchor" resolves to a heading or an explicit <a id="..."> in the
 *     target page — checked per language, because a translated page has its own
 *     headings;
 *  3. every image referenced from the manual exists;
 *  4. every AppInfo.manualLink('page', 'anchor') call in the application
 *     resolves in *every* language, since the app links to the manual in the
 *     interface language.
 *
 * Point 4 is the contract between the app and the manual: renaming a page or an
 * anchor — or translating a page without carrying its explicit anchors over —
 * silently produces a dead Help link. See docs/manual/CONTRIBUTING.md.
 *
 * Usage: node scripts/check-manual-links.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = join(repoRoot, 'docs', 'manual');
const appDir = join(repoRoot, 'apps');

/** Keep in step with LOCALES in scripts/build-manual.mjs. */
const LOCALES = [
  { code: 'en', dir: '' },
  { code: 'sv', dir: 'sv' },
];

/** Maintainer documentation — not part of the published manual. */
const UNPUBLISHED = new Set(['CONTRIBUTING']);

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

if (!existsSync(manualDir)) {
  console.error(`Manual directory not found: ${relative(repoRoot, manualDir)}`);
  process.exit(1);
}

const pages = readdirSync(manualDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .filter((p) => !UNPUBLISHED.has(p));

/** GitHub-ish heading slug, plus a collapsed-whitespace variant. */
function slugsForHeading(text) {
  const cleaned = text
    .trim()
    .replace(/[`*]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '');
  return [cleaned.replace(/ /g, '-'), cleaned.replace(/\s+/g, '-')];
}

function anchorsOf(source) {
  const anchors = new Set();
  for (const m of source.matchAll(/^#{1,6}\s+(.*)$/gm)) {
    for (const slug of slugsForHeading(m[1])) anchors.add(slug);
  }
  for (const m of source.matchAll(/<a\s+id="([^"]+)"/g)) anchors.add(m[1]);
  return anchors;
}

/**
 * The source that actually ships for a page in a language: the translation when
 * there is one, the English text otherwise — the same rule the build applies.
 */
const effective = {};
const translated = {};
for (const locale of LOCALES) {
  effective[locale.code] = {};
  translated[locale.code] = new Set();
  for (const page of pages) {
    const localised = join(manualDir, locale.dir, `${page}.md`);
    const isTranslation = locale.dir !== '' && existsSync(localised);
    const file = isTranslation ? localised : join(manualDir, `${page}.md`);
    const source = readFileSync(file, 'utf8');
    effective[locale.code][page] = {
      source,
      anchors: anchorsOf(source),
      path: relative(repoRoot, file),
      isTranslation: locale.dir === '' || isTranslation,
    };
    if (effective[locale.code][page].isTranslation) {
      translated[locale.code].add(page);
    }
  }

  // A translated page with no English counterpart is a typo, not a feature.
  if (locale.dir !== '' && existsSync(join(manualDir, locale.dir))) {
    const stray = readdirSync(join(manualDir, locale.dir))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .filter((p) => !pages.includes(p) && !UNPUBLISHED.has(p));
    for (const p of stray) {
      fail(
        `docs/manual/${locale.dir}/${p}.md`,
        'has no English counterpart in docs/manual/',
      );
    }
  }
}

// --- 1-3: links inside the manual ------------------------------------------
const sourceFiles = [
  ...pages.map((p) => ({ locale: LOCALES[0], page: p })),
  ...LOCALES.slice(1).flatMap((locale) =>
    pages
      .filter((p) => translated[locale.code].has(p))
      .map((p) => ({ locale, page: p })),
  ),
  // maintainer docs are checked too, against the English set
  ...readdirSync(manualDir)
    .filter((f) => f.endsWith('.md') && UNPUBLISHED.has(f.replace(/\.md$/, '')))
    .map((f) => ({ locale: LOCALES[0], page: f.replace(/\.md$/, '') })),
];

for (const { locale, page } of sourceFiles) {
  const isUnpublished = UNPUBLISHED.has(page);
  const file = join(manualDir, locale.dir, `${page}.md`);
  const where = relative(repoRoot, file);
  const source = readFileSync(file, 'utf8');
  const anchorsFor = (target) =>
    isUnpublished
      ? effective[LOCALES[0].code][target]?.anchors
      : effective[locale.code][target]?.anchors;

  for (const m of source.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = m[1];
    if (/^(https?:|mailto:|#?$)/.test(link)) continue;

    const [rawTarget, anchor] = link.split('#');
    const target = (rawTarget || `${page}.md`).replace(/\.md$/, '');

    if (!rawTarget.endsWith('.md') && rawTarget !== '') {
      // an asset (screenshot, diagram, …)
      const assetPath = resolve(dirname(file), rawTarget);
      if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
        fail(where, `missing asset "${link}"`);
      }
      continue;
    }

    if (!pages.includes(target) && !UNPUBLISHED.has(target)) {
      fail(where, `link to missing page "${link}"`);
      continue;
    }
    if (anchor && !anchorsFor(target)?.has(anchor)) {
      fail(where, `link to missing anchor "${link}"`);
    }
  }
}

// --- 4: deep links from the application, in every language -------------------
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|html)$/.test(entry.name)) yield full;
  }
}

const callPattern = /manualLink\(\s*'([^']+)'\s*(?:,\s*'([^']+)'\s*)?\)/g;

if (existsSync(appDir)) {
  for (const file of walk(appDir)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('manualLink(')) continue;
    for (const m of source.matchAll(callPattern)) {
      const [, page, anchor] = m;
      const where = relative(repoRoot, file);
      if (!pages.includes(page)) {
        fail(where, `manualLink('${page}') has no page docs/manual/${page}.md`);
        continue;
      }
      if (!anchor) continue;
      for (const locale of LOCALES) {
        if (!effective[locale.code][page].anchors.has(anchor)) {
          fail(
            where,
            `manualLink('${page}', '${anchor}') has no anchor "#${anchor}" in ` +
              `${effective[locale.code][page].path} (${locale.code})`,
          );
        }
      }
    }
  }
}

// --- report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`Manual link check failed (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nSee docs/manual/CONTRIBUTING.md for the anchor contract between the app and the manual.',
  );
  process.exit(1);
}

const coverage = LOCALES.map(
  (l) => `${l.code} ${translated[l.code].size}/${pages.length}`,
).join(', ');
console.log(
  `Manual link check passed: ${pages.length} pages, ` +
    `${LOCALES.length} languages (${coverage}); ` +
    `all links, anchors and app deep links resolve.`,
);
