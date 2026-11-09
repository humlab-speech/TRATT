import { EmuConnectionError, EmuServerError } from './emu-websocket-client';
import { StaleBundleError } from './visp-bundle-source';
import { classifyVispError } from './visp-errors';

describe('classifyVispError', () => {
  it('maps failures to user situations', () => {
    expect(classifyVispError(new EmuConnectionError('x'))).toBe('unreachable');
    expect(classifyVispError(new StaleBundleError({} as any))).toBe('stale');
    expect(
      classifyVispError(new EmuServerError('User is not a member of project')),
    ).toBe('not_member');
    expect(classifyVispError(new EmuServerError('Session expired'))).toBe(
      'not_signed_in',
    );
    expect(
      classifyVispError(
        new Error('This workspace is read-only (no-transcription-level).'),
      ),
    ).toBe('no_transcription_level');
    expect(classifyVispError(new EmuServerError('Bundle not found.'))).toBe(
      'unknown',
    );
  });
});
