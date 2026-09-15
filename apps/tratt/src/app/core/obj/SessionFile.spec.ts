import { describe, expect, it } from '@jest/globals';
import { SessionFile } from './SessionFile';

describe('SessionFile', () => {
  it('round-trips timestamp through toAny()/fromAny()', () => {
    const original = new SessionFile('a.wav', 100, new Date(12345), 'audio/wav');

    const restored = SessionFile.fromAny(original.toAny());

    expect(restored?.timestamp).toEqual(new Date(12345));
  });
});
