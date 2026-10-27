import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('projects-list template', () => {
  const html = readFileSync(
    join(__dirname, 'projects-list.component.html'),
    'utf8',
  );

  it('starts a project with the next-step button', () => {
    expect(html).toMatch(/class="btn btn-next btn-sm w-100"/);
  });

  it('has no filled colour pills or white text', () => {
    expect(html).not.toContain('text-white');
    expect(html).not.toContain('bg-info');
    expect(html).toContain('tratt-state-info');
  });

  it('paginates with chevron icons', () => {
    for (const icon of ['backward-fast', 'backward', 'forward', 'forward-fast']) {
      expect(html).toContain(`fa-${icon}`);
    }
  });
});
