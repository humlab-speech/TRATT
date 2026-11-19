import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { AccountLoginMethod } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { AudioManager } from '@tratt/web-media';
import { SessionStorageService } from 'ngx-webstorage';
import { randomUUID } from 'node:crypto';
import { of, ReplaySubject } from 'rxjs';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { AlertService } from '../../shared/service';
import { RoutingService } from '../../shared/service/routing.service';
import { IDBActions } from '../idb/idb.actions';
import { LoginMode, RootState } from '../index';
import { DEFAULT_BUNDLE_ID } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { AuthenticationActions } from './authentication.actions';
import { AuthenticationEffects } from './authentication.effects';

// jsdom (jest's test environment) doesn't implement the Web BroadcastChannel
// API. Node's worker_threads implementation is not a drop-in stand-in: it
// delivers through a MessagePort, which zone.js patches, and on the CI Node 20
// runner that path throws inside zone's global event callback before the
// effect's listener runs, silently dropping the message. This fake implements
// exactly the surface the handshake uses —
// addEventListener/removeEventListener/postMessage/close — in the same realm,
// so delivery is synchronous and identical on every Node version.
class FakeBroadcastChannel extends EventTarget {
  static readonly open: FakeBroadcastChannel[] = [];

  constructor(readonly name: string) {
    super();
    FakeBroadcastChannel.open.push(this);
  }

  /** Mirrors the browser: a channel never receives its own messages. */
  postMessage(data: unknown): void {
    for (const channel of FakeBroadcastChannel.open) {
      if (channel !== this && channel.name === this.name) {
        channel.dispatchEvent(new MessageEvent('message', { data }));
      }
    }
  }

  close(): void {
    const index = FakeBroadcastChannel.open.indexOf(this);
    if (index !== -1) {
      FakeBroadcastChannel.open.splice(index, 1);
    }
  }

  /** Posts as the auth-success popup would, then closes the sender. */
  static post(name: string, data: unknown): void {
    const sender = new FakeBroadcastChannel(name);
    sender.postMessage(data);
    sender.close();
  }

  static reset(): void {
    FakeBroadcastChannel.open.length = 0;
  }
}

// The jsdom window has no BroadcastChannel at all, so assigning the fake is
// not shadowing a real implementation.
const globalWithBroadcastChannel = globalThis as unknown as {
  BroadcastChannel: typeof FakeBroadcastChannel;
};
globalWithBroadcastChannel.BroadcastChannel = FakeBroadcastChannel;

const isReAuthenticationSuccess = (action: unknown): boolean => {
  // Only the action's `type` discriminator is inspected here.
  const typed = action as { type: string };
  return typed.type === AuthenticationActions.needReAuthentication.success.type;
};

// The jsdom version bundled with jest-environment-jsdom implements
// window.crypto.getRandomValues but not crypto.randomUUID (unlike real
// browsers, which have supported it since 2022). Polyfill it with Node's
// implementation so the effect under test can call it as it would in
// production.
if (
  typeof (globalThis.crypto as { randomUUID?: unknown })?.randomUUID !==
  'function'
) {
  (
    globalThis.crypto as unknown as { randomUUID: typeof randomUUID }
  ).randomUUID = randomUUID;
}

describe('AuthenticationEffects', () => {
  let effects: AuthenticationEffects;
  let store: MockStore<RootState>;
  let actions$: ReplaySubject<unknown>;

  const initialState = {
    application: {
      mode: LoginMode.LOCAL,
      appConfiguration: {
        tratt: {},
      },
    },
  } as unknown as RootState;

  beforeEach(() => {
    actions$ = new ReplaySubject(1);
    FakeBroadcastChannel.reset();

    TestBed.configureTestingModule({
      providers: [
        AuthenticationEffects,
        provideMockActions(() => actions$),
        provideMockStore({ initialState }),
        {
          provide: OctraAPIService,
          useValue: {
            // The re-authentication flow (regardless of login mode) goes through
            // the backend and opens a popup window when the API responds with an
            // `openURL`; these tests exercise the nonce-matching handshake that
            // happens once that popup reports back via BroadcastChannel.
            login: () => of({ openURL: 'https://backend.example.com/auth' }),
          },
        },
        { provide: AlertService, useValue: { showAlert: () => undefined } },
        {
          provide: SessionStorageService,
          useValue: { store: () => undefined, clear: () => undefined },
        },
        { provide: TranslocoService, useValue: {} },
        {
          provide: RoutingService,
          useValue: {
            navigate: () => undefined,
            addStaticParams: () => undefined,
          },
        },
        {
          provide: TrattModalService,
          useValue: {
            openModal: () => undefined,
            openReAuthenticationModal: () => undefined,
          },
        },
      ],
    });

    effects = TestBed.inject(AuthenticationEffects);
    store = TestBed.inject(MockStore);
  });

  it('ignores a reauthentication success message with a mismatched nonce', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    // Subscribing activates the cold `login$` effect; the API mock is a plain
    // `of`, so it opens the channel and registers its listener synchronously.
    const subscription = effects.login$.subscribe();

    actions$.next(
      AuthenticationActions.reauthenticate.do({
        method: AccountLoginMethod.local,
      }),
    );

    FakeBroadcastChannel.post('ocb_authentication', {
      ok: true,
      nonce: 'not-the-real-nonce',
    });

    expect(
      dispatchSpy.mock.calls.some(([action]) =>
        isReAuthenticationSuccess(action),
      ),
    ).toBe(false);

    subscription.unsubscribe();
    dispatchSpy.mockRestore();
  });

  it('accepts a reauthentication success message with the matching nonce', () => {
    const fixedNonce = 'fixed-test-nonce-1234-5678';
    const randomUUIDSpy = jest
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(fixedNonce);

    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const subscription = effects.login$.subscribe();

    actions$.next(
      AuthenticationActions.reauthenticate.do({
        method: AccountLoginMethod.local,
      }),
    );

    FakeBroadcastChannel.post('ocb_authentication', {
      ok: true,
      nonce: fixedNonce,
    });

    expect(
      dispatchSpy.mock.calls.some(([action]) =>
        isReAuthenticationSuccess(action),
      ),
    ).toBe(true);

    subscription.unsubscribe();
    dispatchSpy.mockRestore();
    randomUUIDSpy.mockRestore();
  });

  describe('onLoginLocal$', () => {
    const makeFile = (name: string) =>
      new File(['x'], name, { type: 'audio/wav' });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("creates a bundle for every extra valid audio file (after bundle #1's save-gate resolves) and selects the first up front", (done) => {
      jest.spyOn(AudioManager, 'isValidAudioFileName').mockReturnValue(true);

      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const subscription = effects.onLoginLocal$.subscribe();

      const files = [
        makeFile('one.wav'),
        makeFile('two.wav'),
        makeFile('three.wav'),
      ];
      const audioBundleIds = ['bundle-one', 'bundle-two', 'bundle-three'];

      actions$.next(
        AuthenticationActions.loginLocal.do({
          files,
          removeData: false,
          mode: LoginMode.LOCAL,
          audioBundleIds,
        }),
      );

      setTimeout(() => {
        // Fix 2 (fixwave-1): bundle #1 is selected up front, but extra
        // bundles aren't created yet — they wait for bundle #1's own
        // save-gate (IDBActions.saveModeOptions) to resolve first, so no
        // other bundle's save can be mistaken for bundle #1's by the race.
        const selectBundleCallsBefore = dispatchSpy.mock.calls
          .map(([a]) => a as unknown as { type: string; bundleId?: string })
          .filter((a) => a.type === LoginModeActions.selectBundle.type);
        expect(selectBundleCallsBefore.map((c) => c.bundleId)).toEqual([
          'bundle-one',
        ]);
        expect(
          dispatchSpy.mock.calls.some(
            ([a]) =>
              (a as unknown as { type: string }).type ===
              LoginModeActions.createBundle.type,
          ),
        ).toBe(false);

        // Resolve bundle #1's own save-gate.
        actions$.next(
          IDBActions.saveModeOptions.success({ mode: LoginMode.LOCAL }),
        );

        setTimeout(() => {
          const createBundleCalls = dispatchSpy.mock.calls
            .map(
              ([a]) =>
                a as unknown as {
                  type: string;
                  bundleId?: string;
                  audioLoaded?: boolean;
                },
            )
            .filter((a) => a.type === LoginModeActions.createBundle.type);

          expect(createBundleCalls.map((c) => c.bundleId)).toEqual([
            'bundle-two',
            'bundle-three',
          ]);
          // Their audio was registered under these ids by the caller, so
          // they are as "loaded" as the first file (navbar items, list).
          expect(createBundleCalls.map((c) => c.audioLoaded)).toEqual([
            true,
            true,
          ]);

          subscription.unsubscribe();
          done();
        }, 0);
      }, 0);
    });

    it('dispatches no createBundle actions, but does reselect DEFAULT_BUNDLE_ID, for a single legacy file without the id array', (done) => {
      jest.spyOn(AudioManager, 'isValidAudioFileName').mockReturnValue(true);

      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const subscription = effects.onLoginLocal$.subscribe();

      const files = [makeFile('only.wav')];

      actions$.next(
        AuthenticationActions.loginLocal.do({
          files,
          removeData: false,
          mode: LoginMode.LOCAL,
        }),
      );

      setTimeout(() => {
        const createBundleCalls = dispatchSpy.mock.calls
          .map(([a]) => a as unknown as { type: string })
          .filter((a) => a.type === LoginModeActions.createBundle.type);
        expect(createBundleCalls).toEqual([]);

        // Fix 2 (fixwave-1): with Fix 1 in place, firstBundleId is always a
        // real, already-existing bundle id, so selectBundle is dispatched
        // unconditionally now (no more `validAudioFiles.length > 1` guard) —
        // cheap/no-op in the common N=1 case, since it's already selected.
        const selectBundleCalls = dispatchSpy.mock.calls
          .map(([a]) => a as unknown as { type: string; bundleId?: string })
          .filter((a) => a.type === LoginModeActions.selectBundle.type);
        expect(selectBundleCalls.map((c) => c.bundleId)).toEqual([
          DEFAULT_BUNDLE_ID,
        ]);

        const prepareCall = dispatchSpy.mock.calls
          .map(([a]) => a as unknown as { type: string; sessionFile?: any })
          .find(
            (a) => a.type === AuthenticationActions.loginLocal.prepare.type,
          );
        expect(prepareCall).toBeDefined();
        expect(prepareCall!.sessionFile.name).toEqual('only.wav');

        subscription.unsubscribe();
        done();
      }, 0);
    });

    it('falls back to DEFAULT_BUNDLE_ID for bundle #1 (legacy behavior preserved)', (done) => {
      jest.spyOn(AudioManager, 'isValidAudioFileName').mockReturnValue(true);

      const dispatchSpy = jest.spyOn(store, 'dispatch');
      const subscription = effects.onLoginLocal$.subscribe();

      const files = [makeFile('one.wav'), makeFile('two.wav')];
      const audioBundleIds: string[] = [];

      actions$.next(
        AuthenticationActions.loginLocal.do({
          files,
          removeData: false,
          mode: LoginMode.LOCAL,
          audioBundleIds,
        }),
      );

      setTimeout(() => {
        const selectBundleCalls = dispatchSpy.mock.calls
          .map(([a]) => a as unknown as { type: string; bundleId?: string })
          .filter((a) => a.type === LoginModeActions.selectBundle.type);
        expect(selectBundleCalls.map((c) => c.bundleId)).toEqual([
          DEFAULT_BUNDLE_ID,
        ]);

        subscription.unsubscribe();
        done();
      }, 0);
    });

    it('fails with "file not supported" when no dropped file is a valid audio file', (done) => {
      jest.spyOn(AudioManager, 'isValidAudioFileName').mockReturnValue(false);

      // Error.prototype.message is non-enumerable, so it doesn't survive the
      // action creator's payload spread — only `.type` is reliably present
      // on the dispatched action, matching this effect's pre-existing
      // fail(new Error(...)) behavior.
      const subscription = effects.onLoginLocal$.subscribe((action) => {
        expect(action.type).toEqual(AuthenticationActions.loginLocal.fail.type);
        subscription.unsubscribe();
        done();
      });

      actions$.next(
        AuthenticationActions.loginLocal.do({
          files: [makeFile('not-audio.txt')],
          removeData: false,
          mode: LoginMode.LOCAL,
        }),
      );
    });
  });
});
