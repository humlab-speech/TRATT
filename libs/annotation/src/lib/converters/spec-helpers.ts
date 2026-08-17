import { OAudiofile } from '@tratt/media';
import * as fs from 'fs';
import * as path from 'path';
import { OAnnotJSON } from '../annotjson';

export const BASE = 'Intervju med Stig Bergling';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../..');

export function readFile(name: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, name), 'utf-8');
}

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
