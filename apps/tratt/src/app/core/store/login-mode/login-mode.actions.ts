import { HttpErrorResponse } from '@angular/common/http';
import {
  Action,
  createAction,
  createActionGroup,
  emptyProps,
  props,
} from '@ngrx/store';
import { CurrentAccountDto, ProjectDto, TaskDto } from '@octra/api-types';
import {
  IAnnotJSON,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { SessionFile } from '../../obj/SessionFile';
import { IIDBModeOptions } from '../../shared/tratt-database';
import { LoginMode } from '../index';
import { AnnotationActions } from './annotation/annotation.actions';

export class LoginModeActions extends AnnotationActions {
  public static setFeedback = createAction(
    `annotation Set feedback`,
    props<{
      feedback: any;
      mode: LoginMode;
    }>(),
  );

  static createBundle = createAction(
    'annotation Create bundle',
    props<{
      mode: LoginMode;
      bundleId: string;
      sessionFile: SessionFile;
      restoredOptions?: IIDBModeOptions;
      restoredAnnotation?: IAnnotJSON;
    }>(),
  );

  static selectBundle = createAction(
    'annotation Select bundle',
    props<{ mode: LoginMode; bundleId: string }>(),
  );

  /**
   * Writes a transcript into ONE named bundle, independent of the current
   * selection. `AnnotationActions.overwriteTranscript.do` cannot be used for
   * this: every action except createBundle/selectBundle is routed by
   * `wrapAsLocalBundleCollectionReducer` to `selectedBundleId`, so using it
   * for a background pipeline result would overwrite whatever bundle the
   * user currently has open. Dispatched by PipelineQueueService when a
   * queued run produces its annotation.
   */
  static setBundleTranscript = createAction(
    'annotation Set bundle transcript',
    props<{
      mode: LoginMode;
      bundleId: string;
      transcript: TrattAnnotation<TrattAnnotationSegment>;
    }>(),
  );

  /**
   * Bulk-removes bundles from the local collection (BundleListComponent's
   * "remove" bulk action). The reducer guarantees the collection never ends
   * up empty — see its own comment.
   */
  static removeBundles = createAction(
    'annotation Remove bundles',
    props<{ mode: LoginMode; bundleIds: string[] }>(),
  );

  static changeComment = createActionGroup({
    source: `annotation/change comment`,
    events: {
      do: props<{
        mode: LoginMode;
        comment: string;
      }>(),
      fail: props<{
        error: string;
      }>(),
    },
  });

  static setImportConverter = createActionGroup({
    source: 'annotation/set import converter',
    events: {
      do: props<{
        mode: LoginMode;
        importConverter: string;
      }>(),
      success: emptyProps(),
      fail: props<{
        error: string;
      }>(),
    },
  });

  static clearOnlineSession = createActionGroup({
    source: `annotation/ clear online session`,
    events: {
      do: props<{
        mode: LoginMode;
        actionAfterSuccess: Action;
      }>(),
      success: props<{
        mode: LoginMode;
        actionAfterSuccess: Action;
      }>(),
      fail: props<{
        error: string;
      }>(),
    },
  });

  static loadProjectAndTaskInformation = createActionGroup({
    source: `annotation/ load project and task information`,
    events: {
      do: props<{
        projectID?: string;
        taskID?: string;
        mode: LoginMode;
        startup?: boolean;
      }>(),
      success: props<{
        mode?: LoginMode;
        me?: CurrentAccountDto;
        currentProject?: ProjectDto;
        task?: TaskDto;
        startup?: boolean;
      }>(),
      fail: props<{
        error: HttpErrorResponse;
        startup?: boolean;
      }>(),
    },
  });

  static loadCurrentAccountInformation = createActionGroup({
    source: 'authentication/load current account information',
    events: {
      do: props<{
        mode: LoginMode;
        actionAfterSuccess: Action;
      }>(),
      success: props<{
        mode: LoginMode;
        me: CurrentAccountDto;
        actionAfterSuccess: Action;
      }>(),
      fail: props<{
        error: string;
      }>(),
    },
  });

  static endTranscription = createActionGroup({
    source: 'annotation/ redirect to transcription end',
    events: {
      do: props<{ clearSession: boolean; mode: LoginMode }>(),
    },
  });

  static changeImportOptions = createActionGroup({
    source: 'annotation/change converter options',
    events: {
      do: props<{
        mode: LoginMode;
        importOptions?: Record<string, any>;
      }>(),
      success: emptyProps(),
      fail: props<{
        error: string;
      }>(),
    },
  });
}
