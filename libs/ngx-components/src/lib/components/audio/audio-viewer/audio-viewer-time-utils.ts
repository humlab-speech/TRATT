import { SampleUnit } from '@tratt/media';
import { TsWorkerJob } from '@tratt/utilities';
import { AudioChunk, AudioTimeCalculator } from '@tratt/web-media';
import { MultiThreadingService } from '../../../multi-threading.service';

/**
 * The subset of AudioviewerConfig's shape that the line/cursor position math
 * below reads. Declared locally (rather than importing AudioviewerConfig)
 * so this module doesn't pull in that class's import chain (which drags in
 * ng-bootstrap via the `obj` barrel) just for a type; a real
 * AudioviewerConfig instance satisfies this interface structurally, so
 * callers can keep passing `this.settings` unchanged.
 */
export interface AudioViewerLineSettings {
  lineheight: number;
  margin: {
    left: number;
    top: number;
  };
  playcursor: {
    width: number;
  };
}

/**
 * AudioViewerTimeUtils holds the time/zoom math extracted from
 * AudioViewerService (S1 split, task 12/21). It is a plain class (not
 * @Injectable) since it is stateless-ish pure math: every piece of
 * AudioViewerService instance state it needs is passed in as a method
 * parameter (or, for the long-lived MultiThreadingService dependency, as a
 * parameter of the one method that needs it) rather than injected, so the
 * class can be instantiated directly with `new AudioViewerTimeUtils()`.
 *
 * All 8 methods below are moved verbatim from audio-viewer.service.ts,
 * only replacing `this.X` field/getter reads with parameters.
 */
export class AudioViewerTimeUtils {
  public getPixelPerSecond(
    secondsPerLine: number,
    innerWidth: number | undefined,
    audioChunk: AudioChunk | undefined,
  ) {
    if (innerWidth !== undefined) {
      if (secondsPerLine !== undefined) {
        if (
          audioChunk?.time &&
          audioChunk.time.duration.seconds < secondsPerLine
        ) {
          return innerWidth / audioChunk.time.duration.seconds;
        }
        return innerWidth / secondsPerLine;
      } else {
        console.error(`secondsPerLine is undefined or undefined!`);
      }
      return innerWidth / 5;
    }
    return 0;
  }

  /**
   * computeDisplayData() generates an array of min-max pairs representing the
   * audio signal. The values of the array are float in the range -1 .. 1.
   */
  async computeWholeDisplayData(
    width: number,
    height: number,
    cha: Float32Array,
    _interval: { start: number; end: number },
    roundValues: boolean,
    multiThreadingService: MultiThreadingService,
  ): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
      const promises = [];

      const numberOfPieces = 8;

      const xZoom = (_interval.end - _interval.start) / width;

      let piece = Math.floor(width / numberOfPieces);
      const samplePiece = Math.floor(
        (_interval.end - _interval.start) / numberOfPieces,
      );

      for (let i = 1; i <= numberOfPieces; i++) {
        const start = _interval.start + (i - 1) * samplePiece;
        let end = start + samplePiece;
        if (i === numberOfPieces) {
          // make sure to fit whole width
          piece = Math.round(width - piece * (numberOfPieces - 1));
          end = Math.ceil(_interval.end);
        }
        const tsJob = new TsWorkerJob<
          [
            width: number,
            height: number,
            channel: Float32Array,
            interval: {
              start: number;
              end: number;
            },
            roundValues: boolean,
            xZoom: number,
          ],
          number[]
        >(
          this.computeDisplayData,
          piece,
          height,
          cha.slice(start, end),
          {
            start,
            end,
          },
          roundValues,
          xZoom,
        );

        promises.push(multiThreadingService.run<number[]>(tsJob));
      }

      Promise.all(promises)
        .then((values: number[][]) => {
          let result: any[] | PromiseLike<number[]> = [];
          for (const value of values) {
            result = result.concat(value);
          }

          resolve(result);
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  /**
   * @param width
   * @param height
   * @param channel
   * @param interval
   * @param roundValues
   * @param xZoom
   */
  public computeDisplayData = (
    width: number,
    height: number,
    channel: Float32Array,
    interval: {
      start: number;
      end: number;
    },
    roundValues: boolean,
    xZoom: number,
  ) => {
    return new Promise<number[]>((resolve, reject) => {
      if (
        interval.start !== undefined &&
        interval.end !== undefined &&
        interval.end >= interval.start
      ) {
        const minMaxArray = [];
        const len = interval.end - interval.start;

        let min = 0;
        let max = 0;
        let val = 0;
        let offset = 0;
        let maxIndex = 0;

        const yZoom = height / 2;

        for (let i = 0; i < width && offset < channel.length; i++) {
          offset = Math.round(i * xZoom);
          let floatValue = channel[offset];

          if (isNaN(floatValue)) {
            floatValue = 0;
          }

          min = floatValue;
          max = floatValue;

          if (offset + xZoom > len) {
            maxIndex = len;
          } else {
            maxIndex = Math.round(offset + xZoom);
          }

          for (let j = offset; j < maxIndex; j++) {
            floatValue = channel[j];

            val = floatValue;
            max = Math.max(max, val);
            min = Math.min(min, val);
          }

          if (roundValues) {
            minMaxArray.push(Math.round(min * yZoom));
            minMaxArray.push(Math.round(max * yZoom));
          } else {
            minMaxArray.push(min * yZoom);
            minMaxArray.push(max * yZoom);
          }
        }

        (channel as any) = undefined;
        resolve(minMaxArray);
      } else {
        reject('interval.end is less than interval.start');
      }
    });
  };

  /**
   * Computes the new zoomX/zoomY given the current signal extremes.
   *
   * The original AudioViewerService.calculateZoom() mutated this._zoomX and
   * this._zoomY in place (and left them untouched when the "rest > 0"
   * condition wasn't met, or when justifySignalHeight was off it only ever
   * touched zoomY). To keep this class free of instance state, it now takes
   * the current zoomX/zoomY as input and returns the (possibly unchanged)
   * values, so callers can assign the result back onto their own fields.
   */
  public calculateZoom(
    height: number,
    width: number,
    minmaxarray: number[],
    audioPxWidth: number,
    justifySignalHeight: boolean,
    timelineEnabled: boolean,
    timelineHeight: number,
    currentZoomX: number,
    currentZoomY: number,
  ): { zoomX: number; zoomY: number } {
    let zoomX = currentZoomX;
    let zoomY = currentZoomY;

    if (justifySignalHeight) {
      // justify height to maximum top border
      let maxZoomX = 0;
      let maxZoomY = 0;
      const timeLineHeight = timelineEnabled ? timelineHeight : 0;
      let maxZoomYMin = height / 2;
      const xMax = audioPxWidth;

      // get_max_signal_length
      for (let i = 0; i <= xMax; i++) {
        maxZoomX = i;

        if (isNaN(minmaxarray[i])) {
          break;
        }
        maxZoomY = Math.max(maxZoomY, minmaxarray[i]);
        maxZoomYMin = Math.min(maxZoomYMin, minmaxarray[i]);
      }

      let rest = height - timeLineHeight - (maxZoomY + Math.abs(maxZoomYMin));
      rest = Math.floor(rest - 2);

      if (rest > 0) {
        zoomY = rest / (maxZoomY + Math.abs(maxZoomYMin)) + 1;
        zoomY = Math.floor(zoomY * 10) / 10;
        zoomX = width / maxZoomX;
      }
    } else {
      zoomY = 1;
    }

    return { zoomX, zoomY };
  }

  /**
   * get Line by absolute width of the audio sample
   */
  public getPlayCursorPositionOfLineByAbsX(
    absX: number,
    innerWidth: number | undefined,
    settings: AudioViewerLineSettings,
  ): {
    x: number;
    y: number;
  } {
    if (innerWidth !== undefined && innerWidth > 0) {
      const lineNum = Math.floor(absX / innerWidth);
      let x =
        settings.margin.left -
        settings.playcursor.width / 2 +
        absX -
        lineNum * innerWidth;
      x = isNaN(x) ? 0 : x;
      let y = lineNum * (settings.lineheight + settings.margin.top);
      y = isNaN(y) ? 0 : y;

      return { x, y };
    }
    return {
      x: 0,
      y: 0,
    };
  }

  /**
   * get selection of an sample relative to its position and width
   */
  public getRelativeSelectionByLine(
    lineNum: number,
    lineWidth: number,
    startSamples: SampleUnit,
    endSamples: SampleUnit,
    innerWidth: number,
    audioTCalculator: AudioTimeCalculator | undefined,
    audioChunk: AudioChunk | undefined,
  ): { start: number; end: number } {
    if (audioTCalculator !== undefined && audioChunk !== undefined) {
      const absX = lineNum * innerWidth;
      const absEnd = absX + lineWidth;
      const selAbsStart = audioTCalculator.samplestoAbsX(
        startSamples.sub(audioChunk.time.start),
      );
      const selAbsEnd = audioTCalculator.samplestoAbsX(
        endSamples.sub(audioChunk.time.start),
      );

      const result = {
        start: selAbsStart,
        end: selAbsEnd,
      };

      if (selAbsEnd > -1 && selAbsEnd >= absX) {
        if (selAbsStart > -1) {
          // check start selection
          if (selAbsStart >= absX) {
            result.start = selAbsStart - absX;
          } else {
            result.start = 0;
          }
        } else {
          result.start = 0;
        }

        if (selAbsStart <= absEnd) {
          // check end selection
          if (selAbsEnd > absEnd) {
            result.end = innerWidth;
          } else if (selAbsEnd <= absEnd) {
            result.end = selAbsEnd - lineNum * innerWidth;
          }
          if (result.start > result.end) {
            const tmp = result.start;
            result.start = result.end;
            result.end = tmp;
          }
          return result;
        }
      }
    }

    return { start: -3, end: -1 };
  }

  public getNumberOfLines(
    innerWidth: number | undefined,
    audioPxWidth: number,
  ) {
    if (innerWidth !== undefined) {
      return Math.ceil(audioPxWidth / innerWidth);
    }
    return -1;
  }

  public getLineNumber(
    x: number,
    y: number,
    innerWidth: number | undefined,
    audioPxWidth: number,
    settings: AudioViewerLineSettings,
  ) {
    const numOfLines = this.getNumberOfLines(innerWidth, audioPxWidth);

    for (let i = 0; i < numOfLines; i++) {
      const locY = i * (settings.lineheight + settings.margin.top);
      const locMaxY = locY + settings.lineheight;

      if (y >= locY && y <= locMaxY) {
        return i;
      }
    }

    return -1;
  }
}
