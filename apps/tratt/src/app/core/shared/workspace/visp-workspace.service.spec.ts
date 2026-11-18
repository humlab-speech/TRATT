import { signal } from '@angular/core';
import { ISegmentLevel, TrattAnnotation } from '@tratt/annotation';
import { EmuConnectionError, EmuServerError } from './emu-websocket-client';
import {
  annotationFromOwnedLevel,
  ownedLevelOf,
  VispWorkspaceService,
} from './visp-workspace.service';

const ref = { session: '0000', name: 'b1' };
const level: ISegmentLevel = {
  name: 'Transcription',
  type: 'SEGMENT' as ISegmentLevel['type'],
  items: [
    {
      id: 5,
      sampleStart: 0,
      sampleDur: 32000,
      labels: [{ name: 'Transcription', value: 'hello' }],
    },
    {
      id: 6,
      sampleStart: 32000,
      sampleDur: 32000,
      labels: [{ name: 'Transcription', value: 'world' }],
    },
  ],
};

describe('owned level ⇄ editor annotation', () => {
  it('round-trips through the editor model without padding or drift', () => {
    const annotation = annotationFromOwnedLevel(ref, level, 16000);
    const transcript = TrattAnnotation.deserialize(annotation);
    const back = ownedLevelOf(transcript, 'Transcription', 16000)!;
    expect(back.items.map((i) => [i.sampleStart, i.sampleDur])).toEqual([
      [0, 32000],
      [32000, 32000],
    ]);
    expect(back.items.map((i) => i.labels[0].value)).toEqual([
      'hello',
      'world',
    ]);
  });

  it('returns undefined when the level is absent', () => {
    const transcript = TrattAnnotation.deserialize(
      annotationFromOwnedLevel(ref, level, 16000),
    );
    expect(ownedLevelOf(transcript, 'Other', 16000)).toBeUndefined();
  });
});

// When the user is signed out of Visp, saves wait for them to sign in again.
describe('VispWorkspaceService when signed out', () => {
  function bare(bundles: Record<string, unknown>) {
    const service = Object.create(
      VispWorkspaceService.prototype,
    ) as VispWorkspaceService;
    const client = { close: jest.fn() };
    const autoSaves = { schedule: jest.fn() };
    Object.assign(service, {
      client,
      autoSaves,
      _bundles: signal(bundles),
    });
    return { service: service as any, client, autoSaves };
  }

  it('drops the websocket, which keeps the dead session, so the next try signs in afresh', () => {
    const { service, client } = bare({});
    expect(
      service.describe(new EmuServerError('User not identified')).kind,
    ).toBe('not_signed_in');
    expect(client.close).toHaveBeenCalled();
  });

  it('drops the websocket when someone else signed in, so the right user is picked up on their return', () => {
    const { service, client } = bare({});
    expect(
      service.describe(
        new EmuServerError(
          'Signed in to Visp as a different user than the one who made these changes.',
        ),
      ).kind,
    ).toBe('other_user');
    expect(client.close).toHaveBeenCalled();
  });

  it('keeps the websocket for other failures', () => {
    const { service, client } = bare({});
    service.describe(new EmuConnectionError('x'));
    service.describe(new EmuServerError('Bundle not found.'));
    expect(client.close).not.toHaveBeenCalled();
  });

  it('retries at once the saves that waited for a sign-in or for Visp, and no others', () => {
    const { service, autoSaves } = bare({
      a: { sync: 'failed', error: { kind: 'not_signed_in' } },
      b: { sync: 'failed', error: { kind: 'unreachable' } },
      c: { sync: 'failed', error: { kind: 'stale' } },
      d: { sync: 'saved' },
      e: { sync: 'failed', error: { kind: 'other_user' } },
    });
    service.retryBlockedSaves();
    expect(autoSaves.schedule.mock.calls).toEqual([
      ['a', 0],
      ['b', 0],
      ['e', 0],
    ]);
  });
});
