export interface Peak {
  min: number;
  max: number;
}

/**
 * Min/max of `channel` per pixel column over [startSample, endSample).
 * `channel` is downsampled by `factor`; columns outside it yield 0/0.
 */
export function computePeaks(
  channel: Float32Array,
  factor: number,
  startSample: number,
  endSample: number,
  width: number,
): Peak[] {
  const perColumn = (endSample - startSample) / width;
  const peaks: Peak[] = [];
  for (let x = 0; x < width; x++) {
    const from = Math.max(
      0,
      Math.floor((startSample + x * perColumn) / factor),
    );
    const to = Math.min(
      channel.length,
      Math.max(
        from + 1,
        Math.ceil((startSample + (x + 1) * perColumn) / factor),
      ),
    );
    let min = Infinity;
    let max = -Infinity;
    for (let k = from; k < to; k++) {
      min = Math.min(min, channel[k]);
      max = Math.max(max, channel[k]);
    }
    if (min === Infinity) {
      min = 0;
      max = 0;
    }
    peaks.push({ min, max });
  }
  return peaks;
}
