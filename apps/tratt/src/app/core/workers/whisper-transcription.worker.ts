/// <reference lib="webworker" />

import { env, pipeline, WhisperTextStreamer } from '@huggingface/transformers';

// Point ONNX Runtime to the locally served WASM files
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/assets/ort/';
}

async function isCacheAvailable(): Promise<boolean> {
  try {
    await caches.open('__probe__');
    return true;
  } catch {
    return false;
  }
}

export interface WorkerTranscribeMessage {
  type: 'transcribe';
  modelId: string;
  audio: Float32Array;
  useWebGPU: boolean;
  audioDurationS: number;
  dtype?: string;
  language?: string;
}

export interface WorkerDownloadProgressMessage {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface WorkerTranscribeStartMessage {
  type: 'transcribe-start';
  audioDurationS: number;
}

export interface WorkerSegmentProgressMessage {
  type: 'segment-progress';
  segmentEndS: number;
}

export interface WorkerResultMessage {
  type: 'result';
  chunks: Array<{ timestamp: [number, number]; text: string }>;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerOutMessage =
  | WorkerDownloadProgressMessage
  | WorkerTranscribeStartMessage
  | WorkerSegmentProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null;
let loadedModelId: string | null = null;

addEventListener(
  'message',
  async ({ data }: MessageEvent<WorkerTranscribeMessage>) => {
    if (data.type !== 'transcribe') return;

    const { modelId, audio, useWebGPU, audioDurationS, dtype, language } = data;

    try {
      console.info('[octra:whisper-worker] received message', {
        modelId,
        useWebGPU,
        dtype,
        language,
        audioDurationS,
        audioSamples: audio.length,
      });

      if (!(await isCacheAvailable())) {
        env.useBrowserCache = false;
      }

      if (!transcriber || loadedModelId !== modelId) {
        transcriber = null;
        loadedModelId = null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pipelineFn = pipeline as any;
        const fileProgress = new Map<
          string,
          { loaded: number; total: number }
        >();
        console.info('[octra:whisper-worker] loading pipeline', {
          modelId,
          device: useWebGPU ? 'webgpu' : 'wasm',
          dtype,
        });
        transcriber = await pipelineFn(
          'automatic-speech-recognition',
          modelId,
          {
            device: useWebGPU ? 'webgpu' : 'wasm',
            ...(dtype ? { dtype } : {}),
            progress_callback: (progress: any) => {
              if (
                progress?.status === 'progress' &&
                progress.loaded !== undefined
              ) {
                fileProgress.set(progress.file ?? '', {
                  loaded: progress.loaded,
                  total: progress.total ?? 0,
                });
                let totalLoaded = 0;
                let totalSize = 0;
                for (const fp of fileProgress.values()) {
                  totalLoaded += fp.loaded;
                  totalSize += fp.total;
                }
                const msg: WorkerDownloadProgressMessage = {
                  type: 'download-progress',
                  loaded: totalLoaded,
                  total: totalSize,
                  file: progress.file ?? '',
                };
                postMessage(msg);
              }
            },
          },
        );

        console.info('[octra:whisper-worker] pipeline ready', {
          modelId,
          device: useWebGPU ? 'webgpu' : 'wasm',
          dtype,
        });

        loadedModelId = modelId;
      }

      // Signal that transcription is about to start (model loaded)
      const startMsg: WorkerTranscribeStartMessage = {
        type: 'transcribe-start',
        audioDurationS,
      };
      postMessage(startMsg);

      const CHUNK_LENGTH_S = 30;
      const STRIDE_LENGTH_S = 5;
      // Effective audio advance per chunk (non-overlapping portion)
      const CHUNK_ADVANCE_S = CHUNK_LENGTH_S - STRIDE_LENGTH_S;

      // on_chunk_end receives chunk-relative timestamps (0..CHUNK_LENGTH_S).
      // Detect rollovers to compute absolute position in the full audio file.
      let chunkCount = 0;
      let prevEndTimeS = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamer = new (WhisperTextStreamer as any)(transcriber.tokenizer, {
        skip_special_tokens: true,
        on_chunk_end: (endTimeS: number) => {
          if (endTimeS < prevEndTimeS) {
            chunkCount++;
          }
          prevEndTimeS = endTimeS;
          const absoluteEndS = Math.min(
            chunkCount * CHUNK_ADVANCE_S + endTimeS,
            audioDurationS,
          );
          const segMsg: WorkerSegmentProgressMessage = {
            type: 'segment-progress',
            segmentEndS: absoluteEndS,
          };
          postMessage(segMsg);
        },
      });

      console.info('[octra:whisper-worker] starting inference', {
        modelId,
        chunkLengthS: CHUNK_LENGTH_S,
        strideLengthS: STRIDE_LENGTH_S,
        language: language ?? 'sv',
      });
      const result: any = await (transcriber as any)(audio, {
        return_timestamps: true,
        chunk_length_s: CHUNK_LENGTH_S,
        stride_length_s: STRIDE_LENGTH_S,
        language: language ?? 'sv',
        task: 'transcribe',
        streamer,
      });

      const chunks = (result as any).chunks as Array<{
        timestamp: [number, number];
        text: string;
      }>;
      const msg: WorkerResultMessage = { type: 'result', chunks: chunks ?? [] };
      postMessage(msg);
      self.close(); // release WASM heap immediately
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[octra:whisper-worker] failure', {
        stage: loadedModelId === modelId ? 'inference-or-postload' : 'load',
        modelId,
        device: useWebGPU ? 'webgpu' : 'wasm',
        dtype,
        language,
        error: message,
      });
      const msg: WorkerErrorMessage = { type: 'error', message };
      postMessage(msg);
      self.close();
    }
  },
);
