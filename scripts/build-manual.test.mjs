import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let out;
const page = (f) => readFileSync(join(out, f), 'utf8');

before(() => {
  out = mkdtempSync(join(tmpdir(), 'tratt-manual-'));
  execFileSync(process.execPath, [join(repoRoot, 'scripts', 'build-manual.mjs'), '--out', out], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
});
after(() => rmSync(out, { recursive: true, force: true }));

test('front page sets the theme before the styles and says Tratt, not TRATT', () => {
  const html = page('index.html');
  assert.match(html, /data-bs-theme/);
  assert.match(html, /tratt\.manual\.theme/);
  assert.ok(html.indexOf('data-bs-theme') < html.indexOf('<style>'));
  assert.match(html, /Tratt/);
  assert.doesNotMatch(html, /TRATT <span|TRATT manual|>TRATT</);
});

test('fonts are self-hosted with paths relative to each page', () => {
  assert.match(page('index.html'), /url\(assets\/fonts\//);
  const sv = page('sv/index.html');
  assert.match(sv, /url\(\.\.\/assets\/fonts\//);
  for (const f of ['index.html', 'sv/index.html']) {
    assert.doesNotMatch(page(f), /url\(\s*['"]?https?:/);
  }
});

test('a blockquote starting with Warning is a yellow callout', () => {
  // Built from a copy of the sources with two probe quotes appended.
  const src = mkdtempSync(join(tmpdir(), 'tratt-manual-src-'));
  const out2 = mkdtempSync(join(tmpdir(), 'tratt-manual-out-'));
  try {
    cpSync(join(repoRoot, 'docs', 'manual'), src, { recursive: true });
    appendFileSync(
      join(src, 'index.md'),
      '\n\n> **Warning** this does not work yet.\n\n> A plain explanation.\n',
    );
    execFileSync(process.execPath, [join(repoRoot, 'scripts', 'build-manual.mjs'), '--out', out2, '--src', src], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    const html = readFileSync(join(out2, 'index.html'), 'utf8');
    assert.match(html, /<blockquote class="callout-warning">\s*<p><strong>Warning<\/strong>/);
    assert.match(html, /<blockquote>\s*<p>A plain explanation/);
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(out2, { recursive: true, force: true });
  }
});

test('compiled CSS has colour literals only in the token blocks', () => {
  const css = page('index.html').match(/<style>([\s\S]*?)<\/style>/)[1];
  const rest = css
    .replace(/@font-face\{[^}]*\}/g, '')
    .replace(/(?::root|\[data-bs-theme(?:=[^\]]*)?\])(?:,\s*(?::root|\[data-bs-theme(?:=[^\]]*)?\]))*\{[^}]*\}/g, '');
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/);
});

test('footer carries the Språkbanken links and the icon licence', () => {
  const html = page('sv/index.html');
  assert.match(html, /class="site-footer"/);
  assert.match(html, /Kontakta oss/);
  assert.match(html, /CC BY 4\.0/);
  assert.doesNotMatch(html, /class="repo"/);
});
