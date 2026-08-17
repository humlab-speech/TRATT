import { InjectionToken } from '@angular/core';

export const LOCAL_DIARIZATION_WORKER_FACTORY = new InjectionToken<
  () => Worker
>('LOCAL_DIARIZATION_WORKER_FACTORY');
