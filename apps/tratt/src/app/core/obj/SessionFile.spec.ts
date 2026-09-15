import { describe, expect, it } from '@jest/globals';
import { SessionFile } from './SessionFile';

describe('SessionFile', () => {
  it('round-trips timestamp through toAny()/fromAny()', () => {
    const original = new SessionFile('a.wav', 100, new Date(12345), 'audio/wav');

    const restored = SessionFile.fromAny(original.toAny());

    expect(restored?.timestamp).toEqual(new Date(12345));
  });

  it('round-trips timestamp through an ACTUAL JSON hop as a real Date, not a string (Fix 2)', () => {
    // TrattDatabase.saveModeData() does JSON.parse(JSON.stringify(value))
    // before writing — that turns a Date into an ISO string. fromAny() must
    // convert it back, not hand back a string disguised as a Date.
    const original = new SessionFile('a.wav', 100, new Date(12345), 'audio/wav');

    const restored = SessionFile.fromAny(
      JSON.parse(JSON.stringify(original.toAny())),
    );

    expect(restored?.timestamp).toBeInstanceOf(Date);
    expect(restored?.timestamp?.getTime()).toBe(12345);
  });

  it('fromAny() on an object with no timestamp key returns a valid SessionFile with timestamp: undefined', () => {
    const restored = SessionFile.fromAny({
      name: 'a.wav',
      size: 100,
      type: 'audio/wav',
    });

    expect(restored).toBeDefined();
    expect(restored?.timestamp).toBeUndefined();
  });
});
