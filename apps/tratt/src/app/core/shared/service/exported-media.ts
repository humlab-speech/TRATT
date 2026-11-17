// Name/type of a recording as Tratt exports it. Pure: no libav import, so the
// export dialog's preview can use it without loading any wasm.

export const OPUS_BITRATE = 32_000;

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  '3gp',
]);

function splitExtension(name: string): [string, string] {
  const m = name.match(/^(.+)\.([^.]+)$/);
  return m ? [m[1], m[2].toLowerCase()] : [name, ''];
}

export function isVideoName(name: string): boolean {
  return VIDEO_EXTENSIONS.has(splitExtension(name)[1]);
}

/**
 * The exported file's name: `.mp4` for a video, else `.opus`. Without
 * `video`, a guess from the extension (the dialog's preview): only the
 * transcoder knows whether a .webm or .mp4 holds video at all.
 */
export function exportedMediaName(
  name: string,
  video = isVideoName(name),
): string {
  const [base] = splitExtension(name);
  return `${base}.${video ? 'mp4' : 'opus'}`;
}

export function exportedMediaType(
  name: string,
  video = isVideoName(name),
): string {
  return video ? 'video/mp4' : 'audio/ogg';
}
