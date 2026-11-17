jest.mock('@tratt/web-media', () => ({
  getLibAV: jest.fn(),
  getLibAVFat: jest.fn(),
}));

import { getLibAV, getLibAVFat } from '@tratt/web-media';
import { MAX_TRANSCODE_BYTES, transcodeForExport } from './media-transcode';

const AUDIO = 1;
const VIDEO = 0;
const EOF = -541478725;

// The calls transcodeForExport makes on a libav.js instance, faked: one read
// returns every packet, the decoder/filter/encoder map packets to frames 1:1.
function fakeLibAV(opts: {
  streams: any[];
  packets: Record<number, any[]>;
  outTimeBases?: number[];
  headerRet?: number;
}) {
  const outTb = opts.outTimeBases ?? [48000];
  return {
    AVMEDIA_TYPE_AUDIO: AUDIO,
    AVMEDIA_TYPE_VIDEO: VIDEO,
    AV_SAMPLE_FMT_FLT: 3,
    AVERROR_EOF: EOF,
    writeFile: jest.fn(async () => undefined),
    readFile: jest.fn(async () => new Uint8Array([1, 2, 3, 4])),
    unlink: jest.fn(async () => undefined),
    ff_init_demuxer_file: jest.fn(async () => [100, opts.streams]),
    AVFormatContext_streams_a: jest.fn(
      async (_c: number, i: number) => 1000 + i,
    ),
    AVStream_discard_s: jest.fn(async () => undefined),
    avformat_close_input_js: jest.fn(async () => undefined),
    ff_init_decoder: jest.fn(async () => [1, 200, 201, 202]),
    ff_free_decoder: jest.fn(async () => undefined),
    ff_read_frame_multi: jest.fn(async () => [EOF, opts.packets]),
    ff_decode_multi: jest.fn(
      async (_c: number, _p: number, _f: number, pkts: any[]) =>
        pkts.map(() => ({
          format: 1,
          sample_rate: 44100,
          channels: 2,
          channel_layout: 0, // as libav.js reports for WAV
          nb_samples: 1024,
          data: new Int16Array(2048),
          pts: 0,
          ptshi: 0,
        })),
    ),
    av_frame_alloc: jest.fn(async () => 300),
    av_frame_free_js: jest.fn(async () => undefined),
    ff_init_filter_graph: jest.fn(async () => [400, 401, 402]),
    ff_filter_multi: jest.fn(
      async (_s: number, _k: number, _f: number, frames: any[]) =>
        frames.map(() => ({
          format: 3,
          sample_rate: 48000,
          channels: 1,
          channel_layout: 4,
          nb_samples: 960,
          data: new Float32Array(960),
          pts: 0,
          ptshi: 0,
        })),
    ),
    avfilter_graph_free_js: jest.fn(async () => undefined),
    ff_init_encoder: jest.fn(async () => [2, 500, 501, 502, 960]),
    ff_encode_multi: jest.fn(
      async (_c: number, _f: number, _p: number, frames: any[]) =>
        frames.map((f: any) => ({
          data: new Uint8Array([9]),
          pts: f.pts,
          ptshi: f.ptshi,
          dts: f.pts,
          dtshi: f.ptshi,
          duration: 960,
          durationhi: 0,
          stream_index: 0,
          flags: 0,
        })),
    ),
    ff_free_encoder: jest.fn(async () => undefined),
    avcodec_parameters_alloc: jest.fn(async () => 600),
    avcodec_parameters_from_context: jest.fn(async () => 0),
    avcodec_parameters_free_js: jest.fn(async () => undefined),
    ff_init_muxer: jest.fn(async (_o: any, sts: any[]) => [
      700,
      701,
      702,
      sts.map((_s: any, i: number) => 800 + i),
    ]),
    avformat_write_header: jest.fn(async () => opts.headerRet ?? 0),
    AVStream_time_base_num: jest.fn(async () => 1),
    AVStream_time_base_den: jest.fn(async (st: number) => outTb[st - 800]),
    ff_write_multi: jest.fn(async () => undefined),
    av_write_trailer: jest.fn(async () => 0),
    ff_free_muxer: jest.fn(async () => undefined),
    ff_error: jest.fn(async (ret: number) => `error ${ret}`),
  };
}

const audioStream = {
  index: 0,
  codec_type: AUDIO,
  codec_id: 65536,
  codecpar: 900,
  time_base_num: 1,
  time_base_den: 44100,
};

function file(name: string): File {
  // jsdom's File has no arrayBuffer().
  return Object.assign(new File([new Uint8Array([1, 2, 3])], name), {
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
}

function written(la: ReturnType<typeof fakeLibAV>): any[] {
  return la.ff_write_multi.mock.calls.flatMap((c: any[]) => c[2]);
}

describe('transcodeForExport', () => {
  beforeEach(() => jest.resetAllMocks());

  it('encodes audio to 32 kbps mono Opus in Ogg with the default libav build', async () => {
    const la = fakeLibAV({
      streams: [audioStream],
      packets: {
        0: [{ data: new Uint8Array(8) }, { data: new Uint8Array(8) }],
      },
    });
    (getLibAV as jest.Mock).mockResolvedValue(la);

    const out = await transcodeForExport(file('Intervju 1.WAV'));

    expect(out.name).toBe('Intervju 1.opus');
    expect(out.type).toBe('audio/ogg');
    expect(out.size).toBe(4);
    expect(getLibAVFat).not.toHaveBeenCalled();
    expect(la.ff_init_filter_graph).toHaveBeenCalledWith(
      // The default build has no asetnsamples filter: the sink cuts the
      // fixed 20 ms frames libopus needs (frame_size).
      'aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono',
      expect.objectContaining({
        sample_rate: 44100,
        sample_fmt: 1,
        channel_layout: 3,
      }),
      expect.objectContaining({
        sample_rate: 48000,
        sample_fmt: 3,
        channel_layout: 4,
        frame_size: 960,
      }),
    );
    expect(la.ff_init_encoder).toHaveBeenCalledWith('libopus', {
      ctx: {
        bit_rate: 32000,
        sample_fmt: 3,
        sample_rate: 48000,
        channel_layout: 4,
      },
      time_base: [1, 48000],
    });
    expect(la.ff_init_muxer).toHaveBeenCalledWith(
      expect.objectContaining({
        format_name: 'ogg',
        open: true,
        codecpars: true,
      }),
      [[600, 1, 48000]],
    );
    // Encoder input carries sample-count timestamps; packets go to stream 0.
    const encFrames = la.ff_encode_multi.mock.calls.flatMap((c: any[]) => c[3]);
    expect(encFrames.map((f: any) => f.pts)).toEqual([0, 960]);
    expect(written(la).map((p: any) => [p.stream_index, p.pts])).toEqual([
      [0, 0],
      [0, 960],
    ]);
    expect(la.av_write_trailer).toHaveBeenCalledWith(700);
    // Temp files and contexts released.
    const [inName] = la.writeFile.mock.calls[0] as unknown as [string];
    const outName = (la.ff_init_muxer.mock.calls[0] as any[])[0].filename;
    expect(la.unlink).toHaveBeenCalledWith(inName);
    expect(la.unlink).toHaveBeenCalledWith(outName);
    expect(la.ff_free_muxer).toHaveBeenCalledWith(700, 702);
    expect(la.ff_free_encoder).toHaveBeenCalledWith(500, 501, 502);
    expect(la.ff_free_decoder).toHaveBeenCalledWith(200, 201, 202);
    expect(la.avformat_close_input_js).toHaveBeenCalledWith(100);
  });

  it('retries audio on the fat build when the default build cannot read it', async () => {
    // The default build only demuxes wav, flac and Ogg/WebM Opus; mp3, m4a,
    // aac and aiff need the fat one.
    const small = fakeLibAV({ streams: [audioStream], packets: {} });
    small.ff_init_demuxer_file.mockRejectedValue(
      new Error('Could not open source file'),
    );
    const fat = fakeLibAV({
      streams: [audioStream],
      packets: { 0: [{ data: new Uint8Array(8) }] },
    });
    (getLibAV as jest.Mock).mockResolvedValue(small);
    (getLibAVFat as jest.Mock).mockResolvedValue(fat);

    const out = await transcodeForExport(file('song.mp3'));

    expect(out.name).toBe('song.opus');
    expect(fat.ff_init_muxer).toHaveBeenCalledWith(
      expect.objectContaining({ format_name: 'ogg' }),
      [[600, 1, 48000]],
    );
    const [smallIn] = small.writeFile.mock.calls[0] as unknown as [string];
    expect(small.unlink).toHaveBeenCalledWith(smallIn);
  });

  it('does not retry on the fat build when the audio has no audio stream', async () => {
    const small = fakeLibAV({ streams: [], packets: {} });
    (getLibAV as jest.Mock).mockResolvedValue(small);

    await expect(transcodeForExport(file('x.wav'))).rejects.toThrow(
      /no audio stream/i,
    );
    expect(getLibAVFat).not.toHaveBeenCalled();
  });

  it('copies video packets into mp4 and re-encodes the audio, using the fat build', async () => {
    const videoPacket = {
      data: new Uint8Array([7, 7, 7]),
      pts: 3000,
      ptshi: 0,
      dts: 0,
      dtshi: 0,
      duration: 3000,
      durationhi: 0,
      stream_index: 0,
      flags: 1,
    };
    const la = fakeLibAV({
      streams: [
        {
          index: 0,
          codec_type: VIDEO,
          codec_id: 27,
          codecpar: 901,
          time_base_num: 1,
          time_base_den: 90000,
        },
        { ...audioStream, index: 1 },
        { index: 2, codec_type: 3, codec_id: 94213, codecpar: 902 },
      ],
      packets: { 0: [videoPacket], 1: [{ data: new Uint8Array(8) }] },
      outTimeBases: [90000, 48000],
    });
    (getLibAVFat as jest.Mock).mockResolvedValue(la);

    const out = await transcodeForExport(file('clip.mkv'));

    expect(out.name).toBe('clip.mp4');
    expect(out.type).toBe('video/mp4');
    expect(getLibAV).not.toHaveBeenCalled();
    // Only the audio stream is decoded; the subtitle stream is dropped.
    expect(la.ff_init_decoder).toHaveBeenCalledTimes(1);
    expect(la.ff_init_decoder).toHaveBeenCalledWith(65536, 900);
    expect(la.AVStream_discard_s).toHaveBeenCalledTimes(1);
    expect(la.AVFormatContext_streams_a).toHaveBeenCalledWith(100, 2);
    expect(la.ff_init_muxer).toHaveBeenCalledWith(
      expect.objectContaining({ format_name: 'mp4', codecpars: true }),
      [
        [901, 1, 90000],
        [600, 1, 48000],
      ],
    );
    const video = written(la).filter((p: any) => p.stream_index === 0);
    expect(video).toHaveLength(1);
    expect(video[0].data).toBe(videoPacket.data);
    expect(video[0]).toMatchObject({
      pts: 3000,
      dts: 0,
      duration: 3000,
      flags: 1,
    });
    expect(written(la).filter((p: any) => p.stream_index === 1)).toHaveLength(
      1,
    );
  });

  it('rejects a file without an audio stream, and cleans up', async () => {
    const la = fakeLibAV({
      streams: [{ index: 0, codec_type: VIDEO, codec_id: 27, codecpar: 901 }],
      packets: {},
    });
    (getLibAVFat as jest.Mock).mockResolvedValue(la);

    await expect(transcodeForExport(file('silent.mp4'))).rejects.toThrow(
      /no audio stream/i,
    );
    const [inName] = la.writeFile.mock.calls[0] as unknown as [string];
    expect(la.unlink).toHaveBeenCalledWith(inName);
    expect(la.avformat_close_input_js).toHaveBeenCalledWith(100);
  });

  it('rejects when the muxer refuses the streams', async () => {
    const la = fakeLibAV({
      streams: [
        {
          index: 0,
          codec_type: VIDEO,
          codec_id: 139,
          codecpar: 901,
          time_base_num: 1,
          time_base_den: 1000,
        },
        { ...audioStream, index: 1 },
      ],
      packets: {},
      headerRet: -22,
    });
    (getLibAVFat as jest.Mock).mockResolvedValue(la);

    await expect(transcodeForExport(file('vp8.webm'))).rejects.toThrow(
      /muxer refused/i,
    );
    expect(la.ff_write_multi).not.toHaveBeenCalled();
    expect(la.ff_free_muxer).toHaveBeenCalledWith(700, 702);
    expect(la.ff_free_encoder).toHaveBeenCalledWith(500, 501, 502);
  });

  it('rejects when no audio could be decoded', async () => {
    const la = fakeLibAV({ streams: [audioStream], packets: {} });
    (getLibAV as jest.Mock).mockResolvedValue(la);

    await expect(transcodeForExport(file('empty.wav'))).rejects.toThrow(
      /no audio could be decoded/i,
    );
  });

  it('unlinks a partly written input when writing it fails', async () => {
    const la = fakeLibAV({ streams: [audioStream], packets: {} });
    la.writeFile.mockRejectedValue(new Error('disk full') as never);
    (getLibAV as jest.Mock).mockResolvedValue(la);

    await expect(transcodeForExport(file('a.wav'))).rejects.toThrow(
      /disk full/,
    );
    const [inName] = la.writeFile.mock.calls[0] as unknown as [string];
    expect(la.unlink).toHaveBeenCalledWith(inName);
  });

  it('rejects files too large for the wasm heap before loading libav', async () => {
    const big = file('huge.wav');
    Object.defineProperty(big, 'size', { value: MAX_TRANSCODE_BYTES + 1 });

    await expect(transcodeForExport(big)).rejects.toThrow(/too large/i);
    expect(getLibAV).not.toHaveBeenCalled();
  });
});
