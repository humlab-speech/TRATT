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
      expect(html).toContain("'section tratt-page'");
      expect(scss).toMatch(/\.login-card \{[^}]*max-inline-size: 32rem/);
      expect(scss).not.toMatch(/\.login-card \{\s*padding: 3rem/);
    });

    it('has token-based scss; the hero title only sizes itself fluidly', () => {
      expect(scss).toContain('.local-hero__title');
      const title = scss.slice(scss.indexOf('.local-hero__title'));
      const block = title.slice(0, title.indexOf('}'));
      expect(block).not.toMatch(/text-align|font-weight/);
      // The hero lives in a narrower column now, so it may not use the global
      // h1 size, but only a fluid clamp().
      expect(block).toMatch(/font-size: clamp\(/);
      expect(scss).toContain('var(--tratt-danger)');
      expect(scss).toContain('var(--tratt-border-control)');
    });

    // Regression: the work card ended up ~1100 px down the page, below the
    // credits and footer, because `order-2` on #login sorted it after the
    // order-less <tratt-credits>/<tratt-footer> in the flex-column host.
    describe('/local layout order and space', () => {
      it('uses no flex order on #login, so credits and footer stay last', () => {
        expect(html).not.toMatch(/\border(-md)?-\d\b/);
        const login = html.indexOf('id="login"');
        expect(login).toBeGreaterThan(-1);
        expect(html.indexOf('<tratt-credits />')).toBeGreaterThan(login);
        expect(html.indexOf('<tratt-footer />')).toBeGreaterThan(
          html.indexOf('<tratt-credits />'),
        );
      });

      it('puts intro, work card and notes in one grid', () => {
        expect(html).toContain(
          `[class]="localOnly ? 'local-layout' : 'row'" id="loginrow"`,
        );
        expect(html).toContain("localOnly ? 'local-main' : 'col-md-6'");
        expect(html).toContain('class="local-details"');
        // The notes are rendered once per mode: in the card online, beside the
        // card on /local — never in both.
        const notes = html.match(/'login\.local mode description'/g) ?? [];
        expect(notes.length).toBe(2);
        expect(html).toMatch(
          /@if \(!localOnly\) \{\s*<h4>[^]*?'login\.local mode description'/,
        );
      });

      it('shows the card next to the intro from lg and stacks intro → card → notes below', () => {
        const wide = scss.slice(scss.indexOf('.local-layout {'));
        expect(wide).toMatch(/grid-template-columns: minmax\(0, 5fr\) minmax\(0, 7fr\)/);
        expect(wide).toMatch(/'hero card'\s*'details card'/);
        const narrow = scss.slice(scss.indexOf('@media (max-width: 991.98px)'));
        expect(narrow).toMatch(/'hero'\s*'card'\s*'details'/);
      });

      it('keeps the notice and tabs tight inside the /local card', () => {
        expect(html).toContain('class="local-tabs"');
        expect(html).not.toContain('style="margin-top: 40px"');
        expect(scss).toMatch(/\.local-card \.local-tabs \{\s*margin-top: 0\.25rem/);
        expect(scss).toMatch(/\.local-card \{[^]*?\.alert-warning \{/);
      });
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
