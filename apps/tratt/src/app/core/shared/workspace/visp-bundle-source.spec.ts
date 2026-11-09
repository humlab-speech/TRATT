/**
 * @jest-environment node
 */
import { IAnnotJSON, ISegmentLevel } from '@tratt/annotation';
import { WebSocket } from 'ws';
import {
  checkEditable,
  extractOwnedLevel,
  spliceOwnedLevel,
} from './emu-annotation-splice';
import { EmuServerError, EmuWebsocketClient } from './emu-websocket-client';
import { MockEmuServer } from './testing/mock-emu-server';
import {
  StaleBundleError,
  UntrustedMediaError,
  VispBundleSource,
  projectCookieGuard,
  sameOriginMediaUrl,
} from './visp-bundle-source';

const word = {
  name: 'Word',
  type: 'ITEM',
  items: [{ id: 1, labels: [{ name: 'Word', value: 'hej' }], extra: 'keep' }],
};
const phonetic = {
  name: 'Phonetic',
  type: 'SEGMENT',
  items: [
    {
      id: 2,
      sampleStart: 0,
      sampleDur: 15999,
      labels: [{ name: 'Phonetic', value: 'a' }],
    },
    {
      id: 3,
      sampleStart: 16000,
      sampleDur: 15999,
      labels: [{ name: 'Phonetic', value: 'b' }],
    },
    {
      id: 4,
      sampleStart: 32000,
      sampleDur: 31999,
      labels: [{ name: 'Phonetic', value: 'c' }],
    },
  ],
};
const transcription = {
  name: 'Transcription',
  type: 'SEGMENT',
  items: [
    {
      id: 5,
      sampleStart: 0,
      sampleDur: 31999,
      labels: [{ name: 'Transcription', value: 'hello' }],
    },
    {
      id: 6,
      sampleStart: 32000,
      sampleDur: 31999,
      labels: [{ name: 'Transcription', value: 'world' }],
    },
  ],
};
const fixture = (): IAnnotJSON =>
  ({
    name: 'b1',
    annotates: 'b1.wav',
    sampleRate: 16000,
    levels: [word, phonetic, transcription],
    links: [{ type: 'ONE_TO_MANY', fromID: 1, toID: 2 }],
  }) as unknown as IAnnotJSON;

describe('splice', () => {
  it('load → save without edits is byte-identical', () => {
    const original = fixture();
    const owned = extractOwnedLevel(original, 'Transcription', 64000);
    expect(owned.items.map((i) => [i.sampleStart, i.sampleDur])).toEqual([
      [0, 32000],
      [32000, 32000],
    ]);
    expect(JSON.stringify(spliceOwnedLevel(original, owned))).toBe(
      JSON.stringify(original),
    );
  });

  it('changes only the owned level and gives new segments unique ids', () => {
    const original = fixture();
    const owned = extractOwnedLevel(original, 'Transcription', 64000);
    owned.items[0].labels[0].value = 'HELLO';
    owned.items.push({
      id: 2, // collides with a Phonetic id
      sampleStart: 64000,
      sampleDur: 1000,
      labels: [{ name: 'Transcription', value: 'new' }],
    });
    const out = spliceOwnedLevel(original, owned) as any;
    expect(out.levels[0]).toEqual(original.levels[0]);
    expect(out.levels[1]).toEqual(original.levels[1]);
    expect(out.links).toEqual(original.links);
    const items = out.levels[2].items;
    expect(items[0].labels[0].value).toBe('HELLO');
    expect(items[1]).toEqual((original.levels[2] as any).items[1]);
    expect(items[2]).toMatchObject({ sampleStart: 64000, sampleDur: 999 });
    expect(items[2].id).toBe(7);
  });

  it('starts an empty level with one segment covering the recording', () => {
    const original = fixture();
    original.levels.pop();
    const owned = extractOwnedLevel(original, 'Transcription', 64000);
    expect(owned.items).toHaveLength(1);
    expect(owned.items[0]).toMatchObject({ sampleStart: 0, sampleDur: 64000 });
    expect(owned.items[0].id).toBe(5);
  });

  it('refuses undeclared or linked levels', () => {
    const levelDefinitions = [{ name: 'Transcription', type: 'SEGMENT' }];
    expect(checkEditable({ levelDefinitions }, 'Transcription')).toEqual({
      editable: true,
    });
    expect(checkEditable({ levelDefinitions }, 'Other')).toMatchObject({
      editable: false,
      reason: 'no-transcription-level',
    });
    expect(
      checkEditable(
        {
          levelDefinitions,
          linkDefinitions: [
            { superlevelName: 'Word', sublevelName: 'Transcription' },
          ],
        },
        'Transcription',
      ),
    ).toMatchObject({ reason: 'level-linked' });
  });
});

describe('helpers', () => {
  it('accepts only the configured media origin', () => {
    expect(
      sameOriginMediaUrl(
        'https://artic.example/file/x.wav',
        'https://artic.example',
        'https://tratt.example',
      ),
    ).toBe('https://tratt.example/file/x.wav');
    expect(() =>
      sameOriginMediaUrl(
        'https://evil.example/x.wav',
        'https://artic.example',
        'https://tratt.example',
      ),
    ).toThrow(UntrustedMediaError);
  });

  it('detects a project switched by another tab', () => {
    expect(() =>
      projectCookieGuard('p1', () => 'a=b; projectId=p1')(),
    ).not.toThrow();
    expect(() => projectCookieGuard('p1', () => 'projectId=p2')()).toThrow();
  });
});

describe('VispBundleSource against a mock EMU server', () => {
  let server: MockEmuServer;
  let client: EmuWebsocketClient;
  let source: VispBundleSource;
  const ref = { session: '0000', name: 'b1' };

  beforeEach(async () => {
    server = new MockEmuServer();
    await server.start();
    server.dbConfig = {
      levelDefinitions: [
        { name: 'Word', type: 'ITEM' },
        { name: 'Phonetic', type: 'SEGMENT' },
        { name: 'Transcription', type: 'SEGMENT' },
      ],
      linkDefinitions: [{ superlevelName: 'Word', sublevelName: 'Phonetic' }],
    };
    server.bundleList = [{ ...ref, comment: '', finishedEditing: false }];
    server.setBundle('0000', 'b1', fixture());
    client = new EmuWebsocketClient(server.url, {
      createSocket: (u) => new WebSocket(u) as any,
      backoffMs: [],
      timeoutMs: 2000,
    });
    source = new VispBundleSource(
      {
        kind: 'visp',
        serverUrl: server.url,
        projectId: 'p1',
        mediaOrigin: 'https://artic.example',
        transcriptionLevel: 'Transcription',
      },
      client,
      'https://tratt.example',
    );
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it('lists exactly the assignment', async () => {
    const list = await new Promise<any[]>((res, rej) =>
      source.listBundles().subscribe({ next: res, error: rej }),
    );
    expect(list).toEqual(server.bundleList);
  });

  it('round-trips load → save byte-identically and never sends ssffFiles', async () => {
    const before = server.files.get('0000/b1');
    const { annotation } = await source.loadBundle(ref, 64000);
    await source.save(ref, annotation);
    expect(server.files.get('0000/b1')).toBe(before);
    const save = server.requests.find((r) => r.type === 'SAVEBUNDLE');
    expect(save.data.ssffFiles).toBeUndefined();
  });

  it('saves an edit and finished/comment, leaving other levels alone', async () => {
    const { annotation } = await source.loadBundle(ref, 64000);
    (annotation as ISegmentLevel).items[0].labels[0].value = 'edited';
    await source.save(ref, annotation, {
      finishedEditing: true,
      comment: 'done',
    });
    const saved = JSON.parse(server.files.get('0000/b1')!);
    expect(saved.levels[2].items[0].labels[0].value).toBe('edited');
    expect(saved.levels[0]).toEqual(word);
    expect(saved.levels[1]).toEqual(phonetic);
    const req = server.requests.filter((r) => r.type === 'SAVEBUNDLE')[0];
    expect(req.data).toMatchObject({ finishedEditing: true, comment: 'done' });
  });

  it('does not overwrite a bundle changed elsewhere', async () => {
    const { annotation } = await source.loadBundle(ref, 64000);
    const other = fixture() as any;
    other.levels[2].items[0].labels[0].value = 'changed in Artic';
    server.setBundle('0000', 'b1', other);
    const before = server.files.get('0000/b1');
    await expect(source.save(ref, annotation)).rejects.toBeInstanceOf(
      StaleBundleError,
    );
    expect(server.files.get('0000/b1')).toBe(before);
  });

  it('"keep my version" writes only the owned level into the current file', async () => {
    const { annotation } = await source.loadBundle(ref, 64000);
    (annotation as ISegmentLevel).items[0].labels[0].value = 'mine';
    const other = fixture() as any;
    other.levels[1].items[0].labels[0].value = 'changed in Artic';
    server.setBundle('0000', 'b1', other);
    await expect(source.save(ref, annotation)).rejects.toBeInstanceOf(
      StaleBundleError,
    );
    await source.save(ref, annotation, {}, { force: true });
    const saved = JSON.parse(server.files.get('0000/b1')!);
    expect(saved.levels[1].items[0].labels[0].value).toBe('changed in Artic');
    expect(saved.levels[2].items[0].labels[0].value).toBe('mine');
  });

  it('checks a restored draft against the version it started from', async () => {
    const { annotation } = await source.loadBundle(ref, 64000);
    const draftBase = source.baseOf(ref)!;
    // Someone saves in Artic; a reload then reads the new version…
    const other = fixture() as any;
    other.levels[2].items[1].labels[0].value = 'changed in Artic';
    server.setBundle('0000', 'b1', other);
    await source.fetchBundle(ref);
    // …but the draft in the browser was based on the old one.
    source.adoptBase(ref, draftBase);
    await expect(source.save(ref, annotation)).rejects.toBeInstanceOf(
      StaleBundleError,
    );
  });

  it('writes the break marker as an empty label and drops undeclared labels', async () => {
    const { annotation } = await source.loadBundle(ref, 64000);
    const level = annotation as ISegmentLevel;
    level.items[1].labels = [
      { name: 'Transcription', value: '<P>' },
      { name: 'Speaker', value: 'S1' },
    ];
    (level.items[1] as any).type = 'item';
    (level.items[1] as any).verified = false;
    await source.save(ref, level, {}, { breakMarker: '<P>' });
    const saved = JSON.parse(server.files.get('0000/b1')!);
    expect(saved.levels[2].items[1]).toEqual({
      id: 6,
      sampleStart: 32000,
      sampleDur: 31999,
      labels: [{ name: 'Transcription', value: '' }],
    });
  });

  it('is read-only when the level is not declared', async () => {
    server.dbConfig.levelDefinitions.pop();
    const { annotation } = await source.loadBundle(ref, 64000);
    await expect(source.save(ref, annotation)).rejects.toThrow(/read-only/);
  });

  it('surfaces server errors', async () => {
    await expect(
      source.loadBundle({ session: '0000', name: 'missing' }),
    ).rejects.toBeInstanceOf(EmuServerError);
  });

  it('reports an unreachable server', async () => {
    const dead = new EmuWebsocketClient('ws://127.0.0.1:1', {
      createSocket: (u) => new WebSocket(u) as any,
      backoffMs: [10],
    });
    await expect(dead.request('GETBUNDLELIST')).rejects.toThrow(/Cannot reach/);
  });
});
