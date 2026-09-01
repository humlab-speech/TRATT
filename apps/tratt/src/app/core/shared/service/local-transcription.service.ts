import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { IFile, OAnnotJSON, srtTimestamp } from '@tratt/annotation';
import { OAudiofile } from '@tratt/media';
import { AudioManager, prepareMonoAudioForMlModel } from '@tratt/web-media';
import { Observable, Subject } from 'rxjs';
import { AppInfo } from '../../../app.info';
import type {
  WorkerOutMessage,
  WorkerTranscribeMessage,
} from '../../workers/whisper-transcription.worker';
import { DiarizationOptions } from './local-diarization-runtime.service';
import { SpeakerTurn } from './local-diarization.service';
import {
  classifyTranscriptionWorkerError,
  transcriptionFriendlyError,
} from './local-transcription-errors';
import { finalizeTranscriptionAnnotJson } from './local-transcription-finalization';

export interface TranscriptionDownloadProgress {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface TranscriptionStart {
  type: 'transcribe-start';
  audioDurationS: number;
}

export interface TranscriptionSegmentProgress {
  type: 'segment-progress';
  segmentEndS: number;
}

export interface TranscriptionResult {
  type: 'result';
  annotJson: OAnnotJSON;
}

export interface TranscriptionBackendFallback {
  type: 'backend-fallback';
  backend: 'wasm';
}

export interface TranscriptionError {
  type: 'error';
  message: string;
}

export type TranscriptionEvent =
  | TranscriptionDownloadProgress
  | TranscriptionStart
  | TranscriptionSegmentProgress
  | TranscriptionBackendFallback
  | TranscriptionResult
  | TranscriptionError;

export interface TranscriptionOptions {
  modelId: string;
  useWebGPU: boolean;
  dtype?: string;
  language?: string;
  diarization?: DiarizationOptions;
  speakerTurns?: SpeakerTurn[];
}

@Injectable({ providedIn: 'root' })
export class LocalTranscriptionService implements OnDestroy {
  private worker: Worker | null = null;
  private subject: Subject<TranscriptionEvent> | null = null;

  constructor(private ngZone: NgZone) {}

  transcribe(
    audioManager: AudioManager,
    oaudiofile: OAudiofile,
    options: TranscriptionOptions,
  ): Observable<TranscriptionEvent> {
    this.cancel();

    const subject = new Subject<TranscriptionEvent>();
    this.subject = subject;

    // Tiers 1/3 normalize to 16 kHz; Tier 4 (WAV/OCTRA decoder) may not.
    const prepared = prepareMonoAudioForMlModel(audioManager);
    if (!prepared) {
      subject.error(new Error('Audio channel data not available'));
      return subject.asObservable();
    }
    const { mono, audioDurationS } = prepared;

    this.startWorker(subject, mono, oaudiofile, options, audioDurationS, false);

    return subject.asObservable();
  }

  private startWorker(
    subject: Subject<TranscriptionEvent>,
    mono: Float32Array,
    oaudiofile: OAudiofile,
    options: TranscriptionOptions,
    audioDurationS: number,
    hasRetriedToWasm: boolean,
  ): void {
    console.info('[octra:transcription] posting worker message', {
      modelId: options.modelId,
      useWebGPU: options.useWebGPU,
      dtype: options.dtype,
      language: options.language,
      audioDurationS,
      diarizationEnabled: !!options.diarization,
    });

    const worker = new Worker(
      new URL('../../workers/whisper-transcription.worker', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;

    worker.onmessage = ({ data }: MessageEvent<WorkerOutMessage>) => {
      this.ngZone.run(() => {
        if (data.type === 'result') {
          try {
            const annotJson = this.chunksToAnnotJson(
              data.chunks,
              oaudiofile,
              options,
            );
            subject.next({ type: 'result', annotJson });
            subject.complete();
          } catch (err: unknown) {
            subject.error(err);
          }
          this.cleanup();
        } else if (data.type === 'error') {
          const errorInfo = classifyTranscriptionWorkerError(
            data.message,
            options.useWebGPU,
          );
          if (
            errorInfo.shouldFallbackToWasm &&
            options.useWebGPU &&
            !hasRetriedToWasm
          ) {
            console.warn(
              '[octra:transcription] retrying with WASM after WebGPU backend load failure',
              {
                raw: data.message,
                modelId: options.modelId,
                language: options.language,
              },
            );
            subject.next({ type: 'backend-fallback', backend: 'wasm' });
            this.cleanup(false);
            this.startWorker(
              subject,
              mono,
              oaudiofile,
              {
                ...options,
                useWebGPU: false,
              },
              audioDurationS,
              true,
            );
            return;
          }
          console.error('[octra:transcription] worker error', {
            raw: data.message,
            friendly: transcriptionFriendlyError(
              data.message,
              options.useWebGPU,
            ),
            modelId: options.modelId,
            useWebGPU: options.useWebGPU,
            dtype: options.dtype,
            language: options.language,
            diarizationEnabled: !!options.diarization,
          });
          subject.error(
            new Error(
              transcriptionFriendlyError(data.message, options.useWebGPU),
            ),
          );
          this.cleanup();
        } else {
          subject.next(data);
        }
      });
    };

    worker.onerror = (err) => {
      this.ngZone.run(() => {
        console.error('[octra:transcription] worker onerror', {
          raw: err.message ?? '',
          friendly: transcriptionFriendlyError(
            err.message ?? '',
            options.useWebGPU,
          ),
          modelId: options.modelId,
          useWebGPU: options.useWebGPU,
          dtype: options.dtype,
          language: options.language,
          diarizationEnabled: !!options.diarization,
        });
        subject.error(
          new Error(
            transcriptionFriendlyError(err.message ?? '', options.useWebGPU),
          ),
        );
        this.cleanup();
      });
    };

    // Clone before transferring only on the WebGPU-first attempt: that's the
    // one call that can still trigger a WebGPU→WASM retry (see the fallback
    // branch above), and a transferred buffer is detached in this thread
    // once postMessage returns — transferring the original would leave the
    // retry with a detached buffer. Every other path (already-WASM, or the
    // retry attempt itself) has nothing left to retry with, so transfer
    // `mono` directly instead of paying for an extra full-size clone.
    const audioForTransfer =
      options.useWebGPU && !hasRetriedToWasm ? mono.slice() : mono;
    const message: WorkerTranscribeMessage = {
      type: 'transcribe',
      modelId: options.modelId,
      audio: audioForTransfer,
      useWebGPU: options.useWebGPU,
      audioDurationS,
      ...(options.dtype ? { dtype: options.dtype } : {}),
      ...(options.language ? { language: options.language } : {}),
    };
    worker.postMessage(message, [audioForTransfer.buffer]);
  }

  cancel(): void {
    if (this.worker) {
      this.cleanup();
    }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private cleanup(completeSubject = true): void {
    const w = this.worker;
    this.worker = null;
    w?.terminate(); // free WASM heap on every exit path
    if (completeSubject && this.subject && !this.subject.closed) {
      this.subject.complete();
    }
    if (completeSubject) {
      this.subject = null;
    }
  }

  private chunksToAnnotJson(
    chunks: Array<{ timestamp: [number, number | null]; text: string }>,
    oaudiofile: OAudiofile,
    options: TranscriptionOptions,
  ): OAnnotJSON {
    const audioDurationS = oaudiofile.duration / oaudiofile.sampleRate;
    const srtText = this.chunksToSrt(chunks, audioDurationS);
    if (!srtText) {
      throw new Error(
        'Transcription produced no valid segments — all output timestamps were invalid. ' +
          'Try disabling WebGPU in the options above and retry with WASM.',
      );
    }
    const srtConverter = AppInfo.converters.find((c) => c.name === 'SRT');
    if (!srtConverter) {
      throw new Error('SRT converter not found in AppInfo.converters');
    }

    const ofile: IFile = {
      name: oaudiofile.name.replace(/\.[^.]+$/, '') + '.srt',
      type: 'text/plain',
      content: srtText,
      encoding: 'UTF-8',
    };

    const result = srtConverter.import(ofile, oaudiofile);
    if (!result?.annotjson) {
      throw new Error(result?.error ?? 'SRT import returned no annotation');
    }

    return finalizeTranscriptionAnnotJson(result.annotjson, options);
  }

  private chunksToSrt(
    chunks: Array<{ timestamp: [number, number | null]; text: string }>,
    audioDurationS: number,
  ): string {
    let counter = 1;
    const lines = chunks
      .filter((c) => {
        const start = c.timestamp[0];
        const end = c.timestamp[1] ?? audioDurationS;
        return end > start && c.text.trim().length > 0;
      })
      .map((c) => {
        const start = c.timestamp[0];
        const end = c.timestamp[1] ?? audioDurationS;
        return `${counter++}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${c.text.trim()}`;
      });
    return lines.length > 0 ? lines.join('\n\n') + '\n' : '';
  }
}
