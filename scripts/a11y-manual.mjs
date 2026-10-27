#!/usr/bin/env node
// Accessibility check of the built manual (dist/manual, both languages) in light
// and dark theme: colour contrast, links distinguishable in text, page language,
// image alt text, one main landmark, and a skip link.
//
// Prerequisites:
//   - npx playwright install chromium
//   - npm run build:manual
//   - npx http-server dist/manual -p 8081 -c-1   (BASE_URL defaults to http://localhost:8081)
//   - npm run a11y:manual
//
// Each scan proves the theme was applied and the real page rendered, and fails
// when axe evaluated suspiciously few elements, so an empty page cannot pass.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = (process.env.BASE_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const root = 'dist/manual';
const RULES = ['color-contrast', 'link-in-text-block', 'html-has-lang', 'image-alt', 'landmark-one-main', 'skip-link'];
const MIN_PASSES = 5;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [],
  );
let pages;
try {
  pages = walk(root)
    .map((f) => relative(root, f).split(sep).join('/'))
    .sort();
} catch {
  console.error(`${root} not found; run npm run build:manual first`);
  process.exit(1);
}
if (!pages.length) {
  console.error(`no HTML files under ${root}`);
  process.exit(1);
}

const browser = await chromium.launch();
let violations = 0;
let failures = 0;
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  failures++;
};
const count = (list) => list.reduce((a, r) => a + r.nodes.length, 0);

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('tratt.manual.theme', t), theme);
  const page = await ctx.newPage();
  for (const file of pages) {
    const label = `[${theme}] ${file}`;
    try {
      await page.goto(`${base}/${file}`, { waitUntil: 'load' });
      await page.waitForFunction((t) => document.documentElement.dataset.bsTheme === t, theme, { timeout: 10_000 });
      await page.waitForSelector('main h1', { timeout: 10_000 });
    } catch (e) {
      fail(`${label}: page did not render as expected (${e.message.split('\n')[0]})`);
      continue;
    }
    const res = await new AxeBuilder({ page }).withRules(RULES).analyze();
    const passed = count(res.passes);
    console.log(`${label}: passes=${passed} violations=${count(res.violations)} incomplete=${count(res.incomplete)}`);
    if (passed < MIN_PASSES) fail(`${label}: only ${passed} elements evaluated (min ${MIN_PASSES}); page likely empty`);
    for (const r of res.incomplete) for (const n of r.nodes) console.log(`  incomplete (${r.id}): ${n.target.join(' ')}`);
    for (const v of res.violations) {
      for (const n of v.nodes) {
        console.error(`${file} [${theme}]: ${n.target.join(' ')} – ${v.id}: ${n.failureSummary?.split('\n')[1]?.trim()}`);
        violations++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
if (violations || failures) {
  console.error(`\n${violations} violation(s), ${failures} check failure(s)`);
  process.exit(1);
}
console.log(`Manual accessibility OK in both themes (${pages.length} pages)`);
