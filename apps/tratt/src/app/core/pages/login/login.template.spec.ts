import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(__dirname, 'login.component.html'), 'utf8');
const scss = readFileSync(join(__dirname, 'login.component.scss'), 'utf8');

describe('login template (Språkbanken profile, /login)', () => {
  describe('card', () => {
    it('has no start-page (/local) layout left: that is the workbench now', () => {
      expect(html).not.toContain('localOnly');
      expect(html).not.toContain('local-hero');
      expect(scss).not.toContain('.local-layout');
    });

    it('renders the local-mode title and notes once, in the card', () => {
      expect(html).toContain("<h4>{{ 'login.local mode' | transloco }}</h4>");
      const notes = html.match(/'login\.local mode description'/g) ?? [];
      expect(notes.length).toBe(1);
    });

    it('styles the card, tabs and demo link per profile', () => {
      expect(html).toContain('class="nav-tabs tratt-tabs"');
      expect(html).not.toContain('style="color: #000"');
      expect(html).toContain('class="nav-item ms-auto align-self-center"');
      expect(html).toContain('class="btn btn-link p-0"');
      expect(html).toContain('class="tratt-prose"');
    });

    it('gives the online card its own narrow card and page shell', () => {
      expect(html).toContain('class="section tratt-page"');
      expect(scss).toMatch(/\.login-card \{[^}]*max-inline-size: 32rem/);
      expect(scss).not.toMatch(/\.login-card \{\s*padding: 3rem/);
    });

    it('has token-based scss', () => {
      expect(scss).toContain('var(--tratt-danger)');
      expect(scss).toContain('var(--tratt-border-control)');
    });

    // Regression: the work card ended up ~1100 px down the page, below the
    // credits and footer, because `order-2` on #login sorted it after the
    // order-less <tratt-credits>/<tratt-footer> in the flex-column host.
    describe('layout order', () => {
      it('uses no flex order on #login, so credits and footer stay last', () => {
        expect(html).not.toMatch(/\border(-md)?-\d\b/);
        const login = html.indexOf('id="login"');
        expect(login).toBeGreaterThan(-1);
        expect(html.indexOf('<tratt-credits />')).toBeGreaterThan(login);
        expect(html.indexOf('<tratt-footer />')).toBeGreaterThan(
          html.indexOf('<tratt-credits />'),
        );
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
  });
});
