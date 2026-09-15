import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { SessionStorageService } from 'ngx-webstorage';
import { randomUUID } from 'node:crypto';
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads';
import { of, ReplaySubject } from 'rxjs';
import { AudioManager } from '@tratt/web-media';
import { AlertService } from '../../shared/service';
import { RoutingService } from '../../shared/service/routing.service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { LoginMode, RootState } from '../index';
import { DEFAULT_BUNDLE_ID } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { IDBActions } from '../idb/idb.actions';
import { AuthenticationActions } from './authentication.actions';
import { AuthenticationEffects } from './authentication.effects';

// jsdom (jest's test environment) doesn't implement the Web BroadcastChannel API.
// Node's worker_threads implementation has an equivalent same-process pub/sub
// surface (addEventListener('message', ...), postMessage, close), so it's a
// suitable polyfill for exercising the real handshake code in this spec.
if (typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'undefined') {
  (
    globalThis as unknown as { BroadcastChannel: typeof NodeBroadcastChannel }
  ).BroadcastChannel = NodeBroadcastChannel;
}

// The jsdom version bundled with jest-environment-jsdom implements
// window.crypto.getRandomValues but not crypto.randomUUID (unlike real
// browsers, which have supported it since 2022). Polyfill it with Node's
// implementation so the effect under test can call it as it would in
// production.
if (typeof (globalThis.crypto as { randomUUID?: unknown })?.randomUUID !== 'function') {
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
          useValue: { navigate: () => undefined, addStaticParams: () => undefined },
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

  it('ignores a reauthentication success message with a mismatched nonce', (done) => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    // subscribing activates the cold `login$` effect and its exhaustMap side effect
    const subscription = effects.login$.subscribe();

    actions$.next(
      AuthenticationActions.reauthenticate.do({
        method: 'local' as any,
      }),
    );

    // wait for the effect to open the BroadcastChannel and register its listener
    setTimeout(() => {
      const bc = new BroadcastChannel('ocb_authentication');
      bc.postMessage({ ok: true, nonce: 'not-the-real-nonce' });
      bc.close();

      // give the listener's own BroadcastChannel a tick to receive the message
      setTimeout(() => {
        expect(
          dispatchSpy.mock.calls.some(
            ([a]) =>
              (a as unknown as { type: string }).type ===
              AuthenticationActions.needReAuthentication.success.type,
          ),
        ).toBe(false);
        subscription.unsubscribe();
        done();
      }, 50);
    }, 0);
  });

  it('accepts a reauthentication success message with the matching nonce', (done) => {
    const fixedNonce = 'fixed-test-nonce-1234';
    jest.spyOn(crypto, 'randomUUID').mockReturnValue(fixedNonce as any);

    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const subscription = effects.login$.subscribe();

    actions$.next(
      AuthenticationActions.reauthenticate.do({
        method: 'local' as any,
      }),
    );

    // wait for the effect to open the BroadcastChannel and register its listener
    setTimeout(() => {
      const bc = new BroadcastChannel('ocb_authentication');
      bc.postMessage({ ok: true, nonce: fixedNonce });
      bc.close();

      setTimeout(() => {
        expect(
          dispatchSpy.mock.calls.some(
            ([a]) =>
              (a as unknown as { type: string }).type ===
              AuthenticationActions.needReAuthentication.success.type,
          ),
        ).toBe(true);
        subscription.unsubscribe();
        done();
      }, 50);
    }, 0);
  });

  describe('onLoginLocal$', () => {
    const makeFile = (name: string) =>
      new File(['x'], name, { type: 'audio/wav' });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('creates a bundle for every extra valid audio file (after bundle #1\'s save-gate resolves) and selects the first up front', (done) => {
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
            .map(([a]) => a as unknown as { type: string; bundleId?: string })
            .filter((a) => a.type === LoginModeActions.createBundle.type);

          expect(createBundleCalls.map((c) => c.bundleId)).toEqual([
            'bundle-two',
            'bundle-three',
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
          .find((a) => a.type === AuthenticationActions.loginLocal.prepare.type);
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
