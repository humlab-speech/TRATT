class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferedFrames = 0;
    this._frameTarget = 4096;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const frames = input[0].length;
    const mono = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      mono[f] = input[0][f];
    }

    this._buffer.push(mono);
    this._bufferedFrames += frames;

    if (this._bufferedFrames >= this._frameTarget) {
      const total = this._buffer.reduce((s, a) => s + a.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of this._buffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this.port.postMessage({ samples: merged }, [merged.buffer]);
      this._buffer = [];
      this._bufferedFrames = 0;
    }

    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor);
