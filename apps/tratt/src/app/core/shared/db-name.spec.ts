import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import Dexie from 'dexie';
import { resolveDatabaseName } from './db-name';

describe('resolveDatabaseName', () => {
  let existing: string[] = [];

  beforeEach(() => {
    existing = [];
    jest
      .spyOn(Dexie, 'exists')
      .mockImplementation(
        (name: string) => Promise.resolve(existing.includes(name)) as any,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the new name when no legacy database exists', async () => {
    expect(await resolveDatabaseName('tratt', ['octra-2', 'octra'])).toBe(
      'tratt',
    );
  });

  it('keeps an existing legacy database so data is not orphaned', async () => {
    existing = ['octra-2'];
    expect(await resolveDatabaseName('tratt', ['octra-2', 'octra'])).toBe(
      'octra-2',
    );
  });

  it('prefers the first matching legacy name', async () => {
    existing = ['octra'];
    expect(await resolveDatabaseName('tratt', ['octra-2', 'octra'])).toBe(
      'octra',
    );
  });

  it('falls back to the new name when the existence check throws', async () => {
    jest
      .spyOn(Dexie, 'exists')
      .mockImplementation(() => Promise.reject(new Error('private browsing')));
    expect(await resolveDatabaseName('tratt', 'octra-2')).toBe('tratt');
  });
});
