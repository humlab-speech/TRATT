// Re-encodes an attached recording for export: audio becomes 32 kbps mono
// Opus in Ogg; video becomes mp4 with the video stream copied (no re-encode)
// and the audio re-encoded the same way. A file of a video type without a
// video stream (a MediaRecorder .webm, say) is audio. Mono Ogg Opus already at
// about 32 kbps is exported as it is. Runs on the libav.js builds shipped in
// assets/libav. The default build (a worker) has libopus and the Ogg muxer
// but reads only wav, flac and Ogg/WebM Opus, and has no mp4 muxer; the fat
// build (~30 MB, main thread) does the rest: video, ASF, and audio the default
// build cannot open (mp3, m4a, aac, aiff…).
//
// The two builds are different libav.js versions (6.8 and 6.0): only 6.8
// rescales timestamps itself, so every frame and packet gets explicit
// timestamps here, in a time base we know.

import { getLibAV, getLibAVFat } from '@tratt/web-media';
import { exportedMediaName, isVideoName, OPUS_BITRATE } from './exported-media';

// ponytail: the whole file is copied into libav's MEMFS, which lives in JS
// memory (the worker's, for the default build) next to the source and the
// output; stream via mkreadaheadfile if bigger files matter. Video gets less:
// its mp4 is about as large as its source, and the fat build runs on the
// main thread.
export const MAX_TRANSCODE_BYTES = 1.5 * 2 ** 30;
export const MAX_VIDEO_TRANSCODE_BYTES = 512 * 2 ** 20;

// Mono Ogg Opus at up to this rate (Tratt's own export, by and large) is
// exported as it is: re-encoding it would only lose quality.
const PASS_THROUGH_MAX_BITRATE = 36_000;
const AV_CODEC_ID_OPUS = 86076;
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

const OPUS_RATE = 48_000;
const OPUS_TB: Rational = [1, OPUS_RATE];
const AV_CH_LAYOUT_MONO = 4;
// aformat also downmixes stereo. libopus needs fixed 20 ms frames, but the
// default build has no asetnsamples filter: the buffer sink cuts them instead
// (frame_size; the last frame may be shorter, which libopus accepts).
// The string must parse on both builds: a parse failure hangs libav.js 6.8.
const AUDIO_FILTER =
  'aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono';
const OPUS_FRAME_SAMPLES = 960;
// Input read per step: about a minute, within these bounds. Compressed audio
// decodes to 10-100 times its size, and on the fat build each step blocks
// the tab until it is done.
const MIN_READ_BYTES = 64 * 2 ** 10;
const MAX_READ_BYTES = 2 ** 20;
const UNKNOWN_LENGTH_READ_BYTES = 256 * 2 ** 10;
const AVERROR_EAGAIN = -6;
const AVDISCARD_ALL = 48;
const ASF_NAME = /\.(wma|asf)$/i;
const WEBM_NAME = /\.webm$/i;

type Rational = [number, number];

let tempCounter = 0;

// The default build cannot do this one: it could not demux or decode the
// input (as opposed to the input having no audio, or a later failure), or the
// input has video, for which it has no mp4 muxer.
class NeedsFatBuild extends Error {}

/** What `transcode` made: no data when the source is exported as it is. */
interface Transcoded {
  data?: Uint8Array<ArrayBuffer>;
  video: boolean;
}

export async function transcodeForExport(source: File): Promise<File> {
  const videoName = isVideoName(source.name);
  const limit = videoName ? MAX_VIDEO_TRANSCODE_BYTES : MAX_TRANSCODE_BYTES;
  if (source.size > limit) {
    throw new Error(
      `Could not transcode ${source.name}: too large (${source.size} bytes; the limit is ${limit})`,
    );
  }
  const ext = source.name.match(/\.[^.]+$/)?.[0] ?? '';
  try {
    const bytes = new Uint8Array(await source.arrayBuffer());
    const run = async (libav: any, fat: boolean) =>
      transcode(libav, bytes, `export-${++tempCounter}`, ext, {
        videoName,
        fat,
      });
    let out: Transcoded;
    // WebM may be audio alone, which the default build reads.
    if (ASF_NAME.test(source.name) || (videoName && !WEBM_NAME.test(ext))) {
      out = await run(await getLibAVFat(), true);
    } else {
      try {
        out = await run(await getLibAV(), false);
      } catch (e) {
        if (!(e instanceof NeedsFatBuild)) throw e;
        out = await run(await getLibAVFat(), true);
      }
    }
    if (!out.data) {
      return source.type === 'audio/ogg'
        ? source
        : new File([source], source.name, { type: 'audio/ogg' });
    }
    return new File([out.data], exportedMediaName(source.name, out.video), {
      type: out.video ? 'video/mp4' : 'audio/ogg',
    });
  } catch (e) {
    throw new Error(`Could not transcode ${source.name}: ${reason(e)}`);
  }
}

function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof RangeError ||
    /out of memory|OOM|enlarge memory|allocation failed/i.test(msg)
    ? `out of memory (${msg})`
    : msg;
}

async function fatBuildOnError(f: () => Promise<any>): Promise<any> {
  try {
    return await f();
  } catch (e) {
    throw new NeedsFatBuild(reason(e));
  }
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

async function transcode(
  libav: any,
  bytes: Uint8Array,
  tempName: string,
  ext: string,
  // fat: the fat build, which writes mp4 and runs on the main thread.
  opts: { videoName: boolean; fat: boolean },
): Promise<Transcoded> {
  const inName = `${tempName}-in${ext}`;
  let outName: string | undefined;
  let fmtCtx: any, dec: any[] | undefined, enc: any[] | undefined;
  let audioPar: any, mux: any[] | undefined, graph: any, filterFrame: any;

  try {
    await libav.writeFile(inName, bytes);
    const [_fmtCtx, streams] = await fatBuildOnError(() =>
      libav.ff_init_demuxer_file(inName),
    );
    fmtCtx = _fmtCtx;
    const audio = streams.find(
      (s: any) => s.codec_type === libav.AVMEDIA_TYPE_AUDIO,
    );
    if (!audio) throw new Error('no audio stream');
    // Only a video file's video is kept: an audio file's cover art is not.
    const vid = opts.videoName
      ? streams.find((s: any) => s.codec_type === libav.AVMEDIA_TYPE_VIDEO)
      : undefined;
    if (vid && !opts.fat) {
      throw new NeedsFatBuild('only the fat build writes mp4');
    }
    if (!vid && (await isLeanOpus(libav, audio, bytes))) {
      return { video: false };
    }
    const format = vid ? 'mp4' : 'ogg';
    outName = `${tempName}-out.${vid ? 'mp4' : 'opus'}`;
    // Drop everything else (subtitles, cover art, extra tracks) at read time.
    for (const s of streams) {
      if (s === audio || s === vid) continue;
      const st = await libav.AVFormatContext_streams_a(fmtCtx, s.index);
      await libav.AVStream_discard_s(st, AVDISCARD_ALL);
    }

    const [, dc, dpkt, dframe] = await fatBuildOnError(() =>
      libav.ff_init_decoder(audio.codec_id, audio.codecpar),
    );
    dec = [dc, dpkt, dframe];
    const [, ec, eframe, epkt] = await libav.ff_init_encoder('libopus', {
      ctx: {
        bit_rate: OPUS_BITRATE,
        sample_fmt: libav.AV_SAMPLE_FMT_FLT,
        sample_rate: OPUS_RATE,
        channel_layout: AV_CH_LAYOUT_MONO,
      },
      time_base: OPUS_TB,
    });
    enc = [ec, eframe, epkt];
    audioPar = await libav.avcodec_parameters_alloc();
    await libav.avcodec_parameters_from_context(audioPar, ec);

    // Output streams: video (copied codec parameters) first, then Opus.
    const inTbs: Rational[] = [];
    const muxStreams: any[] = [];
    if (vid) {
      inTbs.push([vid.time_base_num, vid.time_base_den]);
      muxStreams.push([vid.codecpar, vid.time_base_num, vid.time_base_den]);
    }
    inTbs.push(OPUS_TB);
    muxStreams.push([audioPar, ...OPUS_TB]);
    const audioOut = muxStreams.length - 1;
    const outTbs: Rational[] = [];
    try {
      const [oc, , pb, sts] = await libav.ff_init_muxer(
        { format_name: format, filename: outName, open: true, codecpars: true },
        muxStreams,
      );
      mux = [oc, pb];
      const ret = await libav.avformat_write_header(oc, 0);
      if (ret < 0) throw new Error(await libav.ff_error(ret));
      // The muxer may pick its own stream time bases in write_header.
      for (const st of sts) {
        outTbs.push([
          await libav.AVStream_time_base_num(st),
          await libav.AVStream_time_base_den(st),
        ]);
      }
    } catch (e) {
      throw new Error(`${format} muxer refused the streams: ${reason(e)}`);
    }
    const [oc] = mux;

    let inSamples = 0;
    let outSamples = 0;
    let startPts: number | undefined;
    let src: any, sink: any;
    const limit = readBytes(bytes.length, streams);
    for (;;) {
      const [ret, byStream] = await libav.ff_read_frame_multi(fmtCtx, dpkt, {
        limit,
      });
      const eof = ret === libav.AVERROR_EOF;
      if (!eof && ret !== AVERROR_EAGAIN && ret < 0) {
        throw new Error(await libav.ff_error(ret));
      }

      const frames: any[] = await libav.ff_decode_multi(
        dc,
        dpkt,
        dframe,
        byStream[audio.index] ?? [],
        eof,
      );
      for (const f of frames) {
        if (startPts === undefined) startPts = vid ? audioStart(f, audio) : 0;
        f.channel_layout ||= defaultLayout(f.channels);
        f.pts = inSamples;
        f.ptshi = 0;
        f.time_base_num = 1;
        f.time_base_den = f.sample_rate;
        inSamples += f.nb_samples;
      }
      if (!graph && frames.length) {
        const f = frames[0];
        [graph, src, sink] = await libav.ff_init_filter_graph(
          AUDIO_FILTER,
          {
            sample_rate: f.sample_rate,
            sample_fmt: f.format,
            channel_layout: f.channel_layout,
            time_base: [1, f.sample_rate],
          },
          {
            sample_rate: OPUS_RATE,
            sample_fmt: libav.AV_SAMPLE_FMT_FLT,
            channel_layout: AV_CH_LAYOUT_MONO,
            frame_size: OPUS_FRAME_SAMPLES,
          },
        );
        filterFrame = await libav.av_frame_alloc();
      }

      const packets: any[] = [];
      if (graph && (frames.length || eof)) {
        const filtered: any[] = await libav.ff_filter_multi(
          src,
          sink,
          filterFrame,
          frames,
          eof,
        );
        for (const f of filtered) {
          [f.pts, f.ptshi] = toI64((startPts ?? 0) + outSamples);
          f.time_base_num = OPUS_TB[0];
          f.time_base_den = OPUS_TB[1];
          outSamples += f.nb_samples;
        }
        for (const p of await libav.ff_encode_multi(
          ec,
          eframe,
          epkt,
          filtered,
          eof,
        )) {
          packets.push(retime(p, audioOut, OPUS_TB, outTbs[audioOut]));
        }
      }
      if (vid) {
        for (const p of byStream[vid.index] ?? []) {
          packets.push(retime(p, 0, inTbs[0], outTbs[0]));
        }
      }
      if (packets.length) await libav.ff_write_multi(oc, epkt, packets);
      if (eof) break;
      // The fat build runs on the main thread: let the tab breathe.
      if (opts.fat) await nextTask();
    }
    if (outSamples === 0) throw new Error('no audio could be decoded');

    const trailer = await libav.av_write_trailer(oc);
    if (trailer < 0) {
      throw new Error(
        `could not finish the ${format} file: ${await libav.ff_error(trailer)}`,
      );
    }
    // Closing the muxer flushes the output file.
    await libav.ff_free_muxer(...mux);
    mux = undefined;
    return { data: await libav.readFile(outName), video: !!vid };
  } finally {
    const release = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch {
        // already failing or already freed; nothing more to do
      }
    };
    if (mux) await release(() => libav.ff_free_muxer(...mux!));
    if (audioPar)
      await release(() => libav.avcodec_parameters_free_js(audioPar));
    if (graph) await release(() => libav.avfilter_graph_free_js(graph));
    if (filterFrame) await release(() => libav.av_frame_free_js(filterFrame));
    if (enc) await release(() => libav.ff_free_encoder(...enc!));
    if (dec) await release(() => libav.ff_free_decoder(...dec!));
    if (fmtCtx !== undefined)
      await release(() => libav.avformat_close_input_js(fmtCtx));
    await release(() => libav.unlink(inName));
    const written = outName;
    if (written) await release(() => libav.unlink(written));
  }
}

// Mono Opus in Ogg at up to PASS_THROUGH_MAX_BITRATE, container included.
async function isLeanOpus(
  libav: any,
  audio: any,
  bytes: Uint8Array,
): Promise<boolean> {
  if (
    audio.codec_id !== AV_CODEC_ID_OPUS ||
    OGG_MAGIC.some((b, i) => bytes[i] !== b) ||
    !(audio.duration > 0)
  ) {
    return false;
  }
  const channels = await libav.AVCodecParameters_ch_layout_nb_channels(
    audio.codecpar,
  );
  return (
    channels === 1 &&
    (bytes.length * 8) / audio.duration <= PASS_THROUGH_MAX_BITRATE
  );
}

// About a minute of input (see MAX_READ_BYTES). A stream of unknown length
// reports a negative duration.
function readBytes(size: number, streams: any[]): number {
  const seconds = Math.max(0, ...streams.map((s: any) => s.duration || 0));
  if (!(seconds > 0) || !Number.isFinite(seconds)) {
    return UNKNOWN_LENGTH_READ_BYTES;
  }
  const minute = Math.round((size / seconds) * 60);
  return Math.min(MAX_READ_BYTES, Math.max(MIN_READ_BYTES, minute));
}

// Where the audio starts, in 1/48000 s, so a copied video stays in sync.
function audioStart(frame: any, stream: any): number {
  const pts = fromI64(frame.pts, frame.ptshi);
  if (pts === null) return 0;
  const [num, den] = frame.time_base_num
    ? [frame.time_base_num, frame.time_base_den]
    : [stream.time_base_num, stream.time_base_den];
  return Math.round((pts * num * OPUS_RATE) / den);
}

function defaultLayout(channels: number): number {
  if (channels === 1) return AV_CH_LAYOUT_MONO;
  if (channels === 2) return 3; // FL|FR
  return 2 ** channels - 1;
}

// A packet re-targeted to output stream `index`, with timestamps rescaled from
// `from` to `to`. The payload is shared, not copied.
function retime(p: any, index: number, from: Rational, to: Rational): any {
  const out = {
    ...p,
    stream_index: index,
    time_base_num: to[0],
    time_base_den: to[1],
  };
  for (const [lo, hi] of [
    ['pts', 'ptshi'],
    ['dts', 'dtshi'],
    ['duration', 'durationhi'],
  ]) {
    const v = fromI64(p[lo], p[hi]);
    if (v !== null) [out[lo], out[hi]] = toI64(rescale(v, from, to));
  }
  return out;
}

function rescale(v: number, from: Rational, to: Rational): number {
  if (from[0] === to[0] && from[1] === to[1]) return v;
  return Math.round((v * from[0] * to[1]) / (from[1] * to[0]));
}

const TWO_32 = 2 ** 32;

// libav.js splits int64 into a signed low word and a high word. Returns null
// for AV_NOPTS_VALUE (and for absent fields).
function fromI64(
  lo: number | undefined,
  hi: number | undefined,
): number | null {
  if (lo === undefined) return null;
  hi ??= 0;
  if (hi === -0x80000000 && lo === 0) return null;
  return hi * TWO_32 + (lo >>> 0);
}

function toI64(v: number): [number, number] {
  const hi = Math.floor(v / TWO_32);
  return [(v - hi * TWO_32) | 0, hi];
}
