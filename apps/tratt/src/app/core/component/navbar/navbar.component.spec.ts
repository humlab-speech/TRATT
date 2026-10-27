import { readFileSync } from 'fs';
import { join } from 'path';

const here = __dirname;
const html = readFileSync(join(here, 'navbar.component.html'), 'utf8');

const ts = readFileSync(join(here, 'navbar.component.ts'), 'utf8');

// The component pulls in ESM-only modules that jest cannot load, so the shell
// is checked against its sources.
describe('NavigationComponent header shell', () => {
  it('logo links to the workbench on workbench routes, else /local', () => {
    expect(ts).toContain('public get homeLink(): string');
    expect(ts).toContain('homeLinkFor(this.router.url)');
    expect(html).toContain('[routerLink]="homeLink"');
  });

  it('uses the profile header, logo and centre slot', () => {
    expect(html).toContain('tratt-header');
    expect(html).toContain('<tratt-logo [tagline]="true" />');
    expect(html).toContain('headerSlots.center()');
    expect(html).toContain('id="tratt-theme-slot"');
    expect(html).toContain('fa-layer-group');
  });

  it('no longer carries the old shell bits', () => {
    expect(html).not.toContain('bg-primary');
    expect(html).not.toContain('Github');
    expect(html).not.toContain('versionPopover');
    expect(html).not.toContain('fcffba');
    expect(html).not.toContain('language selector short label');
  });
});
