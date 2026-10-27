import { describe, expect, it } from 'vitest';
import {
  appendNotCheckMark,
  NOT_CHECK_MARK,
  stripNotCheckMark,
} from './not-check-mark';

describe('not-check mark helpers', () => {
  it('appends the mark only to non-verified text', () => {
    expect(appendNotCheckMark('hello', false)).toBe(`hello${NOT_CHECK_MARK}`);
    expect(appendNotCheckMark('hello', true)).toBe('hello');
  });

  it('trims trailing whitespace before appending', () => {
    expect(appendNotCheckMark('hello  ', false)).toBe(`hello${NOT_CHECK_MARK}`);
  });

  it('strips a trailing mark and reports non-verified', () => {
    expect(stripNotCheckMark(`hello${NOT_CHECK_MARK}`)).toEqual({
      text: 'hello',
      verified: false,
    });
  });

  it('tolerates whitespace between text and the mark', () => {
    expect(stripNotCheckMark(`hello ${NOT_CHECK_MARK}`)).toEqual({
      text: 'hello',
      verified: false,
    });
  });

  it('treats unmarked text as non-verified (conservative default)', () => {
    expect(stripNotCheckMark('hello')).toEqual({
      text: 'hello',
      verified: false,
    });
  });

  it('round-trips: marked text returns to its non-verified state', () => {
    // Trailing whitespace is trimmed to glue the mark to the text; leading
    // whitespace is part of the transcription and survives.
    const exported = appendNotCheckMark('  hello world ', false);
    expect(stripNotCheckMark(exported)).toEqual({
      text: '  hello world',
      verified: false,
    });
  });
});
