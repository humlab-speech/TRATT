import Dexie from 'dexie';

/**
 * The app was called OCTRA before the rename to TRATT, so installs from that era
 * hold their transcriptions in databases named after the old product. IndexedDB
 * cannot rename a database, so we keep using the legacy database when one is
 * there and only give fresh installs a TRATT-named one.
 *
 * ponytail: adopting the old name beats copying the stored audio chunks into a
 * new database. Drop the fallback once no OCTRA-era installs are left.
 */
export async function resolveDatabaseName(
  preferred: string,
  legacyNames: string | string[],
): Promise<string> {
  const candidates = (
    Array.isArray(legacyNames) ? legacyNames : [legacyNames]
  ).filter((name) => name !== preferred);

  for (const legacy of candidates) {
    try {
      if (await Dexie.exists(legacy)) {
        return legacy;
      }
    } catch (e) {
      // Dexie.exists can reject in private browsing mode: keep the new name.
    }
  }

  return preferred;
}
