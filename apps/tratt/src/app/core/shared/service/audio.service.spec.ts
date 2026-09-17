import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AudioManager } from '@tratt/web-media';
import { Subject, of, throwError } from 'rxjs';
import { LoginMode, RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { AudioService } from './audio.service';

// Convention: mock Store via @ngrx/store/testing's provideMockStore, as
// established by idb-effects.service.spec.ts, rather than a hand-rolled
// Store stub — this gives selectSignal() a real, working Signal underneath.
describe('AudioService — registry', () => {
  let service: AudioService;
  let store: MockStore<RootState>;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      bundles: localBundleAdapter.getInitialState(),
      selectedBundleId: 'bundle-1',
    },
  } as unknown as RootState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AudioService,
        { provide: HttpClient, useValue: {} },
        provideMockStore({ initialState }),
      ],
    });
    service = TestBed.inject(AudioService);
    store = TestBed.inject(MockStore);
  });

  it('registerAudioManager stores a manager keyed by bundleId, retrievable via current', () => {
    const manager = {
      resource: { name: 'a.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
    } as any;
    service.registerAudioManager('bundle-1', manager);
    expect(service.current).toBe(manager);
  });

  it('current returns undefined when no manager is registered for the selected bundle', () => {
    expect(service.current).toBeUndefined();
  });

  it('audioManager (deprecated) delegates to current when a manager exists', () => {
    const manager = {
      resource: { name: 'a.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
    } as any;
    service.registerAudioManager('bundle-1', manager);
    expect(service.audioManager).toBe(manager);
  });

  it('audioManager (deprecated) throws when current is undefined', () => {
    expect(() => service.audioManager).toThrow();
  });

  it('audiomanagers returns an array view of the registry, preserving index-0 access', () => {
    const manager = {
      resource: { name: 'a.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
    } as any;
    service.registerAudioManager('bundle-1', manager);
    expect(service.audiomanagers).toEqual([manager]);
    expect(service.audiomanagers[0]).toBe(manager);
  });

  it('current resolves per selected bundle via the store', () => {
    const managerA = {
      resource: { name: 'a.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
    } as any;
    const managerB = {
      resource: { name: 'b.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
    } as any;
    service.registerAudioManager('bundle-1', managerA);
    service.registerAudioManager('bundle-2', managerB);

    expect(service.current).toBe(managerA);

    store.setState({
      ...initialState,
      localMode: {
        ...initialState.localMode,
        selectedBundleId: 'bundle-2',
      },
    } as unknown as RootState);

    expect(service.current).toBe(managerB);
  });
});

describe('AudioService — eviction and envelope', () => {
  let service: AudioService;
  let store: MockStore<RootState>;

  const stateWithSelected = (selectedBundleId: string) =>
    ({
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.getInitialState(),
        selectedBundleId,
      },
    }) as unknown as RootState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AudioService,
        { provide: HttpClient, useValue: {} },
        provideMockStore({ initialState: stateWithSelected('bundle-1') }),
      ],
    });
    service = TestBed.inject(AudioService);
    store = TestBed.inject(MockStore);
  });

  const fakeManager = (name: string) =>
    ({
      resource: { name },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
      channel: new Float32Array(1000).fill(0.1),
      destroy: jest.fn(async () => undefined),
    }) as any;

  // Registers a manager for `id` and drives the store's selectedBundleId to
  // `id`, flushing the service's constructor effect() so trackSelection runs
  // synchronously before the next assertion/registration.
  const selectBundle = (id: string) => {
    store.setState(stateWithSelected(id));
    TestBed.flushEffects();
  };

  it('evicts the least-recently-selected bundle once more than 3 distinct bundles have been selected', () => {
    const managers: Record<string, any> = {
      b1: fakeManager('b1'),
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id]);
      selectBundle(id);
    }

    expect(service.current).toBe(managers['b4']);
    expect(managers['b1'].destroy).toHaveBeenCalled();
    expect(service.audiomanagers).not.toContain(managers['b1']);
    expect(service.audiomanagers).toContain(managers['b2']);
    expect(service.audiomanagers).toContain(managers['b3']);
    expect(service.audiomanagers).toContain(managers['b4']);
  });

  it("preserves the evicted bundle's envelope after eviction", async () => {
    const managers: Record<string, any> = {
      b1: fakeManager('b1'),
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id]);
      selectBundle(id);
    }

    // envelope computation is async (computeAudioEnvelope resolves a Promise)
    await Promise.resolve();
    await Promise.resolve();

    expect(managers['b1'].destroy).toHaveBeenCalled();
    expect(service.getEnvelope('b1')).toBeDefined();
  });

  it('evict(bundleId) is a safe no-op when no manager is registered for that id', () => {
    expect(() => service.evict('never-registered')).not.toThrow();
  });

  it('re-selecting the current bundle causes no eviction churn', () => {
    const managers: Record<string, any> = {
      b1: fakeManager('b1'),
      b2: fakeManager('b2'),
    };

    service.registerAudioManager('b1', managers['b1']);
    selectBundle('b1');
    service.registerAudioManager('b2', managers['b2']);
    selectBundle('b2');

    // Re-select b1 (already tracked), then b2 again — neither is a new
    // distinct bundle, so recentBundleIds should never exceed the 2 already
    // tracked and nothing should be evicted.
    selectBundle('b1');
    selectBundle('b2');
    selectBundle('b2');

    expect(managers['b1'].destroy).not.toHaveBeenCalled();
    expect(managers['b2'].destroy).not.toHaveBeenCalled();
    expect(service.audiomanagers).toContain(managers['b1']);
    expect(service.audiomanagers).toContain(managers['b2']);
  });

  it('AudioService.current is undefined for an evicted-then-reselected bundle, but its envelope survives', async () => {
    const managers: Record<string, any> = {
      b1: fakeManager('b1'),
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id]);
      selectBundle(id);
    }

    // envelope computation is async (computeAudioEnvelope resolves a Promise)
    await Promise.resolve();
    await Promise.resolve();

    expect(managers['b1'].destroy).toHaveBeenCalled();

    // Re-select the evicted bundle — nothing re-registers a manager for it.
    selectBundle('b1');

    expect(service.current).toBeUndefined();
    expect(service.getEnvelope('b1')).toBeDefined();
  });
});

describe('AudioService — re-decode on reselection of an evicted bundle', () => {
  let service: AudioService;
  let store: MockStore<RootState>;

  const stateWithSelected = (selectedBundleId: string) =>
    ({
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.getInitialState(),
        selectedBundleId,
      },
    }) as unknown as RootState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AudioService,
        { provide: HttpClient, useValue: {} },
        provideMockStore({ initialState: stateWithSelected('bundle-1') }),
      ],
    });
    service = TestBed.inject(AudioService);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const fakeManager = (name: string) =>
    ({
      resource: { name },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
      channel: new Float32Array(1000).fill(0.1),
      destroy: jest.fn(async () => undefined),
    }) as any;

  const fakeFile = (
    name: string,
    size = 8,
    type = 'audio/wav',
    lastModified = 1,
  ) =>
    ({
      name,
      size,
      type,
      lastModified,
      arrayBuffer: jest.fn(async () => new ArrayBuffer(size)),
    }) as unknown as File;

  const selectBundle = (id: string) => {
    store.setState(stateWithSelected(id));
    TestBed.flushEffects();
  };

  // ensureResident() is fired-and-forgotten (`void`) from the constructor
  // effect, so tests await the microtask queue rather than the effect call
  // itself, matching the eviction describe block's async-flush convention
  // above (`await Promise.resolve()` for computeAudioEnvelope's Promise).
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('re-decodes and installs a new AudioManager when reselecting an evicted bundle', async () => {
    const originalB1 = fakeManager('b1-original');
    const managers: Record<string, any> = {
      b1: originalB1,
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };
    const files: Record<string, File> = {
      b1: fakeFile('b1.wav'),
      b2: fakeFile('b2.wav'),
      b3: fakeFile('b3.wav'),
      b4: fakeFile('b4.wav'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id], files[id]);
      selectBundle(id);
    }

    // b1 was evicted when b4 was selected.
    expect(originalB1.destroy).toHaveBeenCalled();
    expect(service.audiomanagers).not.toContain(originalB1);

    const redecodedB1 = fakeManager('b1-redecoded');
    const createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(of({ audioManager: redecodedB1, progress: 1 }) as any);

    // Re-select the evicted bundle.
    selectBundle('b1');
    await flushMicrotasks();

    expect(createSpy).toHaveBeenCalledWith(
      'b1.wav',
      'audio/wav',
      expect.anything(),
    );
    expect(service.current).toBe(redecodedB1);
    expect(service.current).not.toBe(originalB1);
  });

  it('does not re-decode a bundle that still has a resident manager', async () => {
    const managerB1 = fakeManager('b1');
    const fileB1 = fakeFile('b1.wav');
    service.registerAudioManager('b1', managerB1, fileB1);
    selectBundle('b1');

    const managerB2 = fakeManager('b2');
    service.registerAudioManager('b2', managerB2, fakeFile('b2.wav'));
    selectBundle('b2');

    const createSpy = jest.spyOn(AudioManager, 'create');

    // Re-select b1 — still resident (never evicted), so no re-decode.
    selectBundle('b1');
    await flushMicrotasks();

    expect(createSpy).not.toHaveBeenCalled();
    expect(service.current).toBe(managerB1);
  });

  it('is a safe no-op reselecting a bundle with no retained source file and no resident manager', async () => {
    // Registered via loadAudio()-style call with no sourceFile (ONLINE mode).
    const managerB1 = fakeManager('b1');
    service.registerAudioManager('b1', managerB1);
    selectBundle('b1');

    // Evict it manually (simulating LRU eviction) without ever having a
    // source file on record for it.
    service.evict('b1');

    const createSpy = jest.spyOn(AudioManager, 'create');

    expect(() => selectBundle('b1')).not.toThrow();
    await flushMicrotasks();

    expect(createSpy).not.toHaveBeenCalled();
    expect(service.current).toBeUndefined();
  });

  // Fix 6 (fixwave-1): ensureResident() must not let a re-decode failure
  // surface as an unhandled rejection — matches evict()'s existing
  // best-effort destroy().catch() pattern.
  it('swallows a rejected re-decode and leaves current undefined, without throwing', async () => {
    const originalB1 = fakeManager('b1-original');
    const managers: Record<string, any> = {
      b1: originalB1,
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };
    const files: Record<string, File> = {
      b1: fakeFile('b1.wav'),
      b2: fakeFile('b2.wav'),
      b3: fakeFile('b3.wav'),
      b4: fakeFile('b4.wav'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id], files[id]);
      selectBundle(id);
    }
    // b1 was evicted when b4 was selected.
    expect(service.audiomanagers).not.toContain(originalB1);

    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) =>
      unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(throwError(() => new Error('decode failed')) as any);

    expect(() => selectBundle('b1')).not.toThrow();
    await flushMicrotasks();

    process.off('unhandledRejection', onUnhandledRejection);

    expect(unhandledRejections).toEqual([]);
    expect(service.current).toBeUndefined();
  });

  // Fix 6 (fixwave-1): a rapid A->B->A reselection must not start two
  // concurrent decodes for the same bundle — the in-flight guard
  // (`_pendingResidency`) prevents the second call from re-entering while
  // the first is still awaiting.
  it('does not start a second concurrent re-decode for the same bundle on rapid reselection', async () => {
    const originalB1 = fakeManager('b1-original');
    const managers: Record<string, any> = {
      b1: originalB1,
      b2: fakeManager('b2'),
      b3: fakeManager('b3'),
      b4: fakeManager('b4'),
    };
    const files: Record<string, File> = {
      b1: fakeFile('b1.wav'),
      b2: fakeFile('b2.wav'),
      b3: fakeFile('b3.wav'),
      b4: fakeFile('b4.wav'),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id], files[id]);
      selectBundle(id);
    }
    expect(service.audiomanagers).not.toContain(originalB1);

    const redecodedB1 = fakeManager('b1-redecoded');
    const createSpy = jest
      .spyOn(AudioManager, 'create')
      .mockReturnValue(of({ audioManager: redecodedB1, progress: 1 }) as any);

    // Fire two rapid reselections back to the evicted bundle before the
    // first re-decode's microtasks have a chance to resolve.
    selectBundle('b1');
    selectBundle('b1');
    await flushMicrotasks();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(service.current).toBe(redecodedB1);
  });
});

describe('AudioService — getManager / ensureResident (public, step 3b-i)', () => {
  let service: AudioService;

  const stateWithSelected = (selectedBundleId: string) =>
    ({
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.getInitialState(),
        selectedBundleId,
      },
    }) as unknown as RootState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AudioService,
        { provide: HttpClient, useValue: {} },
        provideMockStore({ initialState: stateWithSelected('bundle-1') }),
      ],
    });
    service = TestBed.inject(AudioService);
  });

  const fakeManager = () =>
    ({
      resource: { name: 'x.wav' },
      audioMechanism: { missingPermission: { subscribe: jest.fn() } },
      channel: new Float32Array(1000).fill(0.1),
      destroy: jest.fn(async () => undefined),
    }) as any;

  const fakeFile = (
    name: string,
    size = 8,
    type = 'audio/wav',
    lastModified = 1,
  ) =>
    ({
      name,
      size,
      type,
      lastModified,
      arrayBuffer: jest.fn(async () => new ArrayBuffer(size)),
    }) as unknown as File;

  it('getManager returns the manager registered for that bundle, regardless of selection', () => {
    const manager = fakeManager();
    service.registerAudioManager('bundle-x', manager as any);
    expect(service.getManager('bundle-x')).toBe(manager);
    expect(service.getManager('bundle-y')).toBeUndefined();
  });

  it('ensureResident resolves true when the bundle is already resident', async () => {
    service.registerAudioManager('bundle-x', fakeManager() as any);
    await expect(service.ensureResident('bundle-x')).resolves.toBe(true);
  });

  it('ensureResident resolves false when no source file was ever retained', async () => {
    await expect(service.ensureResident('bundle-never-seen')).resolves.toBe(
      false,
    );
  });

  it('ensureResident resolves false when the re-decode throws', async () => {
    const manager = fakeManager();
    const file = fakeFile('a.wav', 4, 'audio/wav', 1);
    (file.arrayBuffer as jest.Mock<any>).mockRejectedValue(
      new Error('read failed') as never,
    );
    service.registerAudioManager('bundle-x', manager as any, file);
    service.evict('bundle-x');

    await expect(service.ensureResident('bundle-x')).resolves.toBe(false);
  });

  // F2 (final whole-branch review fix wave): ensureResident() must feed the
  // same LRU accounting trackSelection() owns, so bundles the QUEUE makes
  // resident (never selected) still get evicted past MAX_RESIDENT_BUNDLES.
  // Seeds 4 bundles purely via registerAudioManager()+ensureResident() — no
  // selectBundle()/trackSelection() call anywhere in this test — mirroring
  // PipelineQueueService.runBundle()'s actual call pattern.
  it('ensureResident tracks every bundle it touches in the same LRU cap as selection, evicting past MAX_RESIDENT_BUNDLES', async () => {
    const managers: Record<string, any> = {
      b1: fakeManager(),
      b2: fakeManager(),
      b3: fakeManager(),
      b4: fakeManager(),
    };

    for (const id of ['b1', 'b2', 'b3', 'b4']) {
      service.registerAudioManager(id, managers[id]);
      await expect(service.ensureResident(id)).resolves.toBe(true);
    }

    expect(managers['b1'].destroy).toHaveBeenCalled();
    expect(service.hasResident('b1')).toBe(false);
    expect(service.hasResident('b2')).toBe(true);
    expect(service.hasResident('b3')).toBe(true);
    expect(service.hasResident('b4')).toBe(true);
  });
});

describe('AudioService missingPermission notifier (C8)', () => {
  let service: AudioService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AudioService,
        { provide: HttpClient, useValue: {} },
        provideMockStore({
          initialState: {
            application: { mode: LoginMode.LOCAL },
            localMode: {
              bundles: localBundleAdapter.getInitialState(),
              selectedBundleId: 'bundle-1',
            },
          } as unknown as RootState,
        }),
      ],
    });
    service = TestBed.inject(AudioService);
  });

  it('delivers every permission loss, not just the first', () => {
    const missingPermission = new Subject<void>();

    service.registerAudioManager('bundle-1', {
      resource: { name: 'test-audio' },
      audioMechanism: { missingPermission },
    } as any);

    let count = 0;
    service.missingPermission.subscribe(() => count++);

    missingPermission.next();
    missingPermission.next();

    expect(count).toBe(2);
  });
});
