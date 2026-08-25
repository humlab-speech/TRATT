/// <reference lib="webworker" />

import {
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  env,
} from '@huggingface/transformers';
import { ML_MODEL_SAMPLE_RATE } from '@tratt/web-media';
import { normalizePyannoteSpeakerTurns } from '../shared/service/local-diarization-postprocess';
import { DiarizationDType } from '../shared/service/local-diarization-runtime.service';
import { SpeakerTurn } from '../shared/service/local-diarization.service';

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

export interface WorkerDiarizeMessage {
  type: 'diarize';
  modelId: string;
  audio: Float32Array;
  useWebGPU: boolean;
  audioDurationS: number;
  dtype?: DiarizationDType;
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
  mergeGapS?: number;
  minTurnS?: number;
  minConfidence?: number;
}

export interface WorkerDiarizationDownloadProgressMessage {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface WorkerDiarizeStartMessage {
  type: 'diarize-start';
  audioDurationS: number;
}

export interface WorkerDiarizationResultMessage {
  type: 'result';
  turns: SpeakerTurn[];
}

export interface WorkerDiarizationErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerDiarizationOutMessage =
  | WorkerDiarizationDownloadProgressMessage
  | WorkerDiarizeStartMessage
  | WorkerDiarizationResultMessage
  | WorkerDiarizationErrorMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadedProcessor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadedModel: any = null;
let loadedModelId: string | null = null;

addEventListener(
  'message',
  async ({ data }: MessageEvent<WorkerDiarizeMessage>) => {
    if (data.type !== 'diarize') {
      return;
    }

    const {
      modelId,
      audio,
      useWebGPU,
      audioDurationS,
      dtype,
      numSpeakers,
      minSpeakers,
      maxSpeakers,
      mergeGapS,
      minTurnS,
      minConfidence,
    } = data;

    try {
      if (!(await isCacheAvailable())) {
        env.useBrowserCache = false;
      }

      if (!loadedModel || !loadedProcessor || loadedModelId !== modelId) {
        loadedModel = null;
        loadedProcessor = null;
        loadedModelId = null;

        const fileProgress = new Map<
          string,
          { loaded: number; total: number }
        >();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const progress_callback = (progress: any) => {
          if (
            progress?.status !== 'progress' ||
            progress.loaded === undefined
          ) {
            return;
          }

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

          const msg: WorkerDiarizationDownloadProgressMessage = {
            type: 'download-progress',
            loaded: totalLoaded,
            total: totalSize,
            file: progress.file ?? '',
          };
          postMessage(msg);
        };

        loadedProcessor = await AutoProcessor.from_pretrained(modelId, {
          progress_callback,
        });
        loadedModel =
          await AutoModelForAudioFrameClassification.from_pretrained(modelId, {
            device: useWebGPU ? 'webgpu' : 'wasm',
            ...(dtype ? { dtype } : {}),
            progress_callback,
          });
        loadedModelId = modelId;
      }

      const startMsg: WorkerDiarizeStartMessage = {
        type: 'diarize-start',
        audioDurationS,
      };
      postMessage(startMsg);

      const WINDOW_SAMPLES = Math.round(10 * ML_MODEL_SAMPLE_RATE);
      const STRIDE_SAMPLES = Math.round(2.5 * ML_MODEL_SAMPLE_RATE);

      const allRawSegments: Array<{
        id: number;
        start: number;
        end: number;
        confidence?: number;
      }> = [];
      let chunkStart = 0;
      let chunkIndex = 0;

      while (chunkStart < audio.length) {
        const chunkEnd = Math.min(chunkStart + WINDOW_SAMPLES, audio.length);
        const chunk = audio.slice(chunkStart, chunkEnd);
        const chunkStartS = chunkStart / ML_MODEL_SAMPLE_RATE;

        const inputs = await loadedProcessor(chunk);
        const { logits } = await loadedModel(inputs);
        const chunkDiarization =
          loadedProcessor.post_process_speaker_diarization(
            logits,
            chunk.length,
          ) as Array<
            Array<{
              id: number;
              start: number;
              end: number;
              confidence?: number;
            }>
          >;

        console.info(`[octra:pyannote-worker] chunk ${chunkIndex}`, {
          chunkStartS,
          chunkEndS: chunkEnd / ML_MODEL_SAMPLE_RATE,
          rawSegments: chunkDiarization[0]?.length ?? 0,
        });

        for (const seg of chunkDiarization[0] ?? []) {
          allRawSegments.push({
            ...seg,
            start: seg.start + chunkStartS,
            end: seg.end + chunkStartS,
          });
        }

        chunkStart += STRIDE_SAMPLES;
        chunkIndex++;
      }

      const rawSegments = allRawSegments;
      const uniqueRawIds = [...new Set(rawSegments.map((s) => s.id))];
      console.info('[octra:pyannote-worker] raw model output', {
        totalRawSegments: rawSegments.length,
        uniqueRawSpeakerIds: uniqueRawIds,
        first10Segments: rawSegments.slice(0, 10),
        audioDurationS,
      });

      const turns = normalizePyannoteSpeakerTurns(rawSegments, {
        mergeGapS,
        minTurnS,
        minConfidence,
      });

      console.info('[octra:pyannote-worker] normalized turns', {
        totalTurns: turns.length,
        uniqueSpeakers: [...new Set(turns.map((t) => t.speakerId))],
        first10Turns: turns.slice(0, 10),
      });
      const resultMsg: WorkerDiarizationResultMessage = {
        type: 'result',
        turns,
      };
      postMessage(resultMsg);
      self.close();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const errMsg: WorkerDiarizationErrorMessage = { type: 'error', message };
      postMessage(errMsg);
      self.close();
    }
  },
);
