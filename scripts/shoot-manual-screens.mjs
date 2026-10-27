#!/usr/bin/env node
// Re-shoots the manual and README screenshots in docs/assets (light theme, dpr 2).
//
// Prerequisites (see docs/manual/CONTRIBUTING.md, "Screenshots"):
//   - npx playwright install chromium
//   - a production build served at BASE_URL (default http://localhost:5321) with
//     apps/tratt/src/config/appconfig.json in place
//   - MANUAL_FIXTURES=<dir> holding the synthetic recordings and SRT files,
//     including interview-01-mixed.srt
//
//   MANUAL_FIXTURES=/path/to/fixtures npm run docs:screens
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5321';
const fixtures = process.env.MANUAL_FIXTURES;
const out = resolve('docs/assets');
const BUDGET = 400 * 1024;
const BUDGET_EXEMPT = new Set(['visp_tratt_popup_editor_audio_only.png', 'visp_tratt_popup_editor_audio_and_video.png']);

if (!fixtures || !existsSync(fixtures) || !statSync(fixtures).isDirectory()) {
  console.error(
    'MANUAL_FIXTURES must point to a directory with the synthetic recordings and SRT files ' +
      `(got: ${fixtures ?? 'unset'}).\nSee docs/manual/CONTRIBUTING.md, "Screenshots", for how to create them with espeak-ng.`,
  );
  process.exit(1);
}
if (!existsSync(join(fixtures, 'interview-01-mixed.srt'))) {
  console.error(`MANUAL_FIXTURES (${fixtures}) lacks interview-01-mixed.srt. See docs/manual/CONTRIBUTING.md, "Screenshots".`);
  process.exit(1);
}
const files = readdirSync(fixtures);
const audio = files
  .filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f))
  .sort()
  .map((f) => join(fixtures, f));
const video = files
  .filter((f) => /\.(mp4|webm|mov)$/i.test(f))
  .sort()
  .map((f) => join(fixtures, f));
const srt = join(fixtures, 'interview-01-mixed.srt');
if (!audio.length) {
  console.error(`MANUAL_FIXTURES (${fixtures}) holds no audio files (wav/mp3/ogg/m4a).`);
  process.exit(1);
}

const browser = await chromium.launch();
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: join(out, name), ...opts });
  console.log(`wrote ${name}`);
};
const newPage = async (width, height) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('tratt.theme', 'light'));
  return { ctx, page: await ctx.newPage() };
};
const open = async (page, path) => {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('nav.tratt-header', { timeout: 15_000 });
};
// Loads audio (or video) plus the SRT through the /local drop area.
const loadSession = async (page, withVideo = false) => {
  await open(page, '/local');
  const media = withVideo && video.length ? video[0] : audio[0];
  await page.setInputFiles('input[type=file]', [media, srt]);
  await page.waitForTimeout(1500);
};
const openDialog = async (page, name) => {
  await page.getByRole('button', { name }).first().click();
  await page.waitForSelector('.modal.show', { timeout: 10_000 });
  await page.waitForTimeout(500);
};

console.log(
  'SKIP visp_tratt_auto_transcription_options.png: needs real Chrome with WebGPU, take it by hand (CONTRIBUTING, "Screenshots").',
);

let failures = 0;
const step = async (name, w, h, fn) => {
  const { ctx, page } = await newPage(w, h);
  try {
    await fn(page);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    failures++;
  }
  await ctx.close();
};

await step('visp_tratt_main.png', 1360, 820, async (page) => {
  await open(page, '/local');
  const start = page.getByRole('button', { name: /start/i }).first();
  await start.waitFor();
  const box = await start.boundingBox();
  await shot(page, 'visp_tratt_main.png', {
    clip: { x: 0, y: 0, width: 1360, height: Math.min(820, box.y + box.height + 24) },
  });
});

await step('visp_tratt_draft_automatic_transcription.png', 1360, 820, async (page) => {
  await open(page, '/local');
  await page.setInputFiles('input[type=file]', audio[0]);
  await page.getByRole('button', { name: /transcribe/i }).first().click();
  await page.waitForSelector('[role=progressbar], .progress', { timeout: 30_000 });
  await shot(page, 'visp_tratt_draft_automatic_transcription.png');
});

for (const [name, label] of [
  ['visp_tratt_2d_editor.png', /2d/i],
  ['visp_tratt_linear_editor.png', /linear/i],
  ['visp_tratt_dictaphone_editor.png', /dictaphone/i],
]) {
  await step(name, 1440, 820, async (page) => {
    await loadSession(page);
    await page.getByRole('link', { name: label }).or(page.getByRole('button', { name: label })).first().click();
    await page.waitForTimeout(1000);
    await shot(page, name);
  });
}

for (const [name, withVideo] of [
  ['visp_tratt_popup_editor_audio_only.png', false],
  ['visp_tratt_popup_editor_audio_and_video.png', true],
]) {
  await step(name, 1440, 820, async (page) => {
    await loadSession(page, withVideo);
    await openDialog(page, /transcription window|popup|edit/i);
    await shot(page, name);
  });
}

await step('visp_tratt_overview.png', 1440, 820, async (page) => {
  await loadSession(page);
  await openDialog(page, /overview/i);
  await shot(page, 'visp_tratt_overview.png');
  await shot(page, 'visp_tratt_overview_edit.png');
});

await step('visp_tratt_export_formats.png', 1440, 820, async (page) => {
  await loadSession(page);
  await openDialog(page, /export/i);
  await shot(page, 'visp_tratt_export_formats.png');
});

await step('visp_tratt_workbench.png', 1480, 900, async (page) => {
  await open(page, '/workbench');
  await page.setInputFiles('tratt-drop-zone input[type=file]', audio.slice(0, 4));
  await page.waitForSelector('.bundle-list__item', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, 'visp_tratt_workbench.png');
});

await browser.close();

for (const f of readdirSync(out).filter((f) => f.startsWith('visp_tratt_') && f.endsWith('.png'))) {
  const size = statSync(join(out, f)).size;
  if (size > BUDGET && !BUDGET_EXEMPT.has(f)) console.warn(`WARN ${f} is ${Math.round(size / 1024)} kB (budget 400 kB); optimise it`);
}
console.log('Check every image at full size: no personal data, no stray errors, light theme.');
if (failures) {
  console.error(`${failures} screenshot(s) failed; selectors may need adjusting to the current UI`);
  process.exit(1);
}
