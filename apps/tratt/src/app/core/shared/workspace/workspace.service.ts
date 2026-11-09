import { Injectable, computed, signal } from '@angular/core';
import { AppSettings } from '../../obj/Settings/app-settings';
import {
  LOCAL_WORKSPACE,
  Workspace,
  WorkspaceResolution,
  resolveWorkspace,
} from './workspace';

/**
 * The page's workspace lives at module level, not per instance: it is resolved
 * once per page load and never changes, and some effects are constructed with
 * `new` in specs (outside an injection context). Every WorkspaceService —
 * injected or not — therefore sees the same resolution.
 */
const resolution = signal<WorkspaceResolution | undefined>(undefined);

/** Test seam: forget the resolved workspace. */
export function _resetWorkspaceResolution(): void {
  resolution.set(undefined);
}

/**
 * Holds the workspace resolved at boot. Resolved once and immutable for the
 * page's lifetime: later calls return the first result.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  /** The resolved workspace; local until resolved. */
  readonly workspace = computed<Workspace>(() => {
    const r = resolution();
    return r?.ok ? r.workspace : LOCAL_WORKSPACE;
  });
  readonly isVisp = computed(() => this.workspace().kind === 'visp');
  readonly error = computed(() => {
    const r = resolution();
    return r && !r.ok ? r.error : undefined;
  });

  resolve(search: string, config: AppSettings | undefined) {
    let r = resolution();
    if (!r) {
      r = resolveWorkspace(search, config);
      resolution.set(r);
    }
    return r;
  }
}
