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

  // The reasons annotation-server gives, old and new wording.
  it.each([
    ['User not identified', 'not_signed_in'],
    ['User not identified (not signed in to Visp)', 'not_signed_in'],
    ['User not authorized to access the project with id p1', 'not_member'],
    ['User is not a member of the project with id p1', 'not_member'],
    [
      'Visp could not confirm who you are right now; try again in a moment',
      'unreachable',
    ],
  ])('reads "%s" as %s', (reason, kind) => {
    expect(classifyVispError(new EmuServerError(reason))).toBe(kind);
  });
});
