/**
 * Thread count for ONNX Runtime's WASM (CPU) backend.
 *
 * Left alone, ONNX Runtime uses min(4, ceil(cores / 2)) threads, so a
 * 24-core machine runs local transcription on 4 of them. We use every
 * logical core but RESERVED_LOGICAL_CORES, which stay free for the page,
 * audio playback and the rest of the machine, up to MAX_ORT_THREADS.
 *
 * Threads need SharedArrayBuffer, i.e. a cross-origin isolated page
 * (COOP + COEP). Without it, as inside an iframe on a page that is not
 * isolated itself, ONNX Runtime can only run one thread.
 *
 * The value must be set before the first model is loaded: ONNX Runtime
 * reads it once, when it initialises.
 */

/** Logical cores left free for the UI and the rest of the machine. */
export const RESERVED_LOGICAL_CORES = 2;

/** Upper bound; more threads pay off less and less. */
export const MAX_ORT_THREADS = 8;

/** `?threads=N` on the page URL overrides the computed count (benchmarking). */
export const THREADS_URL_PARAM = 'threads';

export function chooseOrtThreads(
  logicalCores: number | undefined,
  crossOriginIsolated: boolean,
  override?: number,
): number {
  if (!crossOriginIsolated) {
    return 1;
  }
  if (override !== undefined && Number.isInteger(override) && override > 0) {
    return override;
  }
  const cores =
    logicalCores && Number.isFinite(logicalCores) && logicalCores > 0
      ? Math.floor(logicalCores)
      : 2;
  return Math.max(1, Math.min(MAX_ORT_THREADS, cores - RESERVED_LOGICAL_CORES));
}

/**
 * Reads `?threads=N` from the page URL (main thread only: a worker's
 * location is its script URL). Returns undefined when absent or invalid.
 */
export function ortThreadsOverrideFromUrl(
  search: string = globalThis.location?.search ?? '',
): number | undefined {
  const raw = new URLSearchParams(search).get(THREADS_URL_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  return n > 0 ? n : undefined;
}

/**
 * Sets ONNX Runtime's WASM thread count inside a worker and logs it.
 * `wasmEnv` is `env.backends.onnx.wasm` from @huggingface/transformers.
 */
export function configureOrtThreads(
  wasmEnv: { numThreads?: number } | undefined,
  label: string,
  override?: number,
): number {
  const isolated = !!globalThis.crossOriginIsolated;
  const logicalCores = globalThis.navigator?.hardwareConcurrency;
  const threads = chooseOrtThreads(logicalCores, isolated, override);
  if (wasmEnv) {
    wasmEnv.numThreads = threads;
  }
  console.info(`[tratt:${label}] ONNX Runtime CPU threads`, {
    threads,
    logicalCores,
    crossOriginIsolated: isolated,
    ...(override !== undefined ? { override } : {}),
  });
  return threads;
}

/** `{ numThreads }` for a worker message when `?threads=` is set, else `{}`. */
export function ortThreadsOverrideField(): { numThreads?: number } {
  const numThreads = ortThreadsOverrideFromUrl();
  return numThreads !== undefined ? { numThreads } : {};
}
