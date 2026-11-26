const MIN_SEGMENT_MS = 10;

/** `mm:ss.mmm`, or `h:mm:ss.mmm` from one hour. */
export function formatTime(samples: number, sampleRate: number): string {
  const totalMs = Math.round((samples * 1000) / sampleRate);
  const ms = totalMs % 1000;
  const totalS = Math.floor(totalMs / 1000);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const tail = `${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
  return h > 0 ? `${h}:${tail}` : tail;
}

/**
 * Clamps a new end for segment `i` so it stays at least 10 ms away from its
 * neighbours. The last segment's end (file end) is fixed.
 * @param ends every segment's end sample, in order
 */
export function moveBoundary(
  ends: readonly number[],
  i: number,
  target: number,
  sampleRate: number,
): number {
  if (i >= ends.length - 1) {
    return ends[i];
  }
  const min = Math.round((MIN_SEGMENT_MS * sampleRate) / 1000);
  const lower = (i > 0 ? ends[i - 1] : 0) + min;
  const upper = ends[i + 1] - min;
  return Math.min(Math.max(target, lower), upper);
}

/**
 * Index of the unit that contains `sample`, given each unit's end. Unit `i`
 * covers (ends[i-1], ends[i]]; before the first end is unit 0, past the last
 * end the last unit.
 */
export function unitAt(ends: number[], sample: number): number {
  let lo = 0;
  let hi = ends.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] < sample) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
