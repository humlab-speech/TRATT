/**
 * True when `url` is the `/workbench` route or a sub-path/query/hash of it.
 * Deliberately anchored (not a plain `startsWith('/workbench')` check) so it
 * doesn't also match a hypothetical future route like `/workbench-v2`.
 */
export function isWorkbenchRoute(url: string): boolean {
  return /^\/workbench(\/|\?|#|$)/.test(url);
}

/** Where the header logo points: the start of the current mode. */
export function homeLinkFor(url: string): '/workbench' | '/local' {
  return isWorkbenchRoute(url) ? '/workbench' : '/local';
}
