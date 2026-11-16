import { describe, expect, it } from '@jest/globals';
import { SessionFile } from '../../../obj/SessionFile';
import { LoginMode } from '../../index';
import {
  breakMarkerCodeOf,
  selectActiveAnnotation,
  selectAllBundleSummaries,
  selectSelectedBundleId,
  transcriptCoverage,
  transcriptHasContent,
} from './annotation.selectors';
import {
  DEFAULT_BUNDLE_ID,
  localBundleAdapter,
} from './local-bundle-collection';

describe('selectActiveAnnotation', () => {
  it('LOCAL mode: resolves through the bundle collection to the flat AnnotationState', () => {
    const fakeAnnotation = {
      savingNeeded: true,
      bundleId: DEFAULT_BUNDLE_ID,
    } as any;
    const state = {
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.setOne(
          fakeAnnotation,
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId: DEFAULT_BUNDLE_ID,
      },
      onlineMode: {},
      demoMode: {},
      urlMode: {},
    } as any;

    expect(
      selectActiveAnnotation.projector(
        LoginMode.LOCAL,
        state.onlineMode,
        state.demoMode,
        state.localMode,
        state.urlMode,
      ),
    ).toBe(fakeAnnotation);
  });

  it('ONLINE mode: unchanged, returns the flat slice directly', () => {
    const fakeOnline = { savingNeeded: false } as any;
    expect(
      selectActiveAnnotation.projector(
        LoginMode.ONLINE,
        fakeOnline,
        {} as any,
        {
          bundles: localBundleAdapter.getInitialState(),
          selectedBundleId: DEFAULT_BUNDLE_ID,
        },
        {} as any,
      ),
    ).toBe(fakeOnline);
  });
});

describe('selectSelectedBundleId', () => {
  it("reads local mode's selectedBundleId", () => {
    const state = {
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.getInitialState(),
        selectedBundleId: 'some-bundle-id',
      },
      onlineMode: {},
      demoMode: {},
      urlMode: {},
    } as any;

    expect(selectSelectedBundleId.projector(state.localMode)).toBe(
      'some-bundle-id',
    );
  });
});

describe('selectAllBundleSummaries', () => {
  it('returns a summary per bundle with correct selected, awaitingMedia and hasAnnotationContent flags', () => {
    // bundleA: never had audio decoded this session (e.g. restored from IDB
    // at boot per step 2.8, Task 3) -> awaitingMedia true; no transcript at
    // all -> hasAnnotationContent false.
    const bundleA = {
      bundleId: 'bundle-a',
      sessionFile: new SessionFile('a.wav', 1, new Date(), 'audio/wav'),
      audio: { loaded: false },
    } as any;
    // bundleB: audio decoded this session -> awaitingMedia false; has a
    // transcribed segment -> hasAnnotationContent true.
    const bundleB = {
      bundleId: 'bundle-b',
      sessionFile: new SessionFile('b.wav', 2, new Date(), 'audio/wav'),
      audio: { loaded: true },
      transcript: {
        levels: [{ items: [{ labels: [{ name: 'L', value: 'hej' }] }] }],
      },
    } as any;
    const local = {
      bundles: localBundleAdapter.setAll(
        [bundleA, bundleB],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'bundle-b',
    };

    expect(selectAllBundleSummaries.projector(local)).toEqual([
      {
        bundleId: 'bundle-a',
        name: 'a.wav',
        selected: false,
        awaitingMedia: true,
        hasAnnotationContent: false,
      },
      {
        bundleId: 'bundle-b',
        name: 'b.wav',
        selected: true,
        awaitingMedia: false,
        hasAnnotationContent: true,
      },
    ]);
  });
});

describe('transcriptHasContent', () => {
  it('is false for no transcript, no levels, or empty levels', () => {
    expect(transcriptHasContent(undefined)).toBe(false);
    expect(transcriptHasContent({ levels: [] })).toBe(false);
    expect(transcriptHasContent({ levels: [{ items: [] }] })).toBe(false);
  });

  // The session bootstrap seeds every new bundle with ONE empty segment
  // spanning the file; that must still count as "empty", or the first file
  // of a session is never auto-transcribed.
  it('is false for the single blank segment a new bundle is seeded with', () => {
    expect(
      transcriptHasContent({
        levels: [{ items: [{ labels: [{ name: 'L', value: '' }] }] }],
      }),
    ).toBe(false);
    expect(
      transcriptHasContent({
        levels: [{ items: [{ labels: [{ name: 'L', value: '   ' }] }] }],
      }),
    ).toBe(false);
  });

  it('is true once any label carries text', () => {
    expect(
      transcriptHasContent({
        levels: [{ items: [{ labels: [{ name: 'L', value: 'hej' }] }] }],
      }),
    ).toBe(true);
  });

  it('is true for hand-placed boundaries even without text', () => {
    expect(
      transcriptHasContent({
        levels: [{ items: [{ labels: [] }, { labels: [] }] }],
      }),
    ).toBe(true);
  });

  // startAnnotation.success normalises the empty seed segment to the
  // guidelines' break marker; that must still count as "nothing typed",
  // otherwise the first file's ASR result was discarded as an edit.
  it('treats a segment holding only the break marker as empty', () => {
    const seeded = {
      levels: [{ items: [{ labels: [{ name: 'L', value: '<P>' }] }] }],
    };
    expect(transcriptHasContent(seeded, '<P>')).toBe(false);
    // Without knowing the marker it is ordinary text.
    expect(transcriptHasContent(seeded)).toBe(true);
    expect(
      transcriptHasContent(
        {
          levels: [{ items: [{ labels: [{ name: 'L', value: '<P> hej' }] }] }],
        },
        '<P>',
      ),
    ).toBe(true);
  });
});

describe('breakMarkerCodeOf', () => {
  it("returns the code of the selected guidelines' break marker", () => {
    expect(
      breakMarkerCodeOf({
        selected: {
          json: {
            markers: [
              { type: 'other', code: '[X]' },
              { type: 'break', code: '<P>' },
            ],
          },
        },
      } as any),
    ).toBe('<P>');
  });

  it('is undefined without guidelines or a break marker', () => {
    expect(breakMarkerCodeOf(undefined)).toBeUndefined();
    expect(
      breakMarkerCodeOf({ selected: { json: { markers: [] } } } as any),
    ).toBeUndefined();
  });
});

describe('transcriptCoverage', () => {
  const seg = (end: number, value?: string, name = 'T') => ({
    time: { samples: end },
    labels: value === undefined ? [] : [{ name, value }],
  });
  const level = (items: ReturnType<typeof seg>[], name = 'T') => ({
    name,
    type: 'SEGMENT',
    items,
  });

  it('is undefined with no segment level holding segments', () => {
    expect(transcriptCoverage(undefined)).toBeUndefined();
    expect(transcriptCoverage({ levels: [] })).toBeUndefined();
    expect(
      transcriptCoverage({ levels: [{ type: 'ITEM', items: [seg(10, 'x')] }] }),
    ).toBeUndefined();
    expect(transcriptCoverage({ levels: [level([])] })).toBeUndefined();
  });

  it('measures by duration, not by segment count', () => {
    // 3 of 4 segments hold text, but the empty one is 70% of the audio.
    expect(
      transcriptCoverage({
        levels: [
          level([seg(10, 'a'), seg(20, 'b'), seg(90, ''), seg(100, 'c')]),
        ],
      }),
    ).toEqual({ withText: 3, segments: 4, fraction: 0.3 });
  });

  it('counts the break marker as no text', () => {
    expect(
      transcriptCoverage(
        { levels: [level([seg(50, '<P>'), seg(100, 'hi')])] },
        '<P>',
      ),
    ).toEqual({ withText: 1, segments: 2, fraction: 0.5 });
  });

  it("reads the level's own label, not a Speaker label", () => {
    const item = {
      time: { samples: 100 },
      labels: [
        { name: 'Speaker', value: 'S1' },
        { name: 'T', value: '' },
      ],
    };
    expect(
      transcriptCoverage({
        levels: [{ name: 'T', type: 'SEGMENT', items: [item] }],
      }),
    ).toEqual({ withText: 0, segments: 1, fraction: 0 });
  });

  it('reports the level covering the most audio', () => {
    expect(
      transcriptCoverage({
        levels: [
          level([seg(50, 'a'), seg(100, '')], 'A'),
          level([seg(100, 'b')], 'B'),
        ].map((l) => ({
          ...l,
          items: l.items.map((i) => ({
            ...i,
            labels: i.labels.map((x) => ({ ...x, name: l.name })),
          })),
        })),
      }),
    ).toEqual({ withText: 1, segments: 1, fraction: 1 });
  });
});
