/**
 * sample rate required by the on-device Whisper/pyannote ML models
 */
export const ML_MODEL_SAMPLE_RATE = 16000;

export function isSafariOrWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    (/Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) ||
    /iPad|iPhone|iPod/.test(navigator.userAgent)
  );
}

export function needsResampling(sampleRate: number): boolean {
  return sampleRate < 44100 && isSafariOrWebKit();
}

export function resampleChannels(
  channels: Float32Array[],
  srcRate: number,
  targetRate: number,
): Float32Array[] {
  const outLength = Math.ceil((channels[0].length * targetRate) / srcRate);
  return channels.map((ch) => resampleChannel(ch, srcRate, targetRate, outLength));
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const mono = new Float32Array(length);
  const invN = 1 / channels.length;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    mono[i] = sum * invN;
  }
  return mono;
}

function resampleChannel(
  input: Float32Array,
  srcRate: number,
  targetRate: number,
  outLength: number,
): Float32Array {
  const output = new Float32Array(outLength);
  const ratio = srcRate / targetRate;
  const a = 3;
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    let sum = 0;
    let weightSum = 0;
    const start = Math.max(0, srcIndex - a + 1);
    const end = Math.min(input.length - 1, srcIndex + a);
    for (let j = start; j <= end; j++) {
      const x = srcPos - j;
      const w = lanczos(x, a);
      sum += input[j] * w;
      weightSum += w;
    }
    output[i] = weightSum > 0 ? sum / weightSum : 0;
  }
  return output;
}

function lanczos(x: number, a: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}
