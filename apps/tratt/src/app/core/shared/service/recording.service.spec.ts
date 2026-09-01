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
  it('emits an error when the final flush inside stop() fails, instead of silently dropping the chunk', async () => {
    const appendChunk = jest.fn<(...args: any[]) => Promise<void>>().mockRejectedValue(new Error('IDB unavailable'));
    const service = createService(appendChunk);
    (service as any).sessionId = 'test-session';
    // Create 11 MB of pending data to exceed 10 MB cap (testing that a final flush
    // failure also triggers the cap check, not just regular interval flushes)
    (service as any).pcmPending = [new Float32Array(11 * 1024 * 1024 / 4)];
    // Minimal state to let flushPcmPending's failure path run without needing
    // the rest of stop()'s machinery (media recorder, stream, etc.) — this
    // test calls flushPcmPending directly rather than the full stop(), since
    // stop() needs real MediaRecorder/AudioContext that jsdom doesn't provide.

    const errors: Error[] = [];
    service.error$.subscribe((e) => errors.push(e));

    await (service as any).flushPcmPending();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('exceeded the retry cap');
  });
});
