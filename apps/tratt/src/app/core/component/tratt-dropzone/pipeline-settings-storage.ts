/**
 * Remembers a pipeline settings panel's choices per browser, so the
 * workbench doesn't come back from every reload with auto-transcription
 * switched off and the defaults re-selected.
 *
 * localStorage on purpose: these are per-viewer conveniences, not data.
 * Every access is guarded — storage can be unavailable (private windows,
 * blocked site data) and then the panel simply starts from its defaults.
 */
export function loadPipelineSettings<T extends object>(
  key: string | undefined,
): Partial<T> | undefined {
  if (!key) {
    return undefined;
  }
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Partial<T>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function savePipelineSettings<T extends object>(
  key: string | undefined,
  settings: T,
): void {
  if (!key) {
    return;
  }
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(settings));
  } catch {
    // Quota or blocked storage: the settings just won't survive a reload.
  }
}
