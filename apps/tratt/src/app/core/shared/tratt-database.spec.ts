import { describe, expect, it, jest } from '@jest/globals';
import { TrattDatabase } from './tratt-database';

describe('TrattDatabase.init()', () => {
  it('rejects when this.open() fails, instead of silently resolving', async () => {
    const db = new TrattDatabase('test-db-init-failure');
    jest.spyOn(db, 'open').mockRejectedValue(new Error('simulated open failure'));

    await expect(db.init()).rejects.toThrow('simulated open failure');
  });
});
