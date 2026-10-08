import { describe, expect, it } from '@jest/globals';
import { BehaviorSubject, firstValueFrom, of, ReplaySubject } from 'rxjs';
import { LoginMode, RootState } from '../index';
import { ANNOTATION_SAVE_TRIGGERS } from './annotation-save-triggers';
import { IDBEffects } from './idb-effects.service';
import { IDBActions } from './idb.actions';

// Every save trigger must be answered by a success/fail action, or
// AnnotationSaveTracker keeps its count and "Leave site?" sticks.
function answerTo(
  mode: LoginMode,
  state: Partial<RootState>,
  serialize: () => unknown,
) {
  const actions$ = new ReplaySubject<unknown>(1);
  const effects = new IDBEffects(
    actions$ as any,
    { saveAnnotation: () => of(undefined) } as any,
    {} as any,
    {} as any,
    new BehaviorSubject(state) as any,
    { current: { resource: { info: { sampleRate: 1, duration: 1 } } } } as any,
  );
  actions$.next({ type: ANNOTATION_SAVE_TRIGGERS[0].type, mode });
  void serialize;
  return Promise.race([
    firstValueFrom(effects.saveAnnotation as any).then(
      (a: any) => a.type as string,
    ),
    new Promise<string>((r) => setTimeout(() => r('never answered'), 400)),
  ]);
}

const online = (serialize: () => unknown) =>
  ({
    onlineMode: { transcript: { serialize }, audio: { fileName: 'a.wav' } },
  }) as unknown as Partial<RootState>;

describe('saveAnnotation answers every trigger', () => {
  it('answers success when the write succeeds', async () => {
    expect(
      await answerTo(
        LoginMode.ONLINE,
        online(() => ({})),
        () => ({}),
      ),
    ).toBe(IDBActions.saveAnnotation.success.type);
  });

  it('answers fail when serialize throws', async () => {
    const throwing = () => {
      throw new Error('boom');
    };
    expect(await answerTo(LoginMode.ONLINE, online(throwing), throwing)).toBe(
      IDBActions.saveAnnotation.fail.type,
    );
  });

  it('answers fail when no mode state resolves', async () => {
    const state = {
      localMode: { bundles: { entities: {} }, selectedBundleId: 'gone' },
    } as unknown as Partial<RootState>;
    expect(await answerTo(LoginMode.LOCAL, state, () => ({}))).toBe(
      IDBActions.saveAnnotation.fail.type,
    );
  });
});
