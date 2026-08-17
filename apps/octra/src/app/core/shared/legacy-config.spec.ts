import { describe, expect, it } from '@jest/globals';
import { migrateLegacyConfigKey } from './legacy-config';

describe('migrateLegacyConfigKey', () => {
  it('moves an OCTRA-era block to the tratt key', () => {
    const migrated = migrateLegacyConfigKey({
      version: '1.0.0',
      octra: { supportEmail: 'a@b.c' },
      octraBackend: { enabled: true },
    }) as any;

    expect(migrated.tratt).toEqual({ supportEmail: 'a@b.c' });
    expect(migrated.octra).toBeUndefined();
    expect(migrated.octraBackend).toEqual({ enabled: true });
    expect(migrated.version).toBe('1.0.0');
  });

  it('leaves a current config untouched', () => {
    const config = { version: '1.0.0', tratt: { supportEmail: 'a@b.c' } };
    expect(migrateLegacyConfigKey(config)).toBe(config);
  });

  it('keeps tratt when both keys are present', () => {
    const config = {
      octra: { supportEmail: 'old' },
      tratt: { supportEmail: 'new' },
    };
    expect(migrateLegacyConfigKey(config)).toBe(config);
  });

  it('passes through values that are not objects', () => {
    expect(migrateLegacyConfigKey(undefined)).toBeUndefined();
    expect(migrateLegacyConfigKey(null)).toBeNull();
  });
});
