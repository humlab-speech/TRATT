import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
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
