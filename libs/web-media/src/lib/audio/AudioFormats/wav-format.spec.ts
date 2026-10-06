import { WavFormat } from './wav-format';

/** 16 kHz mono 16-bit PCM WAV whose header declares `declaredBytes` of data. */
function makeWav(declaredBytes: number, actualBytes: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + actualBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + declaredBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, declaredBytes, true);
  return buf;
}

async function durationOf(buf: ArrayBuffer) {
  const f = new WavFormat();
  await f.init('t.wav', 'audio/wav', buf);
  return f.duration;
}

describe('WavFormat duration', () => {
  it('uses the declared data size when the file holds all of it', async () => {
    const d = await durationOf(makeWav(32000, 32000));
    expect(d.seconds).toBeCloseTo(1, 5);
    expect(d.samples).toBe(16000);
  });

  it('caps the duration to the bytes actually present in a truncated file', async () => {
    const d = await durationOf(makeWav(32000 * 10, 16000));
    expect(d.seconds).toBeCloseTo(0.5, 5);
  });

  it('reports zero for a file that has a header but no audio data', async () => {
    const d = await durationOf(makeWav(32000, 0));
    expect(d.seconds).toBe(0);
  });
});
