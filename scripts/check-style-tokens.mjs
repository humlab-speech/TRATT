#!/usr/bin/env node
// Fails on hard-coded colours or px font sizes in component styles and inline
// styles. Colours belong in apps/tratt/src/styles/_palette.scss (Språkbanken profile).
// --report: print violation counts per directory and exit 0.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const roots = ['apps/tratt/src/app', 'libs/ngx-components/src'];
const exts = /\.(scss|css|html)$/;
// "file:line" entries that are deliberate, each with a reason.
export const allow = new Set([
  // Recording preview is intentionally black in both themes.
  'apps/tratt/src/app/core/component/recording-panel/recording-panel.component.html:190',
]);
export const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
export const NAMED =
  /\b(?:color|background(?:-color)?|border(?:-[a-z]+)*|fill|stroke|accent-color)\s*:[^;]*\b(red|green|blue|black|white|gray|grey|yellow|lightgr[ae]y|dimgr[ae]y)\b/i;
export const PX_FONT = /font-size\s*:\s*\d+(?:\.\d+)?px/;

/** Returns the violation kind for one line, or null. */
export function matchLine(line, { isHtml = false, location = '' } = {}) {
  if (allow.has(location)) return null;
  // In templates only inline styles count (incl. multi-line style="…" and
  // [ngStyle] objects); `#ref` template variables are not colours.
  if (isHtml && !/style|^\s*'?[a-z-]+'?\s*:/i.test(line)) return null;
  // Token names such as var(--tratt-accent-green) are not named colours.
  // Library code reads tokens with a literal fallback: var(--tratt-x, #abc).
  const noFallback = line.replace(
    /var\(--(?:tratt|sb)-[a-z-]+,\s*#[0-9a-fA-F]{3,8}\)/g,
    'var()',
  );
  const bare = line.replace(/var\([^)]*\)/g, 'var()');
  return (
    (HEX.test(noFallback) && 'hex colour') ||
    (NAMED.test(bare) && 'named colour') ||
    (PX_FONT.test(line) && 'px font-size') ||
    null
  );
}

function scan() {
  const hits = [];
  for (const root of roots) {
    for (const rel of readdirSync(root, { recursive: true })) {
      const file = join(root, String(rel));
      if (!exts.test(file)) continue;
      const isHtml = file.endsWith('.html');
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const hit = matchLine(line, { isHtml, location: `${file}:${i + 1}` });
          if (hit)
            hits.push({ file, root, line: i + 1, hit, text: line.trim() });
        });
    }
  }
  return hits;
}

function main() {
  const report = process.argv.includes('--report');
  const hits = scan();
  if (report) {
    const perDir = new Map();
    for (const h of hits) {
      // root + up to two directory segments below it
      const dirs = dirname(h.file.slice(h.root.length + 1))
        .split('/')
        .filter((s) => s !== '.')
        .slice(0, 2);
      const key = [h.root, ...dirs].join('/');
      perDir.set(key, (perDir.get(key) ?? 0) + 1);
    }
    for (const [dir, n] of [...perDir].sort())
      console.log(`${String(n).padStart(5)}  ${dir}`);
    console.log(`${String(hits.length).padStart(5)}  TOTAL`);
    return;
  }
  for (const h of hits)
    console.error(`${h.file}:${h.line}  ${h.hit}: ${h.text}`);
  if (hits.length) {
    console.error(
      `\n${hits.length} style violation(s). Use tokens from apps/tratt/src/styles/_tokens.scss.`,
    );
    process.exit(1);
  }
  console.log('Style tokens OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
