#!/usr/bin/env node
/**
 * Renders the TRATT user manual to a self-contained static site in dist/manual.
 *
 * Sources:
 *   docs/manual/*.md        English — the default language, published at the
 *                           root of the site
 *   docs/manual/<lang>/*.md every other language, published in a subdirectory
 *                           of the same name (docs/manual/sv → /manual/sv/)
 *
 * Page names are preserved one-to-one: using-tools.md becomes using-tools.html.
 * That mapping is the contract the application relies on when it deep-links
 * into the manual via AppInfo.manualLink() — see docs/manual/CONTRIBUTING.md.
 *
 * A page that has not been translated yet falls back to the English text with a
 * notice, so a partly translated language still has complete navigation.
 *
 * Usage: node scripts/build-manual.mjs [--out <dir>] [--no-clean]
 *
 *   --out <dir>   write the site somewhere other than dist/manual
 *   --no-clean    overwrite in place instead of emptying the output directory
 *                 first (for previewing where deleting files is not permitted;
 *                 CI always cleans, so stale pages cannot be published)
 */
import MarkdownIt from 'markdown-it';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = join(repoRoot, 'docs', 'manual');
const assetsDir = join(repoRoot, 'docs', 'assets');

const outArgIndex = process.argv.indexOf('--out');
const outRoot =
  outArgIndex > -1 && process.argv[outArgIndex + 1]
    ? resolve(process.cwd(), process.argv[outArgIndex + 1])
    : join(repoRoot, 'dist', 'manual');

/**
 * Languages, most preferred first. The first is the default and is published at
 * the root; keep this in step with `tratt.manual.locales` in appconfig.json.
 */
const LOCALES = [
  { code: 'en', dir: '', name: 'English', label: 'EN' },
  { code: 'sv', dir: 'sv', name: 'Svenska', label: 'SV' },
];

/** Interface strings of the generated site itself. */
const UI = {
  en: {
    site: 'manual',
    skip: 'Skip to content',
    menu: 'Menu',
    filter: 'Filter pages…',
    filterLabel: 'Filter pages',
    toc: 'On this page',
    edit: 'Edit this page',
    nav: 'Manual',
    language: 'Language',
    untranslated: null,
    sections: {
      start: 'Getting started',
      material: 'Your material',
      work: 'Doing the work',
      results: 'Results',
      reference: 'Reference',
    },
  },
  sv: {
    site: 'manual',
    skip: 'Hoppa till innehållet',
    menu: 'Meny',
    filter: 'Filtrera sidor…',
    filterLabel: 'Filtrera sidor',
    toc: 'På den här sidan',
    edit: 'Redigera den här sidan',
    nav: 'Manual',
    language: 'Språk',
    untranslated:
      'Den här sidan är ännu inte översatt till svenska och visas på engelska.',
    sections: {
      start: 'Kom igång',
      material: 'Ditt material',
      work: 'Arbetet',
      results: 'Resultat',
      reference: 'Referens',
    },
  },
};

/**
 * Sidebar order. Every published page must be listed here, so that adding a
 * page without deciding where it belongs fails the build instead of quietly
 * dropping it out of the navigation.
 */
const NAV = [
  { section: 'start', pages: ['index', 'quick-start'] },
  {
    section: 'material',
    pages: ['loading-media', 'automatic-transcription', 'privacy'],
  },
  {
    section: 'work',
    pages: [
      'transcribing',
      'the-editors',
      'tiers-and-speakers',
      'checking-your-work',
      'using-tools',
    ],
  },
  { section: 'results', pages: ['exporting'] },
  {
    section: 'reference',
    pages: ['shortcuts', 'troubleshooting', 'glossary', 'coming-from-octra'],
  },
];

/**
 * Shorter labels for the sidebar, where a page's full H1 would be unwieldy or
 * redundant next to the site title.
 */
const NAV_LABELS = {
  en: {
    index: 'Overview',
    'quick-start': 'Quick start',
    'automatic-transcription': 'Automatic transcription',
    'coming-from-octra': 'Coming from OCTRA',
  },
  sv: {
    index: 'Översikt',
    'quick-start': 'Snabbstart',
    'automatic-transcription': 'Automatisk transkription',
    'coming-from-octra': 'Från OCTRA-manualen',
  },
};

/** Maintainer documentation — kept in the repository, not published. */
const UNPUBLISHED = new Set(['CONTRIBUTING']);

// --- markdown ----------------------------------------------------------------
const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

function slugify(text) {
  return text
    .trim()
    .replace(/[`*]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');
}

md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const inline = tokens[idx + 1];
  const text = inline && inline.type === 'inline' ? inline.content : '';
  const base = slugify(text);
  let id = base;
  let n = 1;
  while (env.usedIds.has(id)) id = `${base}-${n++}`;
  env.usedIds.add(id);
  if (tokens[idx].tag !== 'h1') {
    env.toc.push({ id, level: Number(tokens[idx].tag.slice(1)), text });
  }
  tokens[idx].attrSet('id', id);
  return self.renderToken(tokens, idx, options);
};

const defaultLink =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? '';
  if (/^https?:/i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener');
  } else if (href.includes('.md')) {
    tokens[idx].attrSet('href', href.replace(/\.md(?=$|#)/, '.html'));
  }
  return defaultLink(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = tokens[idx].attrGet('src') ?? '';
  // Sources reference docs/assets relatively, so the number of leading "../"
  // depends on how deep the language directory is. The site keeps a single
  // assets/ directory at its root.
  if (/^(\.\.\/)+assets\//.test(src)) {
    const file = basename(src);
    env.usedAssets.add(file);
    tokens[idx].attrSet('src', `${env.assetPrefix}assets/${file}`);
  }
  tokens[idx].attrSet('loading', 'lazy');
  return defaultImage(tokens, idx, options, env, self);
};

// --- collect pages -----------------------------------------------------------
const englishPages = readdirSync(manualDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .filter((f) => !UNPUBLISHED.has(f));

const ordered = NAV.flatMap((s) => s.pages);
const missingFromNav = englishPages.filter((p) => !ordered.includes(p));
const missingFiles = ordered.filter((p) => !englishPages.includes(p));
if (missingFromNav.length || missingFiles.length) {
  if (missingFromNav.length) {
    console.error(
      `Pages not listed in NAV in scripts/build-manual.mjs: ${missingFromNav.join(', ')}`,
    );
  }
  if (missingFiles.length) {
    console.error(
      `NAV lists pages that do not exist: ${missingFiles.join(', ')}`,
    );
  }
  process.exit(1);
}

const titleOf = (source, fallback) => {
  const m = source.match(/^#\s+(.*)$/m);
  return m ? m[1].replace(/[`*]/g, '').trim() : fallback;
};

/** sources[locale][page] = { source, title, translated } */
const sources = {};
for (const locale of LOCALES) {
  sources[locale.code] = {};
  for (const page of ordered) {
    const localised = join(manualDir, locale.dir, `${page}.md`);
    const translated = locale.dir !== '' && existsSync(localised);
    const file = translated ? localised : join(manualDir, `${page}.md`);
    const source = readFileSync(file, 'utf8');
    sources[locale.code][page] = {
      source,
      title: titleOf(source, page),
      translated: locale.dir === '' || translated,
    };
  }
  const stray = existsSync(join(manualDir, locale.dir))
    ? readdirSync(join(manualDir, locale.dir))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
        .filter((f) => !ordered.includes(f) && !UNPUBLISHED.has(f))
    : [];
  if (locale.dir !== '' && stray.length > 0) {
    console.error(
      `docs/manual/${locale.dir} has pages with no English counterpart: ${stray.join(', ')}`,
    );
    process.exit(1);
  }
}

// --- templating --------------------------------------------------------------
const CSS = readFileSync(
  join(repoRoot, 'scripts', 'manual-assets', 'manual.css'),
  'utf8',
);
const JS = readFileSync(
  join(repoRoot, 'scripts', 'manual-assets', 'manual.js'),
  'utf8',
);

const escapeHtml = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/** Relative path from a page in `locale` to the same page in `target`. */
function crossLocaleHref(locale, target, page) {
  const up = locale.dir === '' ? '' : '../';
  const down = target.dir === '' ? '' : `${target.dir}/`;
  return `${up}${down}${page}.html`;
}

function renderNav(locale, current) {
  const ui = UI[locale.code];
  return NAV.map((section) => {
    const items = section.pages
      .map((p) => {
        const active = p === current ? ' class="active"' : '';
        const label =
          NAV_LABELS[locale.code]?.[p] ?? sources[locale.code][p].title;
        return `<li><a href="${p}.html"${active}>${escapeHtml(label)}</a></li>`;
      })
      .join('\n          ');
    return `<li class="nav-section">${escapeHtml(ui.sections[section.section])}<ul>
          ${items}
        </ul></li>`;
  }).join('\n        ');
}

function renderToc(locale, toc) {
  const entries = toc.filter((t) => t.level === 2);
  if (entries.length < 2) return '';
  return `<nav class="toc" aria-label="${escapeHtml(UI[locale.code].toc)}">
      <p class="toc-title">${escapeHtml(UI[locale.code].toc)}</p>
      <ul>
        ${entries
          .map(
            (t) =>
              `<li><a href="#${t.id}">${escapeHtml(t.text.replace(/[`*]/g, ''))}</a></li>`,
          )
          .join('\n        ')}
      </ul>
    </nav>`;
}

function renderLangSwitch(locale, page) {
  return `<nav class="lang-switch" aria-label="${escapeHtml(UI[locale.code].language)}">
    ${LOCALES.map((l) =>
      l.code === locale.code
        ? `<span class="active" aria-current="true" lang="${l.code}">${l.label}</span>`
        : `<a href="${crossLocaleHref(locale, l, page)}" lang="${l.code}" hreflang="${l.code}" title="${escapeHtml(l.name)}">${l.label}</a>`,
    ).join('\n    ')}
  </nav>`;
}

function renderPage(locale, page) {
  const ui = UI[locale.code];
  const entry = sources[locale.code][page];
  const env = {
    usedIds: new Set(),
    toc: [],
    usedAssets,
    assetPrefix: locale.dir === '' ? '' : '../',
  };
  const body = md.render(entry.source, env);
  const sourcePath = entry.translated
    ? `${locale.dir ? `${locale.dir}/` : ''}${page}.md`
    : `${page}.md`;
  const alternates = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${l.code}" href="${crossLocaleHref(locale, l, page)}">`,
  ).join('\n');
  const notice =
    !entry.translated && ui.untranslated
      ? `<p class="untranslated" lang="${LOCALES[0].code}">${escapeHtml(ui.untranslated)}</p>`
      : '';

  return `<!doctype html>
<html lang="${entry.translated ? locale.code : LOCALES[0].code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.title)} — TRATT ${escapeHtml(ui.site)}</title>
<meta name="description" content="TRATT ${escapeHtml(ui.site)} — ${escapeHtml(entry.title)}">
${alternates}
<style>${CSS}</style>
</head>
<body>
<a class="skip-link" href="#content">${escapeHtml(ui.skip)}</a>
<header class="topbar">
  <a class="brand" href="index.html">TRATT <span>${escapeHtml(ui.site)}</span></a>
  ${renderLangSwitch(locale, page)}
  <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sidebar">${escapeHtml(ui.menu)}</button>
  <a class="repo" href="https://github.com/humlab-speech/TRATT" target="_blank" rel="noopener">GitHub</a>
</header>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <label class="nav-filter">
      <span class="visually-hidden">${escapeHtml(ui.filterLabel)}</span>
      <input type="search" placeholder="${escapeHtml(ui.filter)}" autocomplete="off">
    </label>
    <nav aria-label="${escapeHtml(ui.nav)}">
      <ul>
        ${renderNav(locale, page)}
      </ul>
    </nav>
  </aside>
  <main id="content" class="content">
    ${notice}
    ${renderToc(locale, env.toc)}
    <article>
${body}
    </article>
    <footer class="page-footer">
      <p>TRATT ${escapeHtml(ui.site)} · <a href="https://github.com/humlab-speech/TRATT/blob/main/docs/manual/${sourcePath}" target="_blank" rel="noopener">${escapeHtml(ui.edit)}</a></p>
    </footer>
  </main>
</div>
<script>${JS}</script>
</body>
</html>
`;
}

// --- write -------------------------------------------------------------------
const usedAssets = new Set();

if (!process.argv.includes('--no-clean')) {
  rmSync(outRoot, { recursive: true, force: true });
}
mkdirSync(outRoot, { recursive: true });

let pageCount = 0;
const untranslated = [];
for (const locale of LOCALES) {
  const dir = join(outRoot, locale.dir);
  mkdirSync(dir, { recursive: true });
  for (const page of ordered) {
    writeFileSync(join(dir, `${page}.html`), renderPage(locale, page), 'utf8');
    pageCount++;
    if (!sources[locale.code][page].translated) {
      untranslated.push(`${locale.code}/${page}`);
    }
  }
}

if (usedAssets.size > 0) {
  const outAssets = join(outRoot, 'assets');
  mkdirSync(outAssets, { recursive: true });
  for (const file of usedAssets) {
    const from = join(assetsDir, file);
    if (!existsSync(from)) {
      console.error(`Referenced asset is missing: docs/assets/${file}`);
      process.exit(1);
    }
    copyFileSync(from, join(outAssets, file));
  }
}

// --- verify the generated site ----------------------------------------------
// The sources are checked by scripts/check-manual-links.mjs; this checks what
// actually shipped, so a rendering bug cannot publish dead links.
const htmlFiles = [];
for (const locale of LOCALES) {
  for (const page of ordered) {
    htmlFiles.push(join(locale.dir, `${page}.html`));
  }
}
const idsOf = (html) =>
  new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const builtIds = new Map(
  htmlFiles.map((f) => [f, idsOf(readFileSync(join(outRoot, f), 'utf8'))]),
);

const broken = [];
for (const file of htmlFiles) {
  const html = readFileSync(join(outRoot, file), 'utf8');
  const base = dirname(file);
  const check = (ref, kind) => {
    const [target, anchor] = ref.split('#');
    const resolved = join(base, target).replace(/^\.\//, '');
    if (kind === 'href') {
      if (!builtIds.has(resolved)) {
        broken.push(`${file} -> ${ref} (no such page)`);
      } else if (anchor && !builtIds.get(resolved).has(anchor)) {
        broken.push(`${file} -> ${ref} (no such anchor)`);
      }
    } else if (!existsSync(join(outRoot, resolved))) {
      broken.push(`${file} -> ${ref} (missing file)`);
    }
  };
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#)/i.test(m[1])) continue;
    check(m[1], 'href');
  }
  for (const m of html.matchAll(/src="([^"]+)"/g)) {
    if (/^(https?:|data:)/i.test(m[1])) continue;
    check(m[1], 'src');
  }
}

if (broken.length > 0) {
  console.error(`Generated manual has ${broken.length} broken reference(s):`);
  for (const b of broken) console.error(`  - ${b}`);
  process.exit(1);
}

const where = outRoot.replace(`${repoRoot}/`, '');
console.log(
  `Manual built: ${pageCount} pages in ${LOCALES.length} languages ` +
    `(${LOCALES.map((l) => l.code).join(', ')}) and ${usedAssets.size} asset(s) in ${where}; ` +
    `all internal references resolve`,
);
if (untranslated.length > 0) {
  console.log(
    `Not yet translated, published in English: ${untranslated.join(', ')}`,
  );
}
