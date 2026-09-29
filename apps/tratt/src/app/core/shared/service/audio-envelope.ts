import { AudioViewerTimeUtils } from '@tratt/ngx-components';

/**
 * Decode-time-cached min/max amplitude summary of an audio channel,
 * downsampled to a fixed number of columns.
 */
export interface AudioEnvelope {
  columns: number;
  minMax: Float32Array;
}

const timeUtils = new AudioViewerTimeUtils();

/**
 * Computes a downsampled min/max envelope of an audio channel.
 *
 * Wraps `AudioViewerTimeUtils.computeDisplayData`, which walks
 * `channel` in `columns` steps of `xZoom = channel.length / columns`
 * samples each, pushing an interleaved `[min, max]` pair per column.
 *
 * `computeDisplayData`'s inner loop is guarded by
 * `i < width && offset < channel.length`: when `channel.length` is
 * smaller than `columns` (e.g. a very short recording, or a channel
 * that arrives before decoding has produced its full length), `offset`
 * (which advances by `xZoom < 1` per step) can only take on
 * `channel.length` distinct integer values before it reaches
 * `channel.length` and the loop stops early, short of `columns`
 * iterations. That yields a `minMaxArray` shorter than `columns * 2`.
 * This wrapper pads the result up to exactly `columns * 2` by
 * repeating the last computed `[min, max]` pair (or `[0, 0]` if
 * `computeDisplayData` produced nothing at all), so callers can rely
 * on `minMax.length === columns * 2` unconditionally.
 */
export async function computeAudioEnvelope(
  channel: Float32Array,
  columns = 4000,
): Promise<AudioEnvelope> {
  const xZoom = channel.length / columns;
  const minMax = await timeUtils.computeDisplayData(
    columns,
    2, // height=2 -> yZoom=1, i.e. raw amplitude values, not pixel-scaled
    channel,
    { start: 0, end: channel.length },
    false,
    xZoom,
  );

  const targetLength = columns * 2;
  if (minMax.length < targetLength) {
    const lastMin = minMax.length >= 2 ? minMax[minMax.length - 2] : 0;
    const lastMax = minMax.length >= 1 ? minMax[minMax.length - 1] : 0;
    for (let i = minMax.length; i < targetLength; i += 2) {
      minMax.push(lastMin, lastMax);
    }
  }

  return { columns, minMax: Float32Array.from(minMax) };
}
