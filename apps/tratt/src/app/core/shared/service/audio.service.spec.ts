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
