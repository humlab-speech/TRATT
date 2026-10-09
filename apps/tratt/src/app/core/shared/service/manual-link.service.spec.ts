import { manualPageForUrl } from './manual-link.service';

describe('manualPageForUrl', () => {
  it('sends the workbench to its own chapter', () => {
    expect(manualPageForUrl('/workbench')).toBe('workbench');
  });

  it('ignores query parameters and fragments', () => {
    expect(manualPageForUrl('/workbench?lang=sv')).toBe('workbench');
    expect(manualPageForUrl('/workbench#files')).toBe('workbench');
  });

  it('matches child routes of a mapped route', () => {
    expect(manualPageForUrl('/workbench/anything')).toBe('workbench');
  });

  it('does not match a route that merely starts with the same letters', () => {
    expect(manualPageForUrl('/workbenchers')).toBeUndefined();
  });

  it('leaves every other route on the front page', () => {
    expect(manualPageForUrl('/local')).toBeUndefined();
    expect(manualPageForUrl('/intern/transcr')).toBeUndefined();
    expect(manualPageForUrl('/')).toBeUndefined();
  });
});
