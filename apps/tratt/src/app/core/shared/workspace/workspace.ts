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

/** Longest level name accepted from a launch link (EMU names are short). */
const MAX_LEVEL_NAME_LENGTH = 200;

/**
 * The configured server URL as an absolute websocket URL. A path
 * (`/annotation-ws`) is on TRATT's own host, so one appconfig serves every
 * VISP site; an absolute `ws(s)://` URL is used as it is.
 */
export function resolveServerUrl(
  serverUrl: string,
  ownOrigin: string,
): string | undefined {
  if (/^wss?:\/\//i.test(serverUrl)) {
    return serverUrl;
  }
  if (!serverUrl.startsWith('/') || serverUrl.startsWith('//')) {
    return undefined;
  }
  const own = new URL(ownOrigin);
  const scheme = own.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${own.host}${serverUrl}`;
}

/**
 * `?workspace=visp&projectId=<id>&level=<name>` selects the VISP workspace:
 * the user's assigned bundles in that project, transcribed into that
 * annotation level. VISP's launch dialog chooses the level; the project's
 * DBconfig decides whether TRATT may edit it (an unlinked SEGMENT level), so a
 * crafted link cannot reach anything the user could not edit anyway.
 *
 * The server URL comes from the deployment's appconfig only, never from the
 * query string, so a crafted link cannot point TRATT at another server.
 * Without `workspace=visp` the offline workbench is used.
 */
export function resolveWorkspace(
  search: string,
  config: AppSettings | undefined,
  ownOrigin: string = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://localhost',
): WorkspaceResolution {
  const params = new URLSearchParams(search);
  if (params.get('workspace') !== 'visp') {
    return { ok: true, workspace: LOCAL_WORKSPACE };
  }
  const visp = config?.visp;
  const serverUrl = visp?.serverUrl
    ? resolveServerUrl(visp.serverUrl, ownOrigin)
    : undefined;
  if (!serverUrl) {
    return {
      ok: false,
      error: 'This TRATT installation is not configured for VISP.',
    };
  }
  const projectId = params.get('projectId');
  if (!projectId) {
    return { ok: false, error: 'No VISP project was given in the link.' };
  }
  const level =
    params.get('level')?.trim() || visp?.transcriptionLevel?.trim() || '';
  if (!level || level.length > MAX_LEVEL_NAME_LENGTH) {
    return {
      ok: false,
      error: 'No annotation level was given in the link.',
    };
  }
  return {
    ok: true,
    workspace: {
      kind: 'visp',
      serverUrl,
      projectId,
      mediaOrigin: visp?.mediaOrigin || ownOrigin,
      transcriptionLevel: level,
    },
  };
}

/**
 * The local workspace keeps the configured name (existing data untouched);
 * every VISP server/project/level gets its own browser database, so work on
 * one level never shows up in another.
 */
export function workspaceDatabaseName(
  baseName: string,
  workspace: Workspace,
): string {
  return workspace.kind === 'local'
    ? baseName
    : `tratt-visp:${workspace.serverUrl}:${workspace.projectId}:${workspace.transcriptionLevel}`;
}
