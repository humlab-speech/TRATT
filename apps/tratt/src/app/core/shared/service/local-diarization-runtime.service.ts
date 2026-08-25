import { Inject, Injectable, NgZone, OnDestroy, Optional } from '@angular/core';
import {
  AudioManager,
  ML_MODEL_SAMPLE_RATE,
  resampleChannels,
} from '@tratt/web-media';
import { Observable, Subject } from 'rxjs';
import type {
  WorkerDiarizationOutMessage,
  WorkerDiarizeMessage,
} from '../../workers/pyannote-diarization.worker';
import { LOCAL_DIARIZATION_WORKER_FACTORY } from './local-diarization-worker.token';
import { SpeakerTurn } from './local-diarization.service';

export interface DiarizationDownloadProgress {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface DiarizationStart {
  type: 'diarize-start';
  audioDurationS: number;
}

export interface DiarizationResult {
  type: 'result';
  turns: SpeakerTurn[];
}

export interface DiarizationError {
  type: 'error';
  message: string;
}

export type DiarizationEvent =
  | DiarizationDownloadProgress
  | DiarizationStart
  | DiarizationResult
  | DiarizationError;

export interface DiarizationOptions {
  modelId: string;
  useWebGPU: boolean;
  dtype?: DiarizationDType;
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
  mergeGapS?: number;
  minTurnS?: number;
  minConfidence?: number;
}

export type DiarizationDType =
  | 'auto'
  | 'fp32'
  | 'fp16'
  | 'q8'
  | 'int8'
  | 'uint8'
  | 'q4'
  | 'bnb4'
  | 'q4f16';

export const DIARIZATION_DEFAULT_MODEL_ID =
  'onnx-community/pyannote-segmentation-3.0';

@Injectable()
export class LocalDiarizationRuntimeService implements OnDestroy {
  private worker: Worker | null = null;
  private subject: Subject<DiarizationEvent> | null = null;

  constructor(
    private ngZone: NgZone,
    @Optional()
    @Inject(LOCAL_DIARIZATION_WORKER_FACTORY)
    private createWorker: (() => Worker) | null = null,
  ) {}

  diarize(
    audioManager: AudioManager,
    options: DiarizationOptions,
  ): Observable<DiarizationEvent> {
    this.cancel();

    const subject = new Subject<DiarizationEvent>();
    this.subject = subject;

    const channel = audioManager.channel;
    if (!channel) {
      subject.error(new Error('Audio channel data not available'));
      return subject.asObservable();
    }

    const srcRate =
      audioManager.resource.info.audioBufferInfo?.sampleRate ??
      audioManager.sampleRate;
    const mono: Float32Array =
      srcRate !== ML_MODEL_SAMPLE_RATE
        ? resampleChannels([channel], srcRate, ML_MODEL_SAMPLE_RATE)[0]
        : new Float32Array(channel);

    const audioDurationS = mono.length / ML_MODEL_SAMPLE_RATE;
    console.info('[octra:diarization] audio sent to worker', {
      srcRate,
      resampledSampleRate: ML_MODEL_SAMPLE_RATE,
      monoSamples: mono.length,
      audioDurationS,
    });
    if (!this.createWorker) {
      subject.error(
        new Error('Local diarization worker factory is not configured'),
      );
      return subject.asObservable();
    }

    const worker = this.createWorker();
    this.worker = worker;

    worker.onmessage = ({
      data,
    }: MessageEvent<WorkerDiarizationOutMessage>) => {
      this.ngZone.run(() => {
        if (data.type === 'result') {
          subject.next({ type: 'result', turns: data.turns });
          subject.complete();
          this.cleanup();
        } else if (data.type === 'error') {
          subject.error(
            new Error(this.friendlyError(data.message, options.useWebGPU)),
          );
          this.cleanup();
        } else {
          subject.next(data);
        }
      });
    };

    worker.onerror = (err) => {
      this.ngZone.run(() => {
        subject.error(
          new Error(this.friendlyError(err.message ?? '', options.useWebGPU)),
        );
        this.cleanup();
      });
    };

    const message: WorkerDiarizeMessage = {
      type: 'diarize',
      modelId: options.modelId,
      audio: mono,
      useWebGPU: options.useWebGPU,
      audioDurationS,
      ...(options.dtype ? { dtype: options.dtype } : {}),
      ...(options.numSpeakers != null
        ? { numSpeakers: options.numSpeakers }
        : {}),
      ...(options.minSpeakers != null
        ? { minSpeakers: options.minSpeakers }
        : {}),
      ...(options.maxSpeakers != null
        ? { maxSpeakers: options.maxSpeakers }
        : {}),
      ...(options.mergeGapS != null ? { mergeGapS: options.mergeGapS } : {}),
      ...(options.minTurnS != null ? { minTurnS: options.minTurnS } : {}),
      ...(options.minConfidence != null
        ? { minConfidence: options.minConfidence }
        : {}),
    };
    worker.postMessage(message, [mono.buffer]);

    return subject.asObservable();
  }

  cancel(): void {
    if (this.worker) {
      this.cleanup();
    }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private cleanup(): void {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    if (this.subject && !this.subject.closed) {
      this.subject.complete();
    }
    this.subject = null;
  }

  private friendlyError(raw: string, usedWebGPU: boolean): string {
    const lower = raw.toLowerCase();
    const isGpuError =
      lower.includes('device') ||
      lower.includes('gpu') ||
      lower.includes('webgpu') ||
      lower.includes('out of memory') ||
      lower.includes('oom');

    if (usedWebGPU && isGpuError) {
      return (
        'WebGPU error during speaker segmentation: the GPU ran out of memory or lost ' +
        'its connection. Try disabling WebGPU and run with WASM instead.'
      );
    }

    return raw;
  }
}
