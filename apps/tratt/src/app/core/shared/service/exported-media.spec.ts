import {
  exportedMediaName,
  exportedMediaType,
  isVideoName,
  OPUS_BITRATE,
} from './exported-media';

describe('exported-media', () => {
  it('uses 32 kbps for Opus', () => {
    expect(OPUS_BITRATE).toBe(32_000);
  });

  it('renames audio to .opus, keeping the basename', () => {
    expect(exportedMediaName('Intervju 1.WAV')).toBe('Intervju 1.opus');
    expect(exportedMediaName('a.opus')).toBe('a.opus');
    expect(exportedMediaName('take.2.mp3')).toBe('take.2.opus');
    expect(exportedMediaName('noext')).toBe('noext.opus');
  });

  it('renames video to .mp4', () => {
    expect(exportedMediaName('clip.mkv')).toBe('clip.mp4');
    expect(exportedMediaName('clip.MOV')).toBe('clip.mp4');
    expect(exportedMediaName('clip.mp4')).toBe('clip.mp4');
  });

  it('recognises video extensions case-insensitively', () => {
    for (const ext of ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', '3gp']) {
      expect(isVideoName(`x.${ext}`)).toBe(true);
      expect(isVideoName(`x.${ext.toUpperCase()}`)).toBe(true);
    }
    expect(isVideoName('x.wav')).toBe(false);
    expect(isVideoName('mp4')).toBe(false);
  });

  it('gives the MIME type of the exported file', () => {
    expect(exportedMediaType('x.mov')).toBe('video/mp4');
    expect(exportedMediaType('x.wav')).toBe('audio/ogg');
  });
});
