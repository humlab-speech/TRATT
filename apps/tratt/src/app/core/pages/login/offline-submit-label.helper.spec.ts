import { describe, expect, it } from '@jest/globals';
import { offlineSubmitLabelKey } from './offline-submit-label.helper';

describe('offlineSubmitLabelKey', () => {
  it('returns the manual-transcription key when nothing is cached or selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: false,
        translateSelected: false,
      }),
    ).toBe('transcription.manual');
  });

  it('returns the automatic-processing key when transcription is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: true,
        translateSelected: false,
      }),
    ).toBe('transcription.automatic');
  });

  it('returns the automatic-processing key when translation is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: false,
        transcribeSelected: false,
        translateSelected: true,
      }),
    ).toBe('transcription.automatic');
  });

  it('returns the replace-cached key when transcription is selected and an annotation is already cached', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: true,
        translateSelected: false,
      }),
    ).toBe('transcription.replace cached annotation');
  });

  it('returns the replace-cached key even if translation is also selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: true,
        translateSelected: true,
      }),
    ).toBe('transcription.replace cached annotation');
  });

  it('falls back to the existing continue-transcription key when an annotation is cached and nothing automatic is selected', () => {
    expect(
      offlineSubmitLabelKey({
        hasAnnotation: true,
        transcribeSelected: false,
        translateSelected: false,
      }),
    ).toBe('transcription.start');
  });
});
