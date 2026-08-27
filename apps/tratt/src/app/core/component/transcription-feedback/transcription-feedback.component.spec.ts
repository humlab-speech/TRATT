import { describe, expect, it, jest } from '@jest/globals';
import { TranscriptionFeedbackComponent } from './transcription-feedback.component';

function createComponent(overrides: { feedback?: any } = {}) {
  const annotationStoreService = {
    feedback: overrides.feedback,
    changeFeedback: jest.fn(),
  } as never;
  const langService = {} as never;
  const appStorage = { save: jest.fn() } as never;
  const settingsService = { isTheme: jest.fn(() => false) } as never;

  return new TranscriptionFeedbackComponent(
    annotationStoreService,
    langService,
    appStorage,
    settingsService,
  );
}

describe('TranscriptionFeedbackComponent', () => {
  describe('changeValue', () => {
    it('does not throw when feedback is undefined', () => {
      const component = createComponent({ feedback: undefined });
      expect(() => component.changeValue('control', 'value')).not.toThrow();
    });
  });

  describe('checkBoxChanged', () => {
    it('does not throw when feedback is undefined', () => {
      const component = createComponent({ feedback: undefined });
      expect(() => component.checkBoxChanged('group', 'checkb')).not.toThrow();
    });
  });
});
