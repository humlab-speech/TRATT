#!/usr/bin/env node
// WCAG colour-contrast check for /local and /workbench in both themes.
// Needs a running dev server: `npm start`, then `npm run a11y:contrast`.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5321';
const audio = 'apps/tratt/src/media/Bahnauskunft.mp3';
const browser = await chromium.launch();
let violations = 0;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('tratt.theme', t), theme);
  const page = await ctx.newPage();

  for (const [name, path, prepare] of [
    ['/local', '/local', async () => {}],
    ['/help-tools', '/help-tools', async () => {}],
    ['/news (redirects to reload-file)', '/news', async () => {}],
    [
      '/workbench (file loaded)',
      '/workbench',
      async () => {
        await page.setInputFiles('tratt-drop-zone input[type=file]', audio);
        await page.waitForSelector('.bundle-list__item', { timeout: 30_000 });
      },
    ],
  ]) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await prepare();
    const res = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    for (const v of res.violations) {
      for (const n of v.nodes) {
        console.error(`[${theme}] ${name}: ${n.target.join(' ')} – ${n.failureSummary?.split('\n')[1]?.trim()}`);
        violations++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
if (violations) {
  console.error(`\n${violations} contrast violation(s)`);
  process.exit(1);
}
console.log('Contrast OK in both themes');
