import { isWorkbenchRoute } from './workbench-route';

describe('isWorkbenchRoute', () => {
  it.each([
    '/',
    '/?lang=sv',
    '/#top',
    '/workbench',
    '/workbench/',
    '/workbench?x=1',
    '/local',
    '/local?lang=en',
  ])('%s is the workbench', (url) => expect(isWorkbenchRoute(url)).toBe(true));

  it.each([
    '',
    '/login',
    '/intern/transcr',
    '/workbench-v2',
    '/workbench/foo',
    '/local-help',
    '/load',
  ])('%s is not', (url) => expect(isWorkbenchRoute(url)).toBe(false));
});
