/**
 * True when `url` is the workbench, i.e. the start page `/`, or one of its
 * old addresses (`/workbench`, `/local`), which redirect there. Anchored on
 * whole path segments, so `/local-help` or `/workbench-v2` don't match.
 */
export function isWorkbenchRoute(url: string): boolean {
  return /^\/((workbench|local)\/?)?([?#]|$)/.test(url);
}
