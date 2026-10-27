import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe.each([
  ['auto-transcribe-options.component.ts', 'autoTranscribeCheck'],
  ['auto-translate-options.component.ts', 'autoTranslateCheck'],
])('%s fold-out with switch', (file, checkId) => {
  const src = read(file);

  it('uses the head row with chevron, title and switch', () => {
    expect(src).toContain('class="ato-head"');
    expect(src).toContain('ato-chevron');
    expect(src).toContain('[class.fa-chevron-down]="enabled()"');
    expect(src).toContain('[class.fa-chevron-right]="!enabled()"');
    expect(src).toContain('class="ato-title"');
    expect(src).toContain('form-check form-switch ms-auto mb-0');
    expect(src).toContain('role="switch"');
    expect(src).toContain('type="checkbox"');
    expect(src).toContain(checkId);
  });

  it('uses the new container classes and token styles', () => {
    expect(src).toContain('mt-3 p-3 border"');
    expect(src).not.toContain('mt-2 p-2 border rounded');
    expect(src).toContain('background: var(--tratt-surface-page)');
    expect(src).toContain('border-color: var(--tratt-border) !important');
    expect(src).toContain('var(--tratt-interactive-text)');
    expect(src).not.toContain('--tratt-surface-background');
  });

  it('gives field labels fw-medium', () => {
    for (const m of src.matchAll(/class="form-label[^"]*"/g)) {
      expect(m[0]).toContain('fw-medium');
    }
  });
});
