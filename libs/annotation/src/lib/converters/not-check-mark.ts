/**
 * U+237B NOT CHECK MARK — the in-file marker for non-verified
 * transcriptions.
 *
 * TRATT's own AnnotJSON stores `verified` as a field, but the time-aligned
 * exchange formats (SRT, WebVTT, ELAN, Praat, CTM, BAS Partitur, Whisper
 * JSON) have no such field. To keep the verification state across an
 * export/import round trip, export appends this mark to the END of every
 * non-verified transcription's text, and import treats a trailing mark as
 * "non-verified" (stripping it from the text) and unmarked text as
 * "verified".
 */
export const NOT_CHECK_MARK = '\u237B';

/**
 * Returns the transcription text with the not-check mark appended when the
 * segment is non-verified. Verified text is returned unchanged.
 */
export function appendNotCheckMark(text: string, verified: boolean): string {
  if (verified) {
    return text;
  }
  return text.trimEnd() + NOT_CHECK_MARK;
}

/**
 * Strips a trailing not-check mark from a transcription read from a file.
 * The returned `verified` mirrors the mark: marked text is non-verified,
 * unmarked text counts as verified.
 */
export function stripNotCheckMark(text: string): {
  text: string;
  verified: boolean;
} {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(NOT_CHECK_MARK)) {
    return {
      text: trimmed.slice(0, trimmed.length - NOT_CHECK_MARK.length).trimEnd(),
      verified: false,
    };
  }
  return { text: trimmed, verified: true };
}
