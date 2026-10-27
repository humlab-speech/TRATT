import assert from 'node:assert/strict';
import test from 'node:test';
import { allow, matchLine } from './check-style-tokens.mjs';

test('hex colours are caught', () => {
  assert.equal(matchLine('  color: #fff;'), 'hex colour');
  assert.equal(matchLine('  background: #1a2b3c;'), 'hex colour');
  assert.equal(
    matchLine('<div style="color:#ff000080">', { isHtml: true }),
    'hex colour',
  );
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
  assert.equal(
    matchLine('<input #fileInput type="file" />', { isHtml: true }),
    null,
  );
  assert.equal(matchLine('<ng-template #abc123>', { isHtml: true }), null);
});

test('literal fallbacks inside token var() are allowed', () => {
  assert.equal(matchLine('  color: var(--tratt-danger-text, #aa1b1e);'), null);
  assert.equal(matchLine('  color: var(--other, #aa1b1e);'), 'hex colour');
});

test('allowlisted lines are ignored', () => {
  const [loc] = [...allow];
  assert.equal(
    matchLine('style="background: #000"', { isHtml: true, location: loc }),
    null,
  );
  assert.equal(
    matchLine('style="background: #000"', {
      isHtml: true,
      location: 'other.html:1',
    }),
    'hex colour',
  );
});
