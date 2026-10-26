import { OAudiofile } from '@tratt/media';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '../annotjson';

export const BASE = 'Intervju med Stig Bergling';

/** Mock OAudiofile matching the WAV (48 kHz, ~2691.89 s = 129210690 samples). */
export const audiofile: OAudiofile = {
  name: `${BASE}.wav`,
  size: 86140502,
  duration: 129210690,
  sampleRate: 48000,
  arraybuffer: undefined,
};

export function segmentCount(ann: OAnnotJSON): number {
  return ann.levels.reduce((n, l) => n + l.items.length, 0);
}

/** Clean ms-boundary end of the synthetic transcript (2692 s × 48000). */
export const SYNTH_END = 129216000;
export const SYNTH_SEGMENTS = 40;

/**
 * Synthetic stand-in for a real interview transcript: contiguous units over
 * the whole recording, with Swedish text (å ä ö), empty units and breaks.
 */
export function makeSyntheticAnnot(): OAnnotJSON {
  const len = SYNTH_END / SYNTH_SEGMENTS; // 3230400 samples = 67300 ms
  const items = Array.from({ length: SYNTH_SEGMENTS }, (_, i) => {
    const value =
      i % 5 === 4
        ? ''
        : i % 7 === 6
          ? '<P>'
          : `Så här låter mening ${i + 1}, ändå på svenska.`;
    return new OSegment(i + 1, i * len, len, [new OLabel('OCTRA_1', value)]);
  });
  return new OAnnotJSON('synthetic.wav', 'synthetic.wav', 48000, [
    new OSegmentLevel<OSegment>('OCTRA_1', items),
  ]);
}
