import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeWithLibAV, libavBuilds } from './libav-decoder';

const AUDIO = 1;

// The calls decodeWithLibAV makes on a libav.js instance, faked: one mono
// float frame of 4 samples at 48 kHz.
function fakeLibAV(opts: { opens?: boolean; streams?: any[] } = {}) {
  return {
    AVMEDIA_TYPE_AUDIO: AUDIO,
    writeFile: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    ff_init_demuxer_file: vi.fn(async () => {
      if (opts.opens === false) throw new Error('Could not open source file');
      return [
        100,
        opts.streams ?? [{ index: 0, codec_type: AUDIO, codec_id: 86076 }],
      ];
    }),
    AVFormatContext_streams_a: vi.fn(async () => 1000),
    AVStream_discard_s: vi.fn(async () => undefined),
    avformat_close_input_js: vi.fn(async () => undefined),
    ff_init_decoder: vi.fn(async () => [1, 200, 201, 202]),
    ff_free_decoder: vi.fn(async () => undefined),
    ff_read_frame_multi: vi.fn(async () => [0, { 0: [{}] }]),
    ff_decode_multi: vi.fn(async () => [
      {
        sample_rate: 48000,
        channels: 1,
        format: 3, // FLT
        nb_samples: 4,
        data: new Float32Array([0, 0.5, -0.5, 0]),
      },
    ]),
  };
}

describe('decodeWithLibAV', () => {
  afterEach(() => vi.restoreAllMocks());

  it('decodes on the default build when it can', async () => {
    const small = fakeLibAV();
    vi.spyOn(libavBuilds, 'getLibAV').mockResolvedValue(small);
    const fat = vi.spyOn(libavBuilds, 'getLibAVFat');

    const out = await decodeWithLibAV(new ArrayBuffer(8), 'a.opus');

    expect(out.length).toBe(4);
    expect(out.sampleRate).toBe(48000);
    expect(fat).not.toHaveBeenCalled();
  });

  it('retries once on the fat build when the default build cannot open the file (Opus in mp4)', async () => {
    const small = fakeLibAV({ opens: false });
    const big = fakeLibAV();
    vi.spyOn(libavBuilds, 'getLibAV').mockResolvedValue(small);
    vi.spyOn(libavBuilds, 'getLibAVFat').mockResolvedValue(big);
    const status = vi.fn();

    const out = await decodeWithLibAV(new ArrayBuffer(8), 'clip.mp4', status);

    expect(out.length).toBe(4);
    expect(big.ff_init_demuxer_file).toHaveBeenCalledWith('clip.mp4');
    expect(small.unlink).toHaveBeenCalledWith('clip.mp4');
    expect(libavBuilds.getLibAVFat).toHaveBeenCalledWith(status);
  });

  it('retries on the fat build when the default build has no decoder for it', async () => {
    const small = fakeLibAV();
    small.ff_init_decoder.mockRejectedValue(new Error('Codec not found'));
    const big = fakeLibAV();
    vi.spyOn(libavBuilds, 'getLibAV').mockResolvedValue(small);
    vi.spyOn(libavBuilds, 'getLibAVFat').mockResolvedValue(big);

    await expect(
      decodeWithLibAV(new ArrayBuffer(8), 'aac.mkv'),
    ).resolves.toBeDefined();
    expect(big.ff_init_decoder).toHaveBeenCalled();
  });

  it('does not retry a file without an audio stream', async () => {
    const small = fakeLibAV({ streams: [] });
    vi.spyOn(libavBuilds, 'getLibAV').mockResolvedValue(small);
    const fat = vi.spyOn(libavBuilds, 'getLibAVFat');

    await expect(decodeWithLibAV(new ArrayBuffer(8), 'x.wav')).rejects.toThrow(
      /no audio stream/i,
    );
    expect(fat).not.toHaveBeenCalled();
  });

  it('reports the fat build failure when both builds fail', async () => {
    const small = fakeLibAV({ opens: false });
    const big = fakeLibAV();
    big.ff_init_decoder.mockRejectedValue(new Error('fat failed'));
    vi.spyOn(libavBuilds, 'getLibAV').mockResolvedValue(small);
    vi.spyOn(libavBuilds, 'getLibAVFat').mockResolvedValue(big);

    await expect(decodeWithLibAV(new ArrayBuffer(8), 'x.mp4')).rejects.toThrow(
      /fat failed/,
    );
  });

  it('sends ASF (.wma) straight to the fat build, as before', async () => {
    const big = fakeLibAV();
    const small = vi.spyOn(libavBuilds, 'getLibAV');
    vi.spyOn(libavBuilds, 'getLibAVFat').mockResolvedValue(big);

    await decodeWithLibAV(new ArrayBuffer(8), 'w.wma');

    expect(small).not.toHaveBeenCalled();
    expect(big.ff_init_demuxer_file).toHaveBeenCalledWith('w.wma');
  });
});
