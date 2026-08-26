import { Injectable } from '@angular/core';
import { TaskDto, TaskStatus } from '@octra/api-types';
import { OctraAPIService } from '@octra/ngx-octra-api';
import { AnnotJSONConverter } from '@tratt/annotation';
import { Observable, of } from 'rxjs';
import { AudioService } from '../../../shared/service';
import { RootState } from '../../index';

@Injectable({ providedIn: 'root' })
export class AnnotationPersistenceService {
  constructor(
    private apiService: OctraAPIService,
    private audio: AudioService,
  ) {}

  saveTaskToServer(
    state: RootState,
    status: TaskStatus,
  ): Observable<TaskDto | undefined> {
    if (!this.audio.audioManager?.resource) {
      return of(undefined);
    }

    const result = new AnnotJSONConverter().export(
      state.onlineMode.transcript
        .clone()
        .serialize(
          this.audio.audioManager.resource.info.fullname,
          this.audio.audioManager.resource.info.sampleRate,
          this.audio.audioManager.resource.info.duration.clone(),
        ),
    )?.file?.content;

    const outputs = result
      ? [
          new File(
            [result],
            state.onlineMode.audio.fileName.substring(
              0,
              state.onlineMode.audio.fileName.lastIndexOf('.'),
            ) + '_annot.json',
            {
              type: 'application/json',
            },
          ),
        ]
      : [];

    return this.apiService.saveTask(
      state.onlineMode.currentSession!.currentProject!.id,
      state.onlineMode.currentSession!.task!.id,
      {
        assessment: state.onlineMode.currentSession.assessment,
        comment: state.onlineMode.currentSession.comment,
        status,
      },
      state.onlineMode.logging.logs
        ? new File(
            [JSON.stringify(state.onlineMode.logging.logs)],
            'log.json',
            {
              type: 'application/json',
            },
          )
        : undefined,
      outputs,
    );
  }
}
