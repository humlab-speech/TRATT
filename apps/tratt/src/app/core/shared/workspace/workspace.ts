import { AppSettings } from '../../obj/Settings/app-settings';

/**
 * Where the workbench's bundles live. Resolved once at boot and immutable for
 * the page's lifetime; switching workspace means a new page load.
 */
export type Workspace =
  | { kind: 'local' }
  | {
      kind: 'visp';
      serverUrl: string;
      projectId: string;
      mediaOrigin: string;
      transcriptionLevel: string;
    };

export type WorkspaceResolution =
  { ok: true; workspace: Workspace } | { ok: false; error: string };

export const LOCAL_WORKSPACE: Workspace = { kind: 'local' };

let launchSearch: string | undefined;

/**
 * Called by main.ts before anything rewrites the address. The query is gone by
 * the time the workspace is resolved: APP_INITIALIZED_GUARD parks the app on
 * `/load` without it, so reading `location.search` then sees nothing.
 */
export function rememberLaunchSearch(search: string): void {
  launchSearch ??= search;
}

/** The query string the page was opened with (current one if not recorded). */
export function launchQuery(): string {
  return (
    launchSearch ??
    (typeof window !== 'undefined' ? window.location.search : '')
  );
}

/** Test seam: forget the recorded launch query. */
export function _resetLaunchSearch(): void {
  launchSearch = undefined;
}

/**
 * `?workspace=visp&projectId=<id>` selects the VISP workspace. The server URL
 * comes from the deployment's appconfig only, never from the query string, so a
 * crafted link cannot point TRATT at another server. Without the parameter the
 * offline workbench is used.
 */
export function resolveWorkspace(
  search: string,
  config: AppSettings | undefined,
): WorkspaceResolution {
  const params = new URLSearchParams(search);
  if (params.get('workspace') !== 'visp') {
    return { ok: true, workspace: LOCAL_WORKSPACE };
  }
  const visp = config?.visp;
  if (!visp?.serverUrl || !visp.mediaOrigin || !visp.transcriptionLevel) {
    return {
      ok: false,
      error: 'This TRATT installation is not configured for VISP.',
    };
  }
  const projectId = params.get('projectId');
  if (!projectId) {
    return { ok: false, error: 'No VISP project was given in the link.' };
  }
  return {
    ok: true,
    workspace: {
      kind: 'visp',
      serverUrl: visp.serverUrl,
      projectId,
      mediaOrigin: visp.mediaOrigin,
      transcriptionLevel: visp.transcriptionLevel,
    },
  };
}

/**
 * The local workspace keeps the configured name (existing data untouched);
 * every VISP server/project pair gets its own browser database.
 */
export function workspaceDatabaseName(
  baseName: string,
  workspace: Workspace,
): string {
  return workspace.kind === 'local'
    ? baseName
    : `tratt-visp:${workspace.serverUrl}:${workspace.projectId}`;
}
