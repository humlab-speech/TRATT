declare const window: Window & typeof globalThis;

export interface AudioBufferLike {
  sampleRate: number;
  length: number;
  duration: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

class AudioBufferLikeImpl implements AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  readonly numberOfChannels: number;
  private _channels: Float32Array[];

  constructor(channels: Float32Array[], sampleRate: number) {
    this._channels = channels;
    this.sampleRate = sampleRate;
    this.length = channels[0].length;
    this.duration = this.length / sampleRate;
    this.numberOfChannels = channels.length;
  }

  getChannelData(channel: number): Float32Array {
    return this._channels[channel];
  }
}

let libavInstance: any = null;
let libavFatInstance: any = null;

// ASF container (used by .wma/.asf) requires the fat WASM which includes the ASF demuxer.
const ASF_EXTENSIONS = new Set(['.wma', '.asf']);

async function getLibAV(): Promise<any> {
  if (libavInstance) return libavInstance;
  // Dynamic import of the libav ES module from deployed assets.
  // Using a variable to prevent esbuild from resolving the path at build time.
  // Worker mode (default) runs WASM in a background thread, keeping the main
  // thread responsive. The fat variant must use noworker:true due to a postMessage
  // incompatibility in its IIFE, but the default variant supports worker mode fine.
  const libavPath = new URL(
    '/assets/libav/libav-default.mjs',
    window.location.origin,
  ).href;
  const m = await import(
    /* webpackIgnore: true */ /* @vite-ignore */ libavPath as any
  );
  libavInstance = await m.LibAV();
  return libavInstance;
}

async function getLibAVFat(onStatus?: (msg: string) => void): Promise<any> {
  if (libavFatInstance) return libavFatInstance;
  // Fat variant includes ASF demuxer + WMA codecs (~30 MB, loaded lazily).
  // Use noworker mode (same as the default variant) so the factory runs on the
  // main thread. Worker mode hangs because the fat WASM mjs IIFE uses postMessage
  // in a way that is incompatible with module worker initialization.
  // The fat WASM mjs uses `global._scriptDir` (Node.js pattern) — polyfill
  // `global` before importing so the Emscripten error-recovery path succeeds.
  onStatus?.('Loading WMA decoder (~30 MB), please wait…');
  // Emscripten error-recovery path assigns `global._scriptDir` (Node.js pattern).
  // Polyfill `global` temporarily so that assignment doesn't throw; restore
  // afterwards so other code (e.g. ONNX Runtime) cannot misdetect Node.js.
  const hadGlobal = 'global' in globalThis;
  if (!hadGlobal) (globalThis as any).global = globalThis;
  try {
    const libavPath = new URL(
      '/assets/libav/libav-fat.mjs',
      window.location.origin,
    ).href;
    const wasmUrl = new URL(
      '/assets/libav/libav-6.0.0-nightly.29.f420ff.ffmpeg.6.1.1-fat.wasm.wasm',
      window.location.origin,
    ).href;
    const m = await import(
      /* webpackIgnore: true */ /* @vite-ignore */ libavPath as any
    );
    libavFatInstance = await m.default.LibAV({
      noworker: true,
      wasmurl: wasmUrl,
    });
  } finally {
    if (!hadGlobal) delete (globalThis as any).global;
  }
  return libavFatInstance;
}

export async function decodeWithLibAV(
  buf: ArrayBuffer,
  sourceFilename = 'input.audio',
  onStatus?: (msg: string) => void,
): Promise<AudioBufferLike> {
  const ext = sourceFilename.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
  const libav = ASF_EXTENSIONS.has(ext)
    ? await getLibAVFat(onStatus)
    : await getLibAV();

  // Use the original filename so libav can detect the container format by extension
  // (e.g. .wma → ASF demuxer) before falling back to content probing.
  // Strip any path component; keep only the basename.
  const filename = sourceFilename.replace(/.*[\\/]/, '') || 'input.audio';
  console.time('[libav] total');
  console.time('[libav] writeFile');
  await libav.writeFile(filename, new Uint8Array(buf));
  console.timeEnd('[libav] writeFile');

  let fmt_ctx: any;
  let c: any, pkt: any, frame: any;
  try {
    onStatus?.('Probing container…');
    console.time('[libav] demux');
    const [_fmt_ctx, streams] = await libav.ff_init_demuxer_file(filename);
    console.timeEnd('[libav] demux');
    fmt_ctx = _fmt_ctx;

    const audioStream = streams.find(
      (s: any) => s.codec_type === libav.AVMEDIA_TYPE_AUDIO,
    );
    if (!audioStream) {
      throw new Error('No audio stream found in file.');
    }

    // Discard all non-audio streams so ff_read_multi skips video packets entirely,
    // preventing H.264/video data from being loaded into WASM memory.
    for (const s of streams) {
      if (s.codec_type !== libav.AVMEDIA_TYPE_AUDIO) {
        const streamPtr = await libav.AVFormatContext_streams_a(
          fmt_ctx,
          s.index,
        );
        await libav.AVStream_discard_s(streamPtr, 48 /* AVDISCARD_ALL */);
      }
    }

    const [, _c, _pkt, _frame] = await libav.ff_init_decoder(
      audioStream.codec_id,
      audioStream.codecpar,
    );
    c = _c;
    pkt = _pkt;
    frame = _frame;

    onStatus?.('Reading audio packets…');
    console.time('[libav] readFrames');
    const [, allPackets] = await libav.ff_read_frame_multi(fmt_ctx, pkt, {
      limit: 64 * 1024 * 1024,
    });
    console.timeEnd('[libav] readFrames');
    const packets = allPackets[audioStream.index] || [];

    onStatus?.('Decoding audio frames…');
    console.time('[libav] decode');
    const frames = await libav.ff_decode_multi(c, pkt, frame, packets, true);
    console.timeEnd('[libav] decode');

    if (!frames || frames.length === 0) {
      throw new Error('libav.js: no audio frames decoded.');
    }

    const sampleRate = frames[0].sample_rate;
    const numChannels =
      frames[0].channels || frames[0].ch_layout_nb_channels || 1;
    const sampleFormat = frames[0].format;

    let totalSamples = 0;
    for (const f of frames) totalSamples += f.nb_samples;

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++)
      channels.push(new Float32Array(totalSamples));

    let offset = 0;
    for (const f of frames) {
      const nb = f.nb_samples;
      if (isPlanar(sampleFormat)) {
        for (let ch = 0; ch < numChannels; ch++) {
          const src = toFloat32(f.data[ch], sampleFormat);
          channels[ch].set(src, offset);
        }
      } else {
        const src = toFloat32(f.data, sampleFormat);
        for (let i = 0; i < nb; i++) {
          for (let ch = 0; ch < numChannels; ch++) {
            channels[ch][offset + i] = src[i * numChannels + ch];
          }
        }
      }
      offset += nb;
    }

    console.timeEnd('[libav] total');
    return new AudioBufferLikeImpl(channels, sampleRate);
  } finally {
    // Always free resources, even on error, to prevent WASM memory leaks.
    try {
      if (c !== undefined && pkt !== undefined && frame !== undefined)
        await libav.ff_free_decoder(c, pkt, frame);
    } catch (_) {}
    try {
      if (fmt_ctx !== undefined) await libav.avformat_close_input_js(fmt_ctx);
    } catch (_) {}
    try {
      await libav.unlink(filename);
    } catch (_) {}
  }
}

function isPlanar(fmt: number): boolean {
  // AV_SAMPLE_FMT_*P formats: U8P=6, S16P=7, S32P=8, FLTP=9, DBLP=10, S64P=12
  return (fmt >= 6 && fmt <= 10) || fmt === 12;
}

function toFloat32(data: any, fmt: number): Float32Array {
  if (data instanceof Float32Array) return data;
  if (data instanceof Float64Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }
  if (data instanceof Int16Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / 32768;
    return out;
  }
  if (data instanceof Int32Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / 2147483648;
    return out;
  }
  if (data instanceof Uint8Array) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = (data[i] - 128) / 128;
    return out;
  }
  return new Float32Array(data);
}
