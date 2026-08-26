/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';
import { toModelLangCode } from './flores-codes';

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/assets/ort/';
}

export type ModelFamily = 'opus-mt' | 'm2m100';

export interface PlanStage {
  modelId: string;
  family: ModelFamily;
  srcLang: string;
  tgtLang: string;
}

export interface TranslationPlan {
  stages: PlanStage[];
}

export interface TranslationSegment {
  id: number;
  text: string;
}

export interface WorkerTranslateMessage {
  type: 'translate';
  plan: TranslationPlan;
  segments: TranslationSegment[];
  skipBrowserCache?: boolean;
}

export interface TWorkerDownloadProgressMessage {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface TWorkerModelInitMessage {
  type: 'model-init';
}

export interface TWorkerStartMessage {
  type: 'translate-start';
  total: number;
}

export interface TWorkerSegmentProgressMessage {
  type: 'segment-progress';
  index: number;
  total: number;
}

export interface TWorkerResultMessage {
  type: 'result';
  translated: TranslationSegment[];
}

export interface TWorkerErrorMessage {
  type: 'error';
  message: string;
}

export type TWorkerOutMessage =
  | TWorkerDownloadProgressMessage
  | TWorkerModelInitMessage
  | TWorkerStartMessage
  | TWorkerSegmentProgressMessage
  | TWorkerResultMessage
  | TWorkerErrorMessage;

function decodeWorkerError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'number') {
    try {
      const M = (
        self as unknown as {
          Module?: { getExceptionMessage?: (p: number) => unknown };
        }
      ).Module;
      const fn = M?.getExceptionMessage;
      if (typeof fn === 'function') {
        const r = fn(e);
        const txt = Array.isArray(r)
          ? r.filter(Boolean).join(': ')
          : String(r ?? '');
        if (txt) return `ORT WASM: ${txt}`;
      }
    } catch {
      // ignore
    }
    return `Translation engine crashed (code ${e}). Likely out-of-memory: model too large for the 32-bit WebAssembly heap (4 GB). Try a smaller model.`;
  }
  if (typeof e === 'object' && e !== null) {
    const obj = e as { message?: string; toString?: () => string };
    if (obj.message) return obj.message;
    try {
      return obj.toString?.() ?? JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

async function persistToCache(url: string, buf: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const resp = new Response(buf, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(buf.byteLength),
      },
    });
    await cache.put(new Request(url), resp);
  } catch {
    // ignore cache write failures
  }
}

async function isCachedInBrowser(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const hit = await cache.match(new Request(url));
    return !!hit;
  } catch {
    return false;
  }
}

async function isCacheAvailable(): Promise<boolean> {
  try {
    await caches.open('__probe__');
    return true;
  } catch {
    return false;
  }
}

const prefetchedBuffers = new Map<string, ArrayBuffer>();
let fetchOverrideInstalled = false;

function installFetchOverride(): void {
  if (fetchOverrideInstalled) return;
  fetchOverrideInstalled = true;
  const origFetch = self.fetch.bind(self);
  self.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const buf = prefetchedBuffers.get(url);
    if (buf) {
      return Promise.resolve(
        new Response(buf, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(buf.byteLength),
          },
        }),
      );
    }
    return origFetch(input, init);
  };
}

const PREFETCH_READ_TIMEOUT_MS = 15_000;
const PREFETCH_MAX_ATTEMPTS = 8;

async function prefetchOnnxFile(
  url: string,
  emit: (loaded: number, total: number) => void,
): Promise<void> {
  if (prefetchedBuffers.has(url)) return;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let total = 0;

  for (let attempt = 0; attempt < PREFETCH_MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const headers: Record<string, string> = {};
    if (loaded > 0) headers['Range'] = `bytes=${loaded}-`;
    let resp: Response;
    try {
      resp = await fetch(url, { headers, signal: ctrl.signal });
    } catch {
      continue;
    }
    if (!resp.ok && resp.status !== 206) {
      throw new Error(`prefetch ${url} status=${resp.status}`);
    }
    if (loaded > 0 && resp.status === 200) {
      chunks.length = 0;
      loaded = 0;
    }
    if (total === 0) {
      const cr = resp.headers.get('content-range');
      const cl = resp.headers.get('content-length');
      const m = cr?.match(/\/(\d+)$/);
      if (m) total = Number(m[1]);
      else if (cl) total = Number(cl);
    }
    if (!resp.body) throw new Error(`prefetch ${url} no body`);
    const reader = resp.body.getReader();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const readWithTimeout = (): Promise<ReadableStreamReadResult<Uint8Array>> =>
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          stalled = true;
          try {
            ctrl.abort();
          } catch {
            // ignore
          }
          reject(new Error('read-timeout'));
        }, PREFETCH_READ_TIMEOUT_MS);
        reader.read().then(
          (r) => {
            if (timer) clearTimeout(timer);
            resolve(r);
          },
          (e) => {
            if (timer) clearTimeout(timer);
            reject(e);
          },
        );
      });

    try {
      for (;;) {
        const { done, value } = await readWithTimeout();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          emit(loaded, total || loaded);
        }
      }
      const merged = new Uint8Array(loaded);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      prefetchedBuffers.set(url, merged.buffer);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (stalled || msg === 'read-timeout' || msg.includes('aborted')) {
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    `prefetch exceeded ${PREFETCH_MAX_ATTEMPTS} attempts at ${loaded}/${total} for ${url}`,
  );
}

const STAGE_DTYPE = 'q8';

function onnxFilesForStage(): string[] {
  // transformers.js dtype 'q8' → '*_quantized.onnx'
  return [
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ];
}

interface AggregateProgress {
  fileProgress: Map<string, { loaded: number; total: number }>;
  emit: (file: string) => void;
  initSignaled: { v: boolean };
}

function makeAggregateProgress(): AggregateProgress {
  const fileProgress = new Map<string, { loaded: number; total: number }>();
  const initSignaled = { v: false };
  const emit = (file: string) => {
    let totalLoaded = 0;
    let totalSize = 0;
    for (const fp of fileProgress.values()) {
      totalLoaded += fp.loaded;
      totalSize += fp.total;
    }
    const msg: TWorkerDownloadProgressMessage = {
      type: 'download-progress',
      loaded: totalLoaded,
      total: totalSize,
      file,
    };
    postMessage(msg);
  };
  return { fileProgress, emit, initSignaled };
}

async function downloadStageFiles(
  stage: PlanStage,
  agg: AggregateProgress,
  useCache: boolean,
): Promise<void> {
  const files = onnxFilesForStage();
  const urls = files.map(
    (rel) => `https://huggingface.co/${stage.modelId}/resolve/main/${rel}`,
  );
  const cacheHits = useCache
    ? await Promise.all(urls.map((u) => isCachedInBrowser(u)))
    : urls.map(() => false);
  if (cacheHits.every(Boolean)) {
    return;
  }
  installFetchOverride();
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const url = urls[i];
    const key = `${stage.modelId}::${rel}`;
    if (cacheHits[i]) {
      continue;
    }
    if (prefetchedBuffers.has(url)) continue;
    await prefetchOnnxFile(url, (loaded, total) => {
      agg.fileProgress.set(key, { loaded, total });
      agg.emit(key);
    });
    const buf = prefetchedBuffers.get(url);
    if (useCache && buf) {
      await persistToCache(url, buf.slice(0));
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStageTranslator(
  stage: PlanStage,
  agg: AggregateProgress,
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineFn = pipeline as any;
  const t0 = performance.now();
  try {
    const translator = await pipelineFn('translation', stage.modelId, {
      device: 'wasm',
      dtype: STAGE_DTYPE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (progress: any) => {
        if (agg.initSignaled.v) return;
        const file = `${stage.modelId}::${progress?.file ?? ''}`;
        if (progress?.status === 'progress' && progress.loaded !== undefined) {
          agg.fileProgress.set(file, {
            loaded: progress.loaded,
            total: progress.total ?? 0,
          });
          agg.emit(file);
        } else if (progress?.status === 'done' && progress.file) {
          const fp = agg.fileProgress.get(file);
          if (fp && fp.total > 0) {
            fp.loaded = fp.total;
            agg.emit(file);
          }
        }
      },
    });
    return translator;
  } catch (e) {
    const decoded = decodeWorkerError(e);
    console.error(
      `[translation.worker] pipeline(${stage.modelId}) threw elapsedMs=${Math.round(performance.now() - t0)} typeof=${typeof e} decoded=${decoded}`,
    );
    const errObj = e as Error | undefined;
    if (errObj?.stack) console.error(errObj.stack);
    throw new Error(decoded);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runStage(
  translator: any,
  stage: PlanStage,
  text: string,
): Promise<string> {
  const args =
    stage.family === 'm2m100'
      ? {
          src_lang: toModelLangCode(stage.modelId, stage.srcLang),
          tgt_lang: toModelLangCode(stage.modelId, stage.tgtLang),
        }
      : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await translator(text, args);
  const first = Array.isArray(out) ? out[0] : out;
  return first?.translation_text ?? first?.generated_text ?? '';
}

addEventListener(
  'message',
  async ({ data }: MessageEvent<WorkerTranslateMessage>) => {
    if (data.type !== 'translate') return;

    const { plan, segments, skipBrowserCache } = data;

    try {
      if (skipBrowserCache) {
        env.useBrowserCache = false;
      } else if (!(await isCacheAvailable())) {
        env.useBrowserCache = false;
      }

      if (!plan?.stages?.length) {
        throw new Error('Empty translation plan');
      }

      const useCache = !skipBrowserCache;
      const agg = makeAggregateProgress();

      // Phase 1: download files for all stages (sequential to avoid heap pressure)
      for (const stage of plan.stages) {
        await downloadStageFiles(stage, agg, useCache);
      }

      // Phase 2: build translators sequentially
      agg.initSignaled.v = true;
      postMessage({ type: 'model-init' } as TWorkerModelInitMessage);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const translators: any[] = [];
      for (const stage of plan.stages) {
        const tr = await loadStageTranslator(stage, agg);
        translators.push(tr);
      }
      prefetchedBuffers.clear();

      // Phase 3: translate segments through stages
      postMessage({
        type: 'translate-start',
        total: segments.length,
      } as TWorkerStartMessage);

      const translated: TranslationSegment[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let text = seg.text.trim();
        if (text) {
          for (let s = 0; s < plan.stages.length; s++) {
            text = await runStage(translators[s], plan.stages[s], text);
          }
        }
        translated.push({ id: seg.id, text });
        postMessage({
          type: 'segment-progress',
          index: i + 1,
          total: segments.length,
        } as TWorkerSegmentProgressMessage);
      }

      postMessage({ type: 'result', translated } as TWorkerResultMessage);
      self.close();
    } catch (err: unknown) {
      const message = decodeWorkerError(err);
      const errMsg: TWorkerErrorMessage = { type: 'error', message };
      postMessage(errMsg);
      self.close();
    }
  },
);
