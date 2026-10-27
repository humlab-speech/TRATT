import { LoginMode } from '../../store/index';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { selectLocalBundle } from './select-local-bundle';

describe('selectLocalBundle', () => {
  const setup = () => {
    const calls: string[] = [];
    const store = { dispatch: jest.fn(() => calls.push('dispatch')) } as any;
    const pending = { flush: jest.fn(() => calls.push('flush')) } as any;
    return { calls, store, pending };
  };

  it('does nothing when the bundle is already selected', () => {
    const { store, pending } = setup();
    selectLocalBundle(store, pending, 'b1', 'b1');
    expect(pending.flush).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('flushes pending edits before dispatching', () => {
    const { calls, store, pending } = setup();
    selectLocalBundle(store, pending, 'b1', 'b2');
    expect(calls).toEqual(['flush', 'dispatch']);
  });

  it('dispatches the LOCAL selectBundle action', () => {
    const { store, pending } = setup();
    selectLocalBundle(store, pending, 'b1', 'b2');
    expect(store.dispatch).toHaveBeenCalledWith(
      LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId: 'b2' }),
    );
  });
});
