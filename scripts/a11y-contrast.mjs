#!/usr/bin/env node
// WCAG colour-contrast check (axe `color-contrast`) in light and dark theme for
// /local, /help-tools, /news, /features and /workbench (file loaded),
// plus the About dialog on /local.
//
// Prerequisites:
//   - npx playwright install chromium
//   - cp apps/tratt/src/config/appconfig_sample.json apps/tratt/src/config/appconfig.json
//     (gitignored; without it the app only shows a config error), then `npm start`
//   - BASE_URL=http://localhost:PORT npm run a11y:contrast  (default port 5321)
//
// Each scan first proves that the theme was applied and the real page rendered,
// and fails when axe evaluated suspiciously few elements, so an empty or error
// page cannot pass.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5321';
const audio = 'apps/tratt/src/media/Bahnauskunft.mp3';
const MIN_PASSES = 10;
const browser = await chromium.launch();
let violations = 0;
let failures = 0;

const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  failures++;
};

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('tratt.theme', t), theme);
  const page = await ctx.newPage();

  const scenarios = [
    { name: '/local', path: '/local', sentinel: '.local-hero__title' },
    { name: '/help-tools', path: '/help-tools', sentinel: 'h2' },
    { name: '/news', path: '/news', sentinel: 'h2, h1', min: 5 },
    { name: '/features', path: '/features', sentinel: 'h2, h1' },
    {
      name: '/local (About dialog)',
      path: '/local',
      sentinel: 'tratt-header-sentinel',
      prepare: async () => {
        await page.getByRole('button', { name: /about/i }).first().click();
        await page.waitForSelector('.modal.show', { timeout: 10_000 });
        // let the fade transition finish so colours are final
        await page.waitForTimeout(500);
      },
    },
    {
      name: '/workbench (file loaded)',
      path: '/workbench',
      sentinel: 'tratt-drop-zone',
      prepare: async () => {
        await page.setInputFiles('tratt-drop-zone input[type=file]', audio);
        await page.waitForSelector('.bundle-list__item', { timeout: 30_000 });
      },
    },
  ];

  for (const { name, path, sentinel, prepare, min = MIN_PASSES } of scenarios) {
    const label = `[${theme}] ${name}`;
    try {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForFunction((t) => document.documentElement.dataset.bsTheme === t, theme, { timeout: 10_000 });
      await page.waitForSelector('nav.tratt-header', { timeout: 10_000 });
      if (sentinel !== 'tratt-header-sentinel') await page.waitForSelector(sentinel, { timeout: 10_000 });
      if (prepare) await prepare();
    } catch (e) {
      fail(`${label}: page did not render as expected (${e.message.split('\n')[0]})`);
      continue;
    }
    if (!new URL(page.url()).pathname.endsWith(path)) {
      fail(`${label}: expected URL ending in ${path}, got ${page.url()}`);
      continue;
    }
    const text = await page.evaluate(() => document.body.innerText);
    if (/Can't load application settings/i.test(text)) {
      fail(`${label}: app shows the config error (missing apps/tratt/src/config/appconfig.json?)`);
      continue;
    }

    const res = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    console.log(
      `${label}: passes=${res.passes.reduce((a, r) => a + r.nodes.length, 0)} ` +
        `violations=${res.violations.reduce((a, r) => a + r.nodes.length, 0)} ` +
        `incomplete=${res.incomplete.reduce((a, r) => a + r.nodes.length, 0)}`,
    );
    const passed = res.passes.reduce((a, r) => a + r.nodes.length, 0);
    if (passed < min) fail(`${label}: only ${passed} elements evaluated (min ${min}); page likely empty`);
    for (const r of res.incomplete) {
      for (const n of r.nodes) console.log(`  incomplete: ${n.target.join(' ')}`);
    }
    for (const v of res.violations) {
      for (const n of v.nodes) {
        console.error(`${label}: ${n.target.join(' ')} – ${n.failureSummary?.split('\n')[1]?.trim()}`);
        violations++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
if (violations || failures) {
  console.error(`\n${violations} contrast violation(s), ${failures} check failure(s)`);
  process.exit(1);
}
console.log('Contrast OK in both themes');
