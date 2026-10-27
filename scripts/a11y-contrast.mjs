#!/usr/bin/env node
// WCAG colour-contrast check (axe `color-contrast`) in light and dark theme for
// every route reachable without signing in (/local, /help-tools, /news,
// /features, /test, /404, /load and /workbench with a file loaded), plus the
// About dialog on /local and the "Export all" dialog on /workbench.
// /login and /intern/* need a signed-in session and are checked by hand.
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
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

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

  // Files persist in IndexedDB across loads in one context: only add when absent.
  const loadFile = async () => {
    if (!(await page.$('.bundle-list__item'))) {
      await page.setInputFiles('tratt-drop-zone input[type=file]', audio);
    }
    await page.waitForSelector('.bundle-list__item', { timeout: 30_000 });
  };

  const scenarios = [
    { name: '/local', path: '/local', sentinel: '.local-hero__title' },
    { name: '/help-tools', path: '/help-tools', sentinel: 'h2' },
    { name: '/news', path: '/news', sentinel: 'h2, h1', min: 5 },
    { name: '/features', path: '/features', sentinel: 'h2, h1' },
    { name: '/test', path: '/test', sentinel: 'h2', min: 5, inApp: true },
    // /test and /load redirect to /local on a cold load (the app-initialised
    // and config guards): reach them through the router instead (`inApp`).
    // The 404 route is an explicit path; unknown URLs redirect to /local.
    { name: '/404', path: '/404', sentinel: '.tratt-page h1', min: 3 },
    {
      name: '/load',
      path: '/load',
      sentinel: '#loading .progress',
      min: 3,
      inApp: true,
    },
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
      prepare: loadFile,
    },
    {
      name: '/workbench (Export all dialog)',
      path: '/workbench',
      sentinel: 'tratt-drop-zone',
      prepare: async () => {
        await loadFile();
        await page.getByRole('button', { name: /export all/i }).click();
        await page.waitForSelector('.modal.show', { timeout: 10_000 });
        await page.waitForTimeout(500);
      },
    },
  ];

  for (const {
    name,
    path,
    sentinel,
    prepare,
    min = MIN_PASSES,
    inApp,
  } of scenarios) {
    const label = `[${theme}] ${name}`;
    try {
      if (inApp) {
        await page.goto(base + '/local', { waitUntil: 'networkidle' });
        await page.evaluate((to) => {
          history.pushState({}, '', to);
          dispatchEvent(new PopStateEvent('popstate'));
        }, path);
      } else {
        await page.goto(base + path, { waitUntil: 'networkidle' });
      }
      await page.waitForFunction(
        (t) => document.documentElement.dataset.bsTheme === t,
        theme,
        { timeout: 10_000 },
      );
      await page.waitForSelector('nav.tratt-header', { timeout: 10_000 });
      if (sentinel !== 'tratt-header-sentinel')
        await page.waitForSelector(sentinel, { timeout: 10_000 });
      if (prepare) await prepare();
    } catch (e) {
      fail(
        `${label}: page did not render as expected (${e.message.split('\n')[0]})`,
      );
      continue;
    }
    if (!new URL(page.url()).pathname.endsWith(path)) {
      fail(`${label}: expected URL ending in ${path}, got ${page.url()}`);
      continue;
    }
    const text = await page.evaluate(() => document.body.innerText);
    if (/Can't load application settings/i.test(text)) {
      fail(
        `${label}: app shows the config error (missing apps/tratt/src/config/appconfig.json?)`,
      );
      continue;
    }

    const res = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    console.log(
      `${label}: passes=${res.passes.reduce((a, r) => a + r.nodes.length, 0)} ` +
        `violations=${res.violations.reduce((a, r) => a + r.nodes.length, 0)} ` +
        `incomplete=${res.incomplete.reduce((a, r) => a + r.nodes.length, 0)}`,
    );
    const passed = res.passes.reduce((a, r) => a + r.nodes.length, 0);
    if (passed < min)
      fail(
        `${label}: only ${passed} elements evaluated (min ${min}); page likely empty`,
      );
    for (const r of res.incomplete) {
      for (const n of r.nodes)
        console.log(`  incomplete: ${n.target.join(' ')}`);
    }
    for (const v of res.violations) {
      for (const n of v.nodes) {
        console.error(
          `${label}: ${n.target.join(' ')} – ${n.failureSummary?.split('\n')[1]?.trim()}`,
        );
        violations++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
if (violations || failures) {
  console.error(
    `\n${violations} contrast violation(s), ${failures} check failure(s)`,
  );
  process.exit(1);
}
console.log('Contrast OK in both themes');
