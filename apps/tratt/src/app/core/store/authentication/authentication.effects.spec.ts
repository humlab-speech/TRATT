import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { SessionStorageService } from 'ngx-webstorage';
import { randomUUID } from 'node:crypto';
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads';
import { ReplaySubject } from 'rxjs';
import { AlertService } from '../../shared/service';
import { RoutingService } from '../../shared/service/routing.service';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { LoginMode, RootState } from '../index';
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
        tratt: {
          plugins: {
            asr: {
              shibbolethURL: 'https://shibboleth.example.com/auth',
            },
          },
        },
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
        { provide: OctraAPIService, useValue: {} },
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
});
