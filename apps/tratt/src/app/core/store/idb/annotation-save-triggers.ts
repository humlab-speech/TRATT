import { AuthenticationActions } from '../authentication';
import { AnnotationActions } from '../login-mode/annotation/annotation.actions';

/**
 * The actions after which `IDBEffects.saveAnnotation` writes the selected
 * bundle's transcript to IndexedDB — each one is answered by exactly one
 * `IDBActions.saveAnnotation.success` or `.fail`. Shared with
 * `AnnotationSaveTracker`, which counts writes still in flight, so the two
 * can't drift apart.
 */
export const ANNOTATION_SAVE_TRIGGERS = [
  AnnotationActions.changeAnnotationLevel.do,
  AnnotationActions.addAnnotationLevel.do,
  AnnotationActions.removeAnnotationLevel.do,
  AnnotationActions.overwriteTranscript.do,
  AnnotationActions.addCurrentLevelItems.do,
  AnnotationActions.removeCurrentLevelItems.do,
  AnnotationActions.changeCurrentLevelItems.do,
  AnnotationActions.changeCurrentItemById.do,
  AnnotationActions.changeLevelName.do,
  AnnotationActions.duplicateLevel.do,
  AuthenticationActions.loginLocal.prepare,
  AnnotationActions.initTranscriptionService.success,
] as const;
