import {
  chooseOrtThreads,
  configureOrtThreads,
  MAX_ORT_THREADS,
  ortThreadsOverrideFromUrl,
} from './ort-threads';

describe('chooseOrtThreads', () => {
  it('uses one thread when the page is not cross-origin isolated', () => {
    expect(chooseOrtThreads(24, false)).toBe(1);
    expect(chooseOrtThreads(24, false, 8)).toBe(1);
  });

  it('leaves two logical cores free', () => {
    expect(chooseOrtThreads(8, true)).toBe(6);
    expect(chooseOrtThreads(4, true)).toBe(2);
  });

  it('never goes below one thread', () => {
    expect(chooseOrtThreads(2, true)).toBe(1);
    expect(chooseOrtThreads(1, true)).toBe(1);
  });

  it('caps the thread count', () => {
    expect(chooseOrtThreads(24, true)).toBe(MAX_ORT_THREADS);
  });

  it('falls back to one thread when the core count is unknown', () => {
    expect(chooseOrtThreads(undefined, true)).toBe(1);
    expect(chooseOrtThreads(0, true)).toBe(1);
  });

  it('honours a valid override, ignoring the cap', () => {
    expect(chooseOrtThreads(24, true, 12)).toBe(12);
    expect(chooseOrtThreads(24, true, 0)).toBe(MAX_ORT_THREADS);
    expect(chooseOrtThreads(24, true, 2.5)).toBe(MAX_ORT_THREADS);
  });
});

describe('ortThreadsOverrideFromUrl', () => {
  it('reads ?threads=N', () => {
    expect(ortThreadsOverrideFromUrl('?workspace=visp&threads=6')).toBe(6);
  });

  it('ignores a missing or invalid value', () => {
    expect(ortThreadsOverrideFromUrl('?workspace=visp')).toBeUndefined();
    expect(ortThreadsOverrideFromUrl('?threads=abc')).toBeUndefined();
    expect(ortThreadsOverrideFromUrl('?threads=0')).toBeUndefined();
    expect(ortThreadsOverrideFromUrl('?threads=-3')).toBeUndefined();
  });
});

describe('configureOrtThreads', () => {
  it('writes the chosen count into the ONNX Runtime env', () => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const wasm: { numThreads?: number } = {};
    const threads = configureOrtThreads(wasm, 'test');
    expect(wasm.numThreads).toBe(threads);
    expect(threads).toBeGreaterThanOrEqual(1);
  });
});
