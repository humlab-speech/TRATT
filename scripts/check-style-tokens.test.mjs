import test from 'node:test';
import assert from 'node:assert/strict';
import { allow, isTsExempt, matchLine, roots } from './check-style-tokens.mjs';

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

test('allowlisted lines are ignored', () => {
  const [loc] = [...allow];
  assert.equal(matchLine('style="background: #000"', { isHtml: true, location: loc }), null);
  assert.equal(matchLine('style="background: #000"', { isHtml: true, location: 'other.html:1' }), 'hex colour');
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

test('libs still flag bare, nested and non-token fallbacks', () => {
  const lib = { location: 'libs/x/a.scss:1' };
  assert.equal(matchLine('  border: 1px solid var(--tratt-border) #fff;', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--tratt-x, var(--y, #fff));', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--other, #fff);', lib), 'hex colour');
  assert.equal(matchLine('  color: var(--tratt-x, red);', lib), 'named colour');
  assert.equal(matchLine('  background-color: whitesmoke;', lib), 'named colour');
});
