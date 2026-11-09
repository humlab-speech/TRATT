import { AppSettings } from '../../obj/Settings/app-settings';
import {
  _resetLaunchSearch,
  launchQuery,
  rememberLaunchSearch,
  resolveWorkspace,
  workspaceDatabaseName,
} from './workspace';

const config = {
  visp: {
    serverUrl: 'wss://tratt.example/emu-ws',
    mediaOrigin: 'https://artic.example',
    transcriptionLevel: 'Transcription',
  },
} as unknown as AppSettings;

describe('resolveWorkspace', () => {
  it('is local without ?workspace=visp', () => {
    expect(resolveWorkspace('', config)).toEqual({
      ok: true,
      workspace: { kind: 'local' },
    });
    expect(resolveWorkspace('?embedded=true', undefined).ok).toBe(true);
  });

  it('takes the server from config, not the query', () => {
    const r = resolveWorkspace(
      '?workspace=visp&projectId=p1&serverUrl=wss://evil',
      config,
    );
    expect(r).toMatchObject({
      ok: true,
      workspace: { kind: 'visp', serverUrl: 'wss://tratt.example/emu-ws' },
    });
  });

  it('errors instead of falling back to offline', () => {
    expect(
      resolveWorkspace('?workspace=visp&projectId=p1', {} as AppSettings).ok,
    ).toBe(false);
    expect(resolveWorkspace('?workspace=visp', config).ok).toBe(false);
  });
});

describe('workspaceDatabaseName', () => {
  it('keeps the local name and isolates VISP per server and project', () => {
    expect(workspaceDatabaseName('tratt', { kind: 'local' })).toBe('tratt');
    const a = resolveWorkspace('?workspace=visp&projectId=a', config);
    const b = resolveWorkspace('?workspace=visp&projectId=b', config);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(workspaceDatabaseName('tratt', a.workspace)).toBe(
      'tratt-visp:wss://tratt.example/emu-ws:a',
    );
    expect(workspaceDatabaseName('tratt', b.workspace)).not.toBe(
      workspaceDatabaseName('tratt', a.workspace),
    );
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
