import { NgZone } from '@angular/core';
import { describe, expect, it, jest } from '@jest/globals';
import {
  DIARIZATION_DEFAULT_MODEL_ID,
  LocalDiarizationRuntimeService,
} from './local-diarization-runtime.service';

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = jest.fn();
  terminate = jest.fn();
}

describe('LocalDiarizationRuntimeService', () => {
  it('uses the public no-auth diarization model by default', () => {
    expect(DIARIZATION_DEFAULT_MODEL_ID).toBe(
      'onnx-community/pyannote-segmentation-3.0',
    );
  });

  it('posts a diarize message and emits worker results', () => {
    const worker = new MockWorker();
    const service = new LocalDiarizationRuntimeService(
      new NgZone({ enableLongStackTrace: false }),
      () => worker as unknown as Worker,
    );

    const events: unknown[] = [];
    const audioManager = {
      channel: new Float32Array([0, 0.5, -0.5, 0]),
      sampleRate: 16000,
      resource: {
        info: {
          audioBufferInfo: {
            sampleRate: 16000,
          },
        },
      },
    };

    service
      .diarize(audioManager as never, {
        modelId: DIARIZATION_DEFAULT_MODEL_ID,
        useWebGPU: false,
      })
      .subscribe((event: unknown) => events.push(event));

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: 'diarize',
      modelId: DIARIZATION_DEFAULT_MODEL_ID,
      useWebGPU: false,
      audioDurationS: 4 / 16000,
    });

    worker.onmessage?.({
      data: { type: 'diarize-start', audioDurationS: 4 / 16000 },
    } as MessageEvent);
    worker.onmessage?.({
      data: {
        type: 'result',
        turns: [{ startS: 0, endS: 1, speakerId: '0' }],
      },
    } as MessageEvent);

    expect(events).toEqual([
      { type: 'diarize-start', audioDurationS: 4 / 16000 },
      { type: 'result', turns: [{ startS: 0, endS: 1, speakerId: '0' }] },
    ]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('maps GPU failures to a friendly error', () => {
    const worker = new MockWorker();
    const service = new LocalDiarizationRuntimeService(
      new NgZone({ enableLongStackTrace: false }),
      () => worker as unknown as Worker,
    );

    const errors: string[] = [];
    const audioManager = {
      channel: new Float32Array([0, 0.5, -0.5, 0]),
      sampleRate: 16000,
      resource: {
        info: {
          audioBufferInfo: {
            sampleRate: 16000,
          },
        },
      },
    };

    service
      .diarize(audioManager as never, {
        modelId: DIARIZATION_DEFAULT_MODEL_ID,
        useWebGPU: true,
      })
      .subscribe({
        error: (error: Error) => errors.push(error.message),
      });

    worker.onmessage?.({
      data: { type: 'error', message: 'GPU device lost' },
    } as MessageEvent);

    expect(errors[0]).toContain('WebGPU error during speaker segmentation');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker when cancelled', () => {
    const worker = new MockWorker();
    const service = new LocalDiarizationRuntimeService(
      new NgZone({ enableLongStackTrace: false }),
      () => worker as unknown as Worker,
    );

    const audioManager = {
      channel: new Float32Array([0, 0.5, -0.5, 0]),
      sampleRate: 16000,
      resource: {
        info: {
          audioBufferInfo: {
            sampleRate: 16000,
          },
        },
      },
    };

    service
      .diarize(audioManager as never, {
        modelId: DIARIZATION_DEFAULT_MODEL_ID,
        useWebGPU: false,
      })
      .subscribe();

    service.cancel();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
