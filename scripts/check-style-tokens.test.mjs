import test from 'node:test';
import assert from 'node:assert/strict';
import { allow, isFileExempt, isTsExempt, matchLine, roots } from './check-style-tokens.mjs';

test('hex colours are caught', () => {
  assert.equal(matchLine('  color: #fff;'), 'hex colour');
  assert.equal(matchLine('  background: #1a2b3c;'), 'hex colour');
  assert.equal(matchLine('<div style="color:#ff000080">', { isHtml: true }), 'hex colour');
});

test('named colours are caught', () => {
  assert.equal(matchLine('  color: red;'), 'named colour');
  assert.equal(matchLine('  border-top: 1px solid Black;'), 'named colour');
});

test('px font sizes are caught', () => {
  assert.equal(matchLine('  font-size: 12px;'), 'px font-size');
  assert.equal(matchLine('  font-size: 1.5px;'), 'px font-size');
});

test('tokens are ignored', () => {
  assert.equal(matchLine('  color: var(--tratt-x);'), null);
  assert.equal(matchLine('  color: var(--tratt-accent-green);'), null);
  assert.equal(matchLine('  font-size: var(--tratt-font-sm);'), null);
});

test('#ref template variables in html are ignored', () => {
  assert.equal(matchLine('<input #fileInput type="file" />', { isHtml: true }), null);
  assert.equal(matchLine('<ng-template #abc123>', { isHtml: true }), null);
});

test('allowlist is keyed by file and line content, not line number', () => {
  const a = allow[0];
  const html = { isHtml: true };
  for (const line of [1, 190, 9999]) {
    assert.equal(matchLine('style="width: 100%; background: #000"', { ...html, location: `${a.file}:${line}` }), null);
  }
  // other line content in the same file, or the same content in another file, is still flagged
  assert.equal(matchLine('style="background: #123456"', { ...html, location: `${a.file}:190` }), 'hex colour');
  assert.equal(matchLine('style="background: #000"', { ...html, location: 'other.html:1' }), 'hex colour');
  for (const e of allow) assert.ok(e.reason, e.file);
});

test('beta badge text-bg-secondary is allowlisted in the navbar only', () => {
  const line = '<span class="badge rounded-pill text-bg-secondary ms-2">beta</span>';
  const nav = 'apps/tratt/src/app/core/component/navbar/navbar.component.html';
  assert.equal(matchLine(line, { isHtml: true, location: `${nav}:22` }), null);
  assert.equal(matchLine(line, { isHtml: true, location: 'apps/tratt/src/app/x.html:22' }), 'banned class');
});

test('rgb/rgba/hsl/hsla literals are flagged', () => {
  assert.equal(matchLine('  background-color: rgb(242, 242, 242);'), 'colour function');
  assert.equal(matchLine('  color: rgba(42, 71, 101, 0.8);'), 'colour function');
  assert.equal(matchLine('  color: hsl(210 50% 40%);'), 'colour function');
  assert.equal(matchLine('  color: hsla(210, 50%, 40%, .5);'), 'colour function');
  assert.equal(matchLine('  color: rgb(0, 0, 0);'), 'colour function', 'opaque black is not an overlay');
  assert.equal(matchLine('  color: rgba(0, 0, 1, 0.5);'), 'colour function');
  assert.equal(matchLine('<i style="color: rgb(1, 2, 3)">', { isHtml: true }), 'colour function');
  assert.equal(matchLine("  ctx.fillStyle = 'rgb(1, 2, 3)';", { isTs: true }), 'colour function');
});

test('translucent black/white overlays and color-mix are exempt from the rgb rule', () => {
  assert.equal(matchLine('  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);'), null);
  assert.equal(matchLine('  background: rgba(255, 255, 255, 0.5);'), null);
  assert.equal(matchLine('  background: rgb(0 0 0 / 40%);'), null);
  assert.equal(matchLine('  background: color-mix(in srgb, rgb(1, 2, 3) 20%, white);'), null);
  assert.equal(matchLine("  shadowColor: 'rgba(0, 0, 0, 0.25)',", { isTs: true }), null);
});

test('named colours inside color-mix() are exempt', () => {
  assert.equal(matchLine('  --x: color-mix(in srgb, var(--sb-orange) 70%, black);'), null);
  assert.equal(matchLine('  color: black;'), 'named colour');
});

test('more Bootstrap colour utilities are banned', () => {
  for (const c of ['bg-success', 'bg-info', 'bg-warning', 'bg-danger', 'text-bg-success', 'text-bg-danger', 'text-bg-secondary', 'text-light', 'text-white']) {
    assert.equal(matchLine(`<div class="x ${c}">`, { isHtml: true }), 'banned class', c);
  }
  assert.equal(matchLine('<div class="bg-success-subtle text-body-secondary">', { isHtml: true }), null);
  assert.equal(matchLine('<div class="text-lightish">', { isHtml: true }), null);
});

test('stylesheet roots are linted, palette files are exempt', () => {
  assert.ok(roots.includes('apps/tratt/src/styles.scss'));
  assert.ok(roots.includes('apps/tratt/src/styles'));
  for (const f of ['_palette', '_tokens', '_bootstrap-config']) assert.ok(isFileExempt(`apps/tratt/src/styles/${f}.scss`), f);
  assert.ok(!isFileExempt('apps/tratt/src/styles/_buttons.scss'));
  assert.ok(!isFileExempt('apps/tratt/src/styles.scss'));
  assert.equal(matchLine('  border: 1px solid grey;', { location: 'apps/tratt/src/styles.scss:119' }), 'named colour');
});

test('var() fallbacks are flagged in the app stylesheets, allowed in libs', () => {
  const line = '  color: var(--tratt-danger-text, #aa1b1e);';
  assert.equal(matchLine(line, { location: 'apps/tratt/src/styles/_buttons.scss:1' }), 'hex colour');
  assert.equal(matchLine(line, { location: 'apps/tratt/src/styles.scss:1' }), 'hex colour');
  assert.equal(matchLine(line, { location: 'libs/x/a.scss:1' }), null);
});

test('literal fallbacks in token var() are allowed in libs only', () => {
  const line = '  color: var(--tratt-danger-text, #aa1b1e);';
  assert.equal(matchLine(line, { location: 'libs/x/a.scss:1' }), null);
  assert.equal(matchLine(line, { location: 'apps/tratt/src/app/a.scss:1' }), 'hex colour');
  assert.equal(matchLine(line), 'hex colour');
  assert.equal(matchLine(line, { lib: true }), null);
});

test('.ts lines are flagged only in colour contexts', () => {
  const ts = { isTs: true };
  assert.equal(matchLine("  ctx.fillStyle = '#222';", ts), 'hex colour');
  assert.equal(matchLine("  styles: ['.a { color: #fff; }'],", ts), 'hex colour');
  assert.equal(matchLine(`  icon: '<i style="color: white;"></i>',`, ts), 'named colour');
  assert.equal(matchLine("  stroke: '#123456',", ts), 'hex colour');
  assert.equal(matchLine("  const id = '#abc123';", ts), null);
  assert.equal(matchLine('  ctx.fillStyle = colors.textPrimary;', ts), null);
});

test('banned Bootstrap classes are flagged in html and ts', () => {
  for (const c of ['btn-success', 'navbar-dark', 'bg-primary', 'bg-white', 'bg-light', 'text-dark', 'btn-dark', 'btn-light']) {
    assert.equal(matchLine(`<div class="x ${c}">`, { isHtml: true }), 'banned class', c);
    assert.equal(matchLine(`  template: '<div class="${c}"></div>',`, { isTs: true }), 'banned class', c);
  }
  assert.equal(matchLine('<div class="bg-body-tertiary text-body btn-primary">', { isHtml: true }), null);
  assert.equal(matchLine('<div class="bg-primary-subtle">', { isHtml: true }), null);
  assert.equal(matchLine('<div class="not-btn-success">', { isHtml: true }), null);
});

test('index.html and the other entry points are roots', () => {
  for (const r of ['apps/tratt/src/index.html', 'apps/web-components/src', 'scripts/manual-assets']) {
    assert.ok(roots.includes(r), r);
  }
});

test('exempt .ts files are skipped, others are not', () => {
  assert.ok(isTsExempt('libs/ngx-components/src/lib/obj/tratt-colors.ts'));
  assert.ok(isTsExempt('libs/ngx-components/src/lib/obj/speaker-colors.ts'));
  assert.ok(isTsExempt('libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.config.ts'));
  assert.ok(isTsExempt('apps/tratt/src/app/a.spec.ts'));
  assert.ok(isTsExempt('apps/tratt/src/app/a.test.ts'));
  assert.ok(!isTsExempt('apps/tratt/src/app/a.component.ts'));
  assert.ok(!isTsExempt('libs/ngx-components/src/lib/obj/other-colors.ts'));
});

test('index.html splash may use token fallbacks; bare hex still flagged', () => {
  const line = '  background: var(--tratt-surface-sunken, #ebebeb) !important;';
  assert.equal(matchLine(line, { location: 'apps/tratt/src/index.html:100' }), null);
  assert.equal(matchLine(line, { location: 'apps/tratt/src/app/a.scss:1' }), 'hex colour');
  assert.equal(matchLine('  background: #ebebeb;', { location: 'apps/tratt/src/index.html:100' }), 'hex colour');
});

test('canvas gradient stops, shadowColor and [style.] bindings are linted in .ts', () => {
  const ts = { isTs: true };
  assert.equal(matchLine("  g.addColorStop(0, '#22c55e');", ts), 'hex colour');
  assert.equal(matchLine("  ctx.shadowColor = '#000';", ts), 'hex colour');
  assert.equal(matchLine("  template: '<i [style.color]=\"'#fff'\"></i>',", ts), 'hex colour');
  assert.equal(matchLine('  g.addColorStop(0, TRATT_COLORS.accentSuccess);', ts), null);
});

test('libs still flag bare, nested and non-token fallbacks', () => {
  const lib = { location: 'libs/x/a.scss:1' };
  assert.equal(matchLine('  border: 1px solid var(--tratt-border) #fff;', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--tratt-x, var(--y, #fff));', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--other, #fff);', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--tratt-x, red);', lib), 'named colour');
  assert.equal(matchLine('  background-color: whitesmoke;', lib), 'named colour');
});
