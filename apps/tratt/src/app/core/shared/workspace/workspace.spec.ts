import { AppSettings } from '../../obj/Settings/app-settings';
import {
  _resetLaunchSearch,
  launchQuery,
  rememberLaunchSearch,
  resolveServerUrl,
  resolveWorkspace,
  workspaceDatabaseName,
} from './workspace';

const config = {
  visp: { serverUrl: '/annotation-ws' },
} as unknown as AppSettings;

const OWN = 'https://tratt.example';
const launch = (q: string, c: AppSettings | undefined = config) =>
  resolveWorkspace(q, c, OWN);

describe('resolveWorkspace', () => {
  it('is local without ?workspace=visp', () => {
    expect(launch('')).toEqual({ ok: true, workspace: { kind: 'local' } });
    expect(launch('?embedded=true', undefined).ok).toBe(true);
  });

  it('opens the project and level the link names', () => {
    expect(launch('?workspace=visp&projectId=p1&level=Words')).toEqual({
      ok: true,
      workspace: {
        kind: 'visp',
        serverUrl: 'wss://tratt.example/annotation-ws',
        projectId: 'p1',
        mediaOrigin: OWN,
        transcriptionLevel: 'Words',
      },
    });
  });

  it('takes the server from config, not the query', () => {
    expect(
      launch('?workspace=visp&projectId=p1&level=L&serverUrl=wss://evil'),
    ).toMatchObject({
      ok: true,
      workspace: { serverUrl: 'wss://tratt.example/annotation-ws' },
    });
  });

  it('resolves a path on its own host and keeps absolute URLs', () => {
    expect(resolveServerUrl('/annotation-ws', 'https://tratt.example')).toBe(
      'wss://tratt.example/annotation-ws',
    );
    expect(resolveServerUrl('/ws', 'http://localhost:4200')).toBe(
      'ws://localhost:4200/ws',
    );
    expect(resolveServerUrl('wss://srv.example/x', OWN)).toBe(
      'wss://srv.example/x',
    );
    expect(resolveServerUrl('//evil.example/x', OWN)).toBeUndefined();
    expect(resolveServerUrl('https://evil.example/x', OWN)).toBeUndefined();
  });

  it('falls back to the configured level when the link names none', () => {
    const withLevel = {
      visp: {
        serverUrl: '/annotation-ws',
        transcriptionLevel: 'Transcription',
      },
    } as unknown as AppSettings;
    expect(launch('?workspace=visp&projectId=p1', withLevel)).toMatchObject({
      ok: true,
      workspace: { transcriptionLevel: 'Transcription' },
    });
    expect(
      launch('?workspace=visp&projectId=p1&level=Words', withLevel),
    ).toMatchObject({ ok: true, workspace: { transcriptionLevel: 'Words' } });
  });

  it('errors instead of falling back to offline', () => {
    expect(
      launch('?workspace=visp&projectId=p1&level=L', {} as AppSettings).ok,
    ).toBe(false);
    expect(launch('?workspace=visp&level=L').ok).toBe(false);
    expect(launch('?workspace=visp&projectId=p1').ok).toBe(false);
    expect(launch('?workspace=visp&projectId=p1&level=%20').ok).toBe(false);
    expect(
      launch(`?workspace=visp&projectId=p1&level=${'x'.repeat(201)}`).ok,
    ).toBe(false);
  });
});

describe('workspaceDatabaseName', () => {
  it('keeps the local name and isolates VISP per server, project and level', () => {
    expect(workspaceDatabaseName('tratt', { kind: 'local' })).toBe('tratt');
    const names = ['a&level=L1', 'b&level=L1', 'a&level=L2'].map((q) => {
      const r = launch(`?workspace=visp&projectId=${q}`);
      if (!r.ok) throw new Error('unreachable');
      return workspaceDatabaseName('tratt', r.workspace);
    });
    expect(names[0]).toBe('tratt-visp:wss://tratt.example/annotation-ws:a:L1');
    expect(new Set(names).size).toBe(3);
  });
});

describe('launch query', () => {
  afterEach(() => _resetLaunchSearch());

  it('keeps the query the page was opened with, once', () => {
    rememberLaunchSearch('?workspace=visp&projectId=p1');
    rememberLaunchSearch('');
    expect(launchQuery()).toBe('?workspace=visp&projectId=p1');
  });

  it('falls back to the current address when nothing was recorded', () => {
    expect(launchQuery()).toBe(window.location.search);
  });
});
