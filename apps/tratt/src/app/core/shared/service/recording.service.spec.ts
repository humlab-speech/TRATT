import { describe, expect, it, jest } from '@jest/globals';
import { RecordingService } from './recording.service';
import { RecordingPersistenceService } from './recording-persistence.service';
import { RecordingDevicesService } from './recording-devices.service';

function createService(appendChunk: any) {
  const persistenceMock = {
    appendChunk,
  } as unknown as RecordingPersistenceService;

  const devicesMock = {} as unknown as RecordingDevicesService;

  return new RecordingService(persistenceMock, devicesMock);
}

describe('RecordingService PCM retry buffer capping (N3)', () => {
  it('caps the retry buffer instead of growing it unboundedly on persistent IDB failure', async () => {
    const appendChunk = jest.fn<(...args: any[]) => Promise<void>>().mockRejectedValue(new Error('IDB unavailable'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';
    // Create 11 MB of pending data to exceed 10 MB cap
    (service as any).pcmPending = [new Float32Array(11 * 1024 * 1024 / 4)];

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    // First flush should fail but stay under cap (11 MB pending becomes 22 MB after re-merge)
    // Second flush should exceed cap (22 MB + 22 MB > 10 MB) and emit error
    await (service as any).flushPcmPending();
    await (service as any).flushPcmPending();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('exceeded the retry cap');
  });

  it('still retries (does not emit an error) when comfortably under the cap', async () => {
    const appendChunk = jest.fn<(...args: any[]) => Promise<void>>().mockRejectedValue(new Error('transient'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';
    // Create 1 MB of pending data to stay under 10 MB cap
    (service as any).pcmPending = [new Float32Array(1 * 1024 * 1024 / 4)];

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();
    await (service as any).flushPcmPending();

    // Should not emit error when under cap
    expect(errors.length).toBe(0);
    // Should have re-merged the pending data
    expect((service as any).pcmPending.length).toBeGreaterThan(0);
  });
});

describe('RecordingService stop() surfaces a final-flush failure (N3)', () => {
  it('emits an error when a sub-cap final flush fails while stopping, instead of silently dropping the chunk', async () => {
    const appendChunk = jest.fn<(...args: any[]) => Promise<void>>().mockRejectedValue(new Error('IDB unavailable'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';
    service.state$.next('stopping'); // simulate being inside stop()'s final flush
    (service as any).pcmPending = [new Float32Array(10)]; // well under the 10MB cap

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();

    expect(errors.length).toBe(1);
    expect((service as any).pcmPending.length).toBe(0); // dropped, not re-merged — recording is stopping, nothing will retry it
  });
});

describe('RecordingService does not capture PCM while paused (B7)', () => {
  it('drops worklet samples that arrive while state$ is paused', () => {
    const service = createService(jest.fn());
    (service as any).pcmPending = [];

    service.state$.next('recording');
    (service as any).handleWorkletMessage(new Float32Array([1, 2, 3]));
    expect((service as any).pcmPending.length).toBe(1);

    service.state$.next('paused');
    (service as any).handleWorkletMessage(new Float32Array([4, 5, 6]));
    expect((service as any).pcmPending.length).toBe(1); // unchanged — paused sample dropped

    service.state$.next('recording');
    (service as any).handleWorkletMessage(new Float32Array([7, 8, 9]));
    expect((service as any).pcmPending.length).toBe(2); // resumes capturing
  });
});

describe('RecordingService PCM index race (N12)', () => {
  it('assigns distinct indices to two overlapping flushes instead of racing on the same one', async () => {
    let resolveFirstAppend: () => void;
    const firstAppendGate = new Promise<void>((resolve) => {
      resolveFirstAppend = resolve;
    });
    const appendedIndices: number[] = [];
    const appendChunk = jest.fn(async (params: { index: number }) => {
      appendedIndices.push(params.index);
      if (appendedIndices.length === 1) {
        await firstAppendGate; // hold the first append open until the second has started
      }
    });
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';

    (service as any).pcmPending = [new Float32Array(10)];
    const firstFlush = (service as any).flushPcmPending();

    // Let the first flush's synchronous prefix (including the index read/queue-time increment) run.
    await Promise.resolve();

    (service as any).pcmPending = [new Float32Array(10)];
    const secondFlush = (service as any).flushPcmPending();

    resolveFirstAppend!();
    await Promise.all([firstFlush, secondFlush]);

    expect(appendedIndices.length).toBe(2);
    expect(appendedIndices[0]).not.toBe(appendedIndices[1]);
  });
});
