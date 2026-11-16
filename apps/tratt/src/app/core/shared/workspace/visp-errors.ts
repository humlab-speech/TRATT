import { EmuConnectionError, EmuServerError } from './emu-websocket-client';
import { StaleBundleError } from './visp-bundle-source';

export type VispErrorKind =
  | 'not_signed_in'
  | 'not_member'
  | 'no_transcription_level'
  | 'level_linked'
  | 'unreachable'
  | 'stale'
  | 'unassigned'
  | 'unknown';

/**
 * Maps a failure to one of the user-facing situations (each has a translated
 * message with a next step). The server's auth reasons are free text, so they
 * are matched loosely; anything unrecognised is `unknown` and the caller shows
 * the server's own message.
 */
export function classifyVispError(error: unknown): VispErrorKind {
  if (error instanceof StaleBundleError) return 'stale';
  if (error instanceof EmuConnectionError) return 'unreachable';
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof EmuServerError) {
    // The server could not check the sign-in just now: worth retrying, and
    // not the user's doing.
    if (/could not confirm|try again/i.test(message)) return 'unreachable';
    if (/member|not authori[sz]ed/i.test(message)) return 'not_member';
    // "User not identified" is how annotation-server says signed out.
    if (
      /session|sign|login|log in|authenticat|expired|not identified/i.test(
        message,
      )
    ) {
      return 'not_signed_in';
    }
  }
  if (/read-only \(no-transcription-level\)/.test(message)) {
    return 'no_transcription_level';
  }
  if (/read-only \(level-linked\)/.test(message)) return 'level_linked';
  return 'unknown';
}
