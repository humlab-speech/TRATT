import { describe, expect, it, jest } from '@jest/globals';
import { TranscriptionFeedbackComponent } from './transcription-feedback.component';

function createComponent(overrides: { feedback?: any } = {}) {
  const changeFeedback = jest.fn();
  const annotationStoreService = {
    feedback: overrides.feedback,
    changeFeedback,
  } as never;
  const langService = {} as never;
  const appStorage = { save: jest.fn() } as never;
  const settingsService = { isTheme: jest.fn(() => false) } as never;

  return {
    component: new TranscriptionFeedbackComponent(
      annotationStoreService,
      langService,
      appStorage,
      settingsService,
    ),
    changeFeedback,
  };
}

// `annotationStoreService.feedback` is not always a `FeedBackForm` instance at runtime —
// it can also be a legacy rating string ('SEVERE'/'SLIGHT'/'OK') or `{}`, both set via
// `AppStorageService.feedback` (see AnnotationStoreService's FeedbackAssessment type).
// These cases must be guarded against, not just `undefined`.
describe('TranscriptionFeedbackComponent', () => {
  describe('changeValue', () => {
    it('does not throw when feedback is undefined', () => {
      const { component } = createComponent({ feedback: undefined });
      expect(() => component.changeValue('control', 'value')).not.toThrow();
    });

    it('does not throw and does not call changeFeedback when feedback is {}', () => {
      const { component, changeFeedback } = createComponent({ feedback: {} });
      expect(() => component.changeValue('control', 'value')).not.toThrow();
      expect(changeFeedback).not.toHaveBeenCalled();
    });

    it('does not throw and does not call changeFeedback when feedback is a legacy rating string', () => {
      const { component, changeFeedback } = createComponent({
        feedback: 'SEVERE',
      });
      expect(() => component.changeValue('control', 'value')).not.toThrow();
      expect(changeFeedback).not.toHaveBeenCalled();
    });
  });

  describe('checkBoxChanged', () => {
    it('does not throw when feedback is undefined', () => {
      const { component } = createComponent({ feedback: undefined });
      expect(() => component.checkBoxChanged('group', 'checkb')).not.toThrow();
    });

    it('does not throw when feedback is {}', () => {
      const { component } = createComponent({ feedback: {} });
      expect(() => component.checkBoxChanged('group', 'checkb')).not.toThrow();
    });

    it('does not throw when feedback is a legacy rating string', () => {
      const { component } = createComponent({ feedback: 'SLIGHT' });
      expect(() => component.checkBoxChanged('group', 'checkb')).not.toThrow();
    });
  });

  describe('saveFeedbackform', () => {
    it('does not throw when feedback is {}', () => {
      const { component } = createComponent({ feedback: {} });
      expect(() => component.saveFeedbackform()).not.toThrow();
    });

    it('does not throw when feedback is a legacy rating string', () => {
      const { component } = createComponent({ feedback: 'OK' });
      expect(() => component.saveFeedbackform()).not.toThrow();
    });
  });
});
