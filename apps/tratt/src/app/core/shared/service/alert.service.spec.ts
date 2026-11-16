import { describe, expect, it } from '@jest/globals';
import { AlertService } from './alert.service';

describe('AlertService', () => {
  it('resolves with the alert id once queued, so the caller can close it', async () => {
    const service = new AlertService();
    const { id } = await service.showAlert('info', 'Working…', true, 600_000);
    expect(service.queue.map((a) => a.id)).toEqual([id]);

    service.closeAlert(id);
    expect(service.queue).toEqual([]);
  });

  it('hands back the alert already showing the same message', async () => {
    const service = new AlertService();
    const first = await service.showAlert('info', 'Working…');
    const second = await service.showAlert('info', 'Working…');
    expect(second.id).toBe(first.id);
    expect(service.queue).toHaveLength(1);
  });

  it('queues a second copy when it need not be unique', async () => {
    const service = new AlertService();
    await service.showAlert('info', 'Working…', false);
    await service.showAlert('info', 'Working…', false);
    expect(service.queue).toHaveLength(2);
  });
});
