import { beforeEach, describe, expect, it } from '@jest/globals';
import 'fake-indexeddb/auto';

(globalThis as any).structuredClone =
  typeof (globalThis as any).structuredClone === 'function'
    ? (globalThis as any).structuredClone
    : (v: unknown) => JSON.parse(JSON.stringify(v));

import { BehaviorSubject, firstValueFrom, ReplaySubject } from 'rxjs';
import { IDBService } from '../../shared/service/idb.service';
import { TrattDatabase } from '../../shared/tratt-database';
import { AuthenticationActions } from '../authentication';
import { LoginMode, RootState } from '../index';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';
import { localBundleAdapter } from '../login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../login-mode/login-mode.actions';
import { IDBEffects } from './idb-effects.service';

// The user picked "bundle-2"; "bundle-1" is the DEFAULT_BUNDLE_ID that
// clearDataOfMode falls back to when no id is threaded through.
const SELECTED = 'bundle-2';
const OTHER = 'bundle-1';

const doc = (name: string) => ({ name, levels: [], links: [] });

describe('clear-permanently with a non-default bundle selected (R1)', () => {
  let db: TrattDatabase;
  let effects: IDBEffects;
  let actions$: ReplaySubject<unknown>;

  const row = (bundleId: string, name: string) =>
    db.bundles.get([bundleId, name]);

  beforeEach(async () => {
    db = new TrattDatabase('r1-clear-probe');
    await db.init();
    await db.bundles.bulkPut([
      { bundleId: SELECTED, name: 'annotation', value: doc('selected doc') },
      { bundleId: SELECTED, name: 'logs', value: ['selected log'] },
      { bundleId: OTHER, name: 'annotation', value: doc('other doc') },
      { bundleId: OTHER, name: 'logs', value: ['other log'] },
    ]);

    const idb = new IDBService();
    (idb as any).database = db;

    actions$ = new ReplaySubject<unknown>(1);
    // Only the fields the clear effects read: mode + the selected bundle.
    const store$ = new BehaviorSubject<RootState>({
      application: { mode: LoginMode.LOCAL },
      localMode: {
        bundles: localBundleAdapter.setAll(
          [{ bundleId: SELECTED } as any, { bundleId: OTHER } as any],
          localBundleAdapter.getInitialState(),
        ),
        selectedBundleId: SELECTED,
      },
    } as unknown as RootState);

    effects = new IDBEffects(
      actions$ as any,
      idb,
      {} as any,
      {} as any,
      store$ as any,
      {} as any,
    );
  });

  it('clearAnnotation$ wipes the bundle the user was looking at', async () => {
    actions$.next(
      AnnotationActions.clearAnnotation.do({
        mode: LoginMode.LOCAL,
        clearSession: true,
      }),
    );
    await firstValueFrom(effects.clearAnnotation$ as any);

    expect((await row(SELECTED, 'annotation'))?.value).toBeFalsy();
    expect((await row(SELECTED, 'logs'))?.value).toBeFalsy();
  });

  it("clearAnnotation$ leaves a different bundle's annotation and logs alone", async () => {
    actions$.next(
      AnnotationActions.clearAnnotation.do({
        mode: LoginMode.LOCAL,
        clearSession: true,
      }),
    );
    await firstValueFrom(effects.clearAnnotation$ as any);

    expect(((await row(OTHER, 'annotation'))?.value as any)?.name).toBe(
      'other doc',
    );
    expect((await row(OTHER, 'logs'))?.value).toEqual(['other log']);
  });

  it('clearLogs$ wipes the selected bundle and not the untouched one', async () => {
    actions$.next(AnnotationActions.clearLogs.do({ mode: LoginMode.LOCAL }));
    await firstValueFrom(effects.clearLogs$ as any);

    expect((await row(SELECTED, 'logs'))?.value).toBeFalsy();
    expect((await row(OTHER, 'logs'))?.value).toEqual(['other log']);
  });

  it('log out (logout.success with clearSession) wipes the selected bundle and no other', async () => {
    actions$.next(
      AuthenticationActions.logout.success({
        clearSession: true,
        mode: LoginMode.LOCAL,
      } as any),
    );
    await firstValueFrom(effects.clearAnnotation$ as any);
    expect((await row(SELECTED, 'annotation'))?.value).toBeFalsy();
    expect(((await row(OTHER, 'annotation'))?.value as any)?.name).toBe(
      'other doc',
    );
  });

  it('endTranscription({clearSession:true, LOCAL}) wipes the selected bundle and no other', async () => {
    actions$.next(
      LoginModeActions.endTranscription.do({
        clearSession: true,
        mode: LoginMode.LOCAL,
      }),
    );
    await firstValueFrom(effects.clearAnnotation$ as any);
    expect((await row(SELECTED, 'annotation'))?.value).toBeFalsy();
    expect(((await row(OTHER, 'annotation'))?.value as any)?.name).toBe(
      'other doc',
    );
  });

  it('answers a logout without a mode instead of hanging', async () => {
    actions$.next(AuthenticationActions.logout.success({ clearSession: true }));
    const outcome = await Promise.race([
      firstValueFrom(effects.clearAnnotation$ as any).then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('hung'), 400)),
    ]);
    expect(outcome).toBe('answered');
    expect(await row(OTHER, 'annotation')).toMatchObject({
      value: doc('other doc'),
    });
  });
});
