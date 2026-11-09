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
    if (/member/i.test(message)) return 'not_member';
    if (/session|sign|login|log in|authenticat|expired/i.test(message)) {
      return 'not_signed_in';
    }
  }
  if (/read-only \(no-transcription-level\)/.test(message)) {
    return 'no_transcription_level';
  }
  if (/read-only \(level-linked\)/.test(message)) return 'level_linked';
  return 'unknown';
}
