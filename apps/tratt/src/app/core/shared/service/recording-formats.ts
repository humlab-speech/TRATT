const AUDIO_MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
];

const VIDEO_MIME_PREFERENCE = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function isSupported(mime: string): boolean {
  const MR = (
    globalThis as unknown as {
      MediaRecorder?: { isTypeSupported?: (type: string) => boolean };
    }
  ).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return false;
  try {
    return MR.isTypeSupported(mime);
  } catch {
    return false;
  }
}

export function pickBestAudioMime(): string {
  for (const m of AUDIO_MIME_PREFERENCE) {
    if (isSupported(m)) return m;
  }
  return '';
}

export function pickBestVideoMime(): string {
  for (const m of VIDEO_MIME_PREFERENCE) {
    if (isSupported(m)) return m;
  }
  return '';
}

export function extensionForMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mp4':
    case 'video/mp4':
      return base === 'audio/mp4' ? 'm4a' : 'mp4';
    case 'audio/webm':
      return 'webm';
    case 'video/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    default:
      if (base.startsWith('video/')) return 'webm';
      if (base.startsWith('audio/')) return 'webm';
      return 'bin';
  }
}

export function assemblePcmToWav(
  chunks: Float32Array[],
  sampleRate: number,
  channels: number,
): Blob {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const frames = Math.floor(totalSamples / channels);
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
