/**
 * Configuration files written before the rename from OCTRA to TRATT keep the
 * app settings under an "octra" key. Move such a block to "tratt" so existing
 * deployments keep validating against the current schema.
 *
 * ponytail: a rename of the top-level key only. Drop it once every deployment
 * ships a TRATT-era appconfig.json.
 */
export function migrateLegacyConfigKey<T>(config: T): T {
  if (config === null || typeof config !== 'object') {
    return config;
  }

  const entries = config as Record<string, unknown>;
  if (entries['octra'] === undefined || entries['tratt'] !== undefined) {
    return config;
  }

  const { octra, ...rest } = entries;
  return { ...rest, tratt: octra } as T;
}
