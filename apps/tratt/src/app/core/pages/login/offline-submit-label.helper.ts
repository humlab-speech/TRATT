export interface OfflineSubmitLabelState {
  hasAnnotation: boolean;
  transcribeSelected: boolean;
  translateSelected: boolean;
}

/**
 * Decides which i18n key the local-mode submit button should show.
 * See the decision table in docs/superpowers/plans/2026-08-30-login-ui-i18n-and-labels.md
 * (Task 5) for the reasoning behind each branch.
 */
export function offlineSubmitLabelKey(state: OfflineSubmitLabelState): string {
  if (state.transcribeSelected && state.hasAnnotation) {
    return 'transcription.replace cached annotation';
  }
  if (state.transcribeSelected || state.translateSelected) {
    return 'transcription.automatic';
  }
  if (!state.hasAnnotation) {
    return 'transcription.manual';
  }
  return 'transcription.start';
}
