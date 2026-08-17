import { afterEach, describe, expect, it } from '@jest/globals';
import {
  assemblePcmToWav,
  extensionForMime,
  pickBestAudioMime,
  pickBestVideoMime,
} from './recording-formats';

describe('recording-formats', () => {
  describe('extensionForMime', () => {
    it.each([
      ['audio/webm;codecs=opus', 'webm'],
      ['audio/webm', 'webm'],
      ['audio/mp4', 'm4a'],
      ['video/mp4', 'mp4'],
      ['video/mp4;codecs=avc1.42E01E', 'mp4'],
      ['video/webm;codecs=vp9,opus', 'webm'],
      ['audio/wav', 'wav'],
      ['audio/x-wav', 'wav'],
      ['audio/ogg', 'ogg'],
      ['', 'bin'],
    ])('%s -> %s', (mime, ext) => {
      expect(extensionForMime(mime)).toBe(ext);
    });
  });

  describe('mime pickers', () => {
    const realMR = (globalThis as unknown as { MediaRecorder?: unknown })
      .MediaRecorder;

    afterEach(() => {
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder =
        realMR;
    });

    it('pickBestAudioMime falls back through preference list', () => {
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = {
        isTypeSupported: (m: string) => m === 'audio/mp4',
      };
      expect(pickBestAudioMime()).toBe('audio/mp4');
    });

    it('pickBestAudioMime returns empty string when nothing supported', () => {
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = {
        isTypeSupported: () => false,
      };
      expect(pickBestAudioMime()).toBe('');
    });

    it('pickBestVideoMime prefers mp4 over webm', () => {
      (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = {
        isTypeSupported: (m: string) =>
          m === 'video/mp4' || m.startsWith('video/webm'),
      };
      const picked = pickBestVideoMime();
      expect(picked.startsWith('video/mp4')).toBe(true);
    });

    it('pickBestVideoMime returns empty string when MediaRecorder missing', () => {
      delete (globalThis as unknown as { MediaRecorder?: unknown })
        .MediaRecorder;
      expect(pickBestVideoMime()).toBe('');
    });
  });

  describe('assemblePcmToWav', () => {
    it('writes a valid RIFF/WAVE header for mono PCM', () => {
      const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
      const blob = assemblePcmToWav([samples], 16000, 1);
      expect(blob.type).toBe('audio/wav');
      expect(blob.size).toBe(44 + samples.length * 2);
    });

    it('combines multiple chunks in order', () => {
      const a = new Float32Array([0.1, 0.2]);
      const b = new Float32Array([0.3, 0.4]);
      const blob = assemblePcmToWav([a, b], 8000, 1);
      expect(blob.size).toBe(44 + 4 * 2);
    });

    it('clips samples to [-1, 1] range', () => {
      const samples = new Float32Array([2, -2]);
      const blob = assemblePcmToWav([samples], 8000, 1);
      expect(blob.size).toBe(44 + 4);
    });
  });
});
