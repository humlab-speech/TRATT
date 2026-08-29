import { ProjectDto, TaskDto, TaskInputOutputDto } from '@octra/api-types';
import {
  OSegment,
  SegmentWithContext,
  TrattAnnotation,
  TrattAnnotationSegment,
} from '@tratt/annotation';
import { TrattGuidelines } from '@tratt/assets';
import { Histories, UndoRedoState } from 'ngrx-wieder';
import { pipe } from 'rxjs';
import { ProjectSettings } from '../../../obj';
import { FeedBackForm } from '../../../obj/FeedbackForm/FeedBackForm';
import { SessionFile } from '../../../obj/SessionFile';
import { ILog } from '../../../obj/Settings/logging';
import { getModeState, RootState } from '../../index';

export interface GuidelinesItem {
  filename: string;
  name: string;
  json: TrattGuidelines;
  type?: string;
}

export class AnnotationStateSegment extends TrattAnnotationSegment {
  static override deserialize(
    jsonObject: SegmentWithContext,
  ): AnnotationStateSegment {
    return new AnnotationStateSegment(
      jsonObject.id,
      jsonObject.time,
      jsonObject.labels,
    );
  }

  override serializeToOSegment(sampleStart: number): OSegment {
    return new OSegment(
      this.id,
      sampleStart,
      this.time.samples - sampleStart,
      this.labels,
    );
  }
}

export interface AnnotationState extends UndoRedoState {
  savingNeeded: boolean;
  isSaving: boolean;
  additionalSpeakerIds: string[];
  currentEditor?: string;
  importOptions?: Record<string, any>;
  importConverter?: string;
  previousCurrentLevel?: number;
  audio: {
    loaded: boolean;
    fileName: string;
    sampleRate: number;
    file?: TaskInputOutputDto; // TODO <- add audio file here
  };
  guidelines?: {
    selected?: GuidelinesItem;
    list: GuidelinesItem[];
  };
  logging: {
    enabled: boolean;
    logs: ILog[];
    startTime?: number;
    startReference?: ILog;
  };
  projectConfig?: ProjectSettings;
  methods?: {
    validate: (transcript: string, guidelines: any) => any;
    tidyUp: (transcript: string, guidelines: any) => any;
  };
  transcript: TrattAnnotation<TrattAnnotationSegment>;
  histories: Histories;
  currentSession: AnnotationSessionState;
  previousSession?: {
    task: {
      id: string;
    };
    project: {
      id: string;
    };
  };
  sessionFile?: SessionFile;
}

export interface AnnotationSessionState {
  status?: 'processing' | 'sending';
  loadFromServer?: boolean;
  currentProject?: ProjectDto;
  task?: TaskDto;
  feedback?: FeedBackForm;
  assessment?: any;
  comment?: string;
}

export const selectAnnotation = (state: RootState) => {
  const mode = getModeState(state);
  if (mode) {
    return mode;
  }

  return undefined;
};
export const selectAudioLoaded = pipe(
  selectAnnotation,
  (state) => state?.audio.loaded,
);
export const selectProjectConfig = pipe(
  selectAnnotation,
  (state) => state?.projectConfig,
);
export const selectGuideLines = pipe(
  selectAnnotation,
  (state) => state?.guidelines,
);
export const selectMethods = pipe(selectAnnotation, (state) => state?.methods);
export const selectAnnotationLevels = pipe(
  selectAnnotation,
  (state) => state?.transcript.levels,
);
export const selectAnnotationLinks = pipe(
  selectAnnotation,
  (state) => state?.transcript.links,
);
