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

    it('gives the online card its own narrow card and page shell', () => {
      expect(html).toContain("'section order-2 order-md-1 tratt-page'");
      expect(scss).toMatch(/\.login-card \{[^}]*max-inline-size: 32rem/);
      expect(scss).not.toMatch(/\.login-card \{\s*padding: 3rem/);
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

    it('uses token panels, theme progress bars and the next-step button', () => {
      expect(html).toContain('class="transcription-progress tratt-panel mt-3"');
      expect(html).toContain('class="translation-progress tratt-panel mt-3"');
      expect(html).not.toContain('bg-light');
      expect(html).not.toContain('bg-success');
      expect(html).not.toContain('bg-info');
      expect(html).toContain('class="btn btn-next-lg"');
      expect(html).toContain('btn btn-raised btn-danger offline-delete-btn');
      expect(html).toContain('class="alert alert-info mb-0 py-1 small"');
      expect(html).not.toContain('font-size: 0.8rem');
    });

    it('every progressbar has aria value range, value and label', () => {
      const bars = html.match(/<div[^>]*role="progressbar"[^>]*>/g) ?? [];
      expect(bars.length).toBe(6);
      for (const b of bars) {
        expect(b).toContain('aria-valuemin="0"');
        expect(b).toContain('aria-valuemax="100"');
        // The indeterminate bar (striped, animated) has no value by design.
        if (!b.includes('progress-bar-animated')) {
          expect(b).toMatch(/aria-valuenow="100"|\[attr\.aria-valuenow\]=/);
        } else {
          expect(b).not.toContain('aria-valuenow');
        }
        expect(b).toContain('[attr.aria-label]=');
      }
    });

    it('recording levels use tokens (yellow in the middle)', () => {
      const rp = readFileSync(
        join(
          __dirname,
          '../../component/recording-panel/recording-panel.component.scss',
        ),
        'utf8',
      );
      expect(rp).toMatch(/--green \{\s*color: var\(--tratt-success\)/);
      expect(rp).toMatch(/--orange \{\s*color: var\(--tratt-warning\)/);
      expect(rp).toMatch(/--red \{\s*color: var\(--tratt-danger\)/);
      expect(rp).not.toMatch(/#[0-9a-f]{6}/i);
    });

    it.each(locales)('has hero texts in %s', (l) => {
      const json = JSON.parse(readFileSync(join(i18nDir, `${l}.json`), 'utf8'));
      expect(typeof json.login.hero.part_of).toBe('string');
      expect(typeof json.login.hero.privacy).toBe('string');
    });
  });
});
