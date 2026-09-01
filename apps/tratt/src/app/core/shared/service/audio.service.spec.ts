import { describe, expect, it } from '@jest/globals';
import { Subject } from 'rxjs';
import { AudioService } from './audio.service';

describe('AudioService missingPermission notifier (C8)', () => {
  it('delivers every permission loss, not just the first', () => {
    const service = new AudioService({} as any);
    const missingPermission = new Subject<void>();

    service.registerAudioManager({
      resource: { name: 'test-audio' },
      audioMechanism: { missingPermission },
    } as any);

    let count = 0;
    service.missingPermission.subscribe(() => count++);

    missingPermission.next();
    missingPermission.next();

    expect(count).toBe(2);
  });
});
