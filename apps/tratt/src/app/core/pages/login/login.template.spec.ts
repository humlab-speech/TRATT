import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(__dirname, 'login.component.html'), 'utf8');
const scss = readFileSync(join(__dirname, 'login.component.scss'), 'utf8');
const i18nDir = join(__dirname, '../../../../assets/i18n');
const locales = ['sv', 'en', 'de', 'it', 'ko', 'nl', 'zh'];

describe('login template (Språkbanken profile, /local)', () => {
  describe('hero and card', () => {
    it('renders the hero without the inlined banner', () => {
      expect(html).toContain('class="local-hero"');
      expect(html).toContain("'login.hero.part_of' | transloco");
      expect(html).toContain("'login.hero.privacy' | transloco");
      expect(html).toContain('<h1 class="local-hero__title">');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('<hr');
    });

    it('keeps the h4 local-mode title only for the online layout', () => {
      expect(html).toMatch(
        /@if \(!localOnly\) \{\s*<h4>\{\{ 'login\.local mode' \| transloco \}\}<\/h4>/,
      );
    });

    it('styles the card, tabs and demo link per profile', () => {
      expect(html).toContain('[class.local-card]="localOnly"');
      expect(html).toContain('class="nav-tabs tratt-tabs"');
      expect(html).not.toContain('style="color: #000"');
      expect(html).toContain('class="nav-item ms-auto align-self-center"');
      expect(html).toContain('class="btn btn-link p-0"');
      expect(html).toContain('class="tratt-prose"');
    });

    it('has token-based scss and no hero title overrides of global h1', () => {
      expect(scss).toContain('.local-hero__title');
      const title = scss.slice(scss.indexOf('.local-hero__title'));
      const block = title.slice(0, title.indexOf('}'));
      expect(block).not.toMatch(/text-align|font-weight|font-size/);
      expect(scss).toContain('var(--tratt-danger)');
      expect(scss).toContain('var(--tratt-border-control)');
      expect(scss).toContain('padding: 3rem');
    });

    it.each(locales)('has hero texts in %s', (l) => {
      const json = JSON.parse(readFileSync(join(i18nDir, `${l}.json`), 'utf8'));
      expect(typeof json.login.hero.part_of).toBe('string');
      expect(typeof json.login.hero.privacy).toBe('string');
    });
  });
});
