import { describe, expect, it, jest } from '@jest/globals';
import { TrattModalService } from './tratt-modal.service';

function serviceWith(result: Promise<unknown>) {
  const ref = { componentInstance: { name: 'm' }, result };
  const ngbModal = { open: jest.fn(() => ref) };
  const service = new TrattModalService(
    ngbModal as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, ref };
}

describe('TrattModalService.openModalRef', () => {
  it('emits "close" with the result when the modal is closed', async () => {
    const { service } = serviceWith(Promise.resolve('ok'));
    const actions: unknown[] = [];
    service.onModalAction.subscribe((a) => actions.push(a));

    service.openModalRef({}, {});
    await Promise.resolve();
    await Promise.resolve();

    expect(actions).toEqual([
      { type: 'open', name: 'm' },
      { type: 'close', name: 'm', result: 'ok' },
    ]);
  });

  // Clicking outside a modal / Esc rejects ngb's result promise (reason 0).
  // That used to surface as an unhandled "ERROR 0" in the console.
  it('handles dismissal: emits "close" and leaves no unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const { service } = serviceWith(Promise.reject(0));
    const actions: unknown[] = [];
    service.onModalAction.subscribe((a) => actions.push(a));

    service.openModalRef({}, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);

    expect(actions).toEqual([
      { type: 'open', name: 'm' },
      { type: 'close', name: 'm' },
    ]);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
