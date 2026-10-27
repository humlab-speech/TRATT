import { homeLinkFor } from './home-link';

describe('homeLinkFor', () => {
  it.each(['/workbench', '/workbench?x=1', '/workbench/foo'])(
    '%s -> /workbench',
    (url) => expect(homeLinkFor(url)).toBe('/workbench'),
  );
  it.each(['/local', '/', '/workbench-v2'])('%s -> /local', (url) =>
    expect(homeLinkFor(url)).toBe('/local'),
  );
});
