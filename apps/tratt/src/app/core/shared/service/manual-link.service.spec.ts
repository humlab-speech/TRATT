import { manualPageForUrl } from './manual-link.service';

describe('manualPageForUrl', () => {
  it('sends the start page (the workbench) to the workbench chapter', () => {
    expect(manualPageForUrl('/')).toBe('workbench');
  });

  it('ignores query parameters and fragments', () => {
    expect(manualPageForUrl('/?lang=sv')).toBe('workbench');
    expect(manualPageForUrl('/#files')).toBe('workbench');
  });

  it('leaves every other route on the front page', () => {
    expect(manualPageForUrl('/login')).toBeUndefined();
    expect(manualPageForUrl('/intern/transcr')).toBeUndefined();
    expect(manualPageForUrl('/news')).toBeUndefined();
  });
});
