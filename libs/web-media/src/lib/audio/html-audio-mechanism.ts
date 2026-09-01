import { AudioSelection, PlayBackStatus, SampleUnit } from '@tratt/media';
import {
  AudioDecoder,
  AudioFormat,
  AudioInfo,
  AudioManager,
  AudioResource,
  getAudioInfo,
  LibavFormat,
  MusicMetadataFormat,
  WavFormat,
} from '@tratt/web-media';
import { concat, map, Observable, Subject, Subscription, timer } from 'rxjs';
import { SourceType } from '../types';
import {
  AudioMechanism,
  AudioMechanismPrepareOptions,
} from './audio-mechanism';
import { ML_MODEL_SAMPLE_RATE, mixToMono } from './audio-resampler';
import { decodeWithLibAV } from './libav-decoder';

type HTMLAudioElement = any;
declare const Audio: any;
declare const OfflineAudioContext: any;
type AudioBuffer = any;

export class HtmlAudioMechanism extends AudioMechanism {
  private _audio?: HTMLAudioElement;
  private _playbackObjectUrl?: string;
  private onEnd = () => {};
  private _playbackEndChecker?: Subscription;
  private _statusRequest: PlayBackStatus = PlayBackStatus.INITIALIZED;
  private callBacksAfterEnded: (() => void)[] = [];

  private audioFormats: AudioFormat[] = [
    new WavFormat(),
    new MusicMetadataFormat(),
    new LibavFormat(),
  ];
  private decoder?: AudioDecoder;

  get playPosition(): SampleUnit | undefined {
    if (!this._audio || !this._resource?.info?.sampleRate) {
      return undefined;
    }

    return new SampleUnit(
      SampleUnit.calculateSamples(
        this._audio.currentTime,
        this._resource.info.sampleRate,
      ),
      this._resource.info.sampleRate,
    );
  }

  set playPosition(value: SampleUnit) {
    if (this._audio) {
      this._audio.currentTime = value.seconds;
    }
  }

  set playBackRate(value: number) {
    if (value > 0) {
      this._playbackRate = value;
    }
  }

  get playBackRate(): number {
    return this._playbackRate;
  }

  override prepare(options: AudioMechanismPrepareOptions): Observable<{
    progress: number;
  }> {
    return concat(
      super.prepare(options),
      this.prepareAudioChannel(options).pipe(
        map(({ decodeProgress }) => {
          if (decodeProgress === 1) {
            this._playbackObjectUrl = URL.createObjectURL(
              new File(
                [this._resource!.arraybuffer!],
                this._resource!.info.fullname,
                { type: this._resource!.info.type },
              ),
            );
            this.prepareAudioPlayback({
              ...options,
              url: this._playbackObjectUrl,
            });
          }
          return {
            progress: decodeProgress,
          };
        }),
      ),
    );
  }

  private prepareAudioPlayback({ url }: AudioMechanismPrepareOptions) {
    if (!url) {
      throw new Error(`HTMLAudioMechanism needs an url to the audio file`);
    }

    this._audio = new Audio();
    this._audio.autoplay = false;
    this._audio.defaultPlaybackRate = 1;
    this._audio.defaultMuted = false;
    this._audio.loop = false;
    this._audio.src = url;

    this.initAudioContext();
  }

  private prepareAudioChannel({
    filename,
    buffer,
    type,
    url,
  }: AudioMechanismPrepareOptions) {
    this._channel = undefined;
    const subj = new Subject<{
      decodeProgress: number;
    }>();

    const audioformat: AudioFormat | undefined = AudioManager.getFileFormat(
      filename.substring(filename.lastIndexOf('.')),
      this.audioFormats,
    );

    if (!buffer) {
      subj.error(`buffer is undefined`);
    } else {
      if (audioformat) {
        audioformat
          .init(filename, type, buffer)
          .then(() => {
            // audio format contains required information

            let audioInfo = getAudioInfo(audioformat, filename, type, buffer);
            const bufferLength = buffer.byteLength;

            audioInfo = new AudioInfo(
              filename,
              type,
              bufferLength,
              audioformat.sampleRate,
              audioformat.duration.samples,
              audioformat.channels,
              audioInfo.bitrate,
            );

            audioInfo.file = new File([buffer], filename, {
              type,
            });

            this.playPosition = new SampleUnit(0, audioInfo.sampleRate);
            this._resource = new AudioResource(
              filename,
              SourceType.ArrayBuffer,
              audioInfo,
              buffer,
              bufferLength,
              url,
            );

            this.afterDecoded.next(this._resource!);

            if (audioformat.decoder === 'tratt') {
              this.decodeAudioWithTrattDecoder(subj);
            } else if (audioformat.decoder === 'web-audio') {
              this.decodeAudioWithWebAPIDecoder(subj);
            } else if (audioformat.decoder === 'libav') {
              this.decodeAudioWithLibavDecoder(subj);
            }
          })
          .catch((e) => {
            subj.error(e.message);
          });
      } else {
        subj.error(`Audio format is not supported.`);
      }
    }

    return subj;
  }

  private decodeAudioWithTrattDecoder(
    subj: Subject<{
      decodeProgress: number;
    }>,
  ) {
    try {
      if (!this._resource) {
        subj.error('Missing resource');
        return;
      }

      this.statistics.decoding.started = Date.now();
      const subscr = this.decodeAudio(this._resource!).subscribe({
        next: (statusItem) => {
          if (statusItem.progress === 1) {
            this.statistics.decoding.duration =
              Date.now() - this.statistics.decoding.started;

            this.changeStatus(PlayBackStatus.INITIALIZED);

            setTimeout(() => {
              subj.next({
                decodeProgress: 1,
              });
              subj.complete();
            }, 0);
          } else {
            subj.next({
              decodeProgress: statusItem.progress,
            });
          }
        },
        error: (error) => {
          console.error(error);
          subscr.unsubscribe();
        },
        complete: () => {
          subscr.unsubscribe();
        },
      });
    } catch (err: any) {
      subj.error(err.message);
    }
  }

  private decodeAudioWithWebAPIDecoder(
    subj: Subject<{
      decodeProgress: number;
    }>,
  ) {
    try {
      if (!this._resource) {
        subj.error('Missing resource');
        return;
      }

      // Guard: only the first tier to complete may resolve subj.
      let decodeSettled = false;
      const settle = (fn: () => void) => {
        if (decodeSettled) return;
        decodeSettled = true;
        fn();
      };

      this.statistics.decoding.started = Date.now();
      this.initAudioContext();
      this._audioContext!.decodeAudioData(this._resource.arraybuffer?.slice(0)!)
        .then(async (audioBuffer: AudioBuffer) => {
          try {
            const info = this._resource?.info!;

            info.audioBufferInfo = {
              sampleRate: audioBuffer.sampleRate,
              samples: audioBuffer.getChannelData(0).length,
            };

            // Always correct duration from the decoded AudioBuffer — more accurate than
            // metadata estimates (music-metadata may return total interleaved samples for
            // stereo OGG, or off-by-one estimates for FLAC). audioBuffer.duration is the
            // authoritative decoded length in seconds; express it in the original metadata
            // sampleRate so all sample positions stay in a consistent unit space.
            info.duration = new SampleUnit(
              Math.ceil(audioBuffer.duration * info.sampleRate),
              info.sampleRate,
            );

            const channels = Array.from(
              { length: audioBuffer.numberOfChannels },
              (_, i) => audioBuffer.getChannelData(i),
            );
            await this.normalizeAudio(channels, audioBuffer.sampleRate);
            this.onChannelDataChange.next();
            this.onChannelDataChange.complete();
            this.statistics.decoding.duration =
              Date.now() - this.statistics.decoding.started;
            this.changeStatus(PlayBackStatus.INITIALIZED);
            settle(() =>
              setTimeout(() => {
                subj.next({ decodeProgress: 1 });
                subj.complete();
              }, 0),
            );
          } catch (_e) {
            this.decodeAudioWithLibavDecoder(subj, settle);
          }
        })
        .catch((_e: unknown) => {
          // Tier 1 failed (decodeAudioData rejected) → Tier 3.
          this.decodeAudioWithLibavDecoder(subj, settle);
        });
    } catch (e) {
      subj.error(e instanceof Error ? e.message : String(e));
    }
  }

  private decodeAudioWithLibavDecoder(
    subj: Subject<{
      decodeProgress: number;
    }>,
    settle: (fn: () => void) => void = (fn) => fn(),
  ) {
    this.statistics.decoding.started = Date.now();

    decodeWithLibAV(
      this._resource!.arraybuffer!,
      this._resource!.info.fullname,
      (msg) => {
        subj.next({ decodeProgress: 0.05, status: msg } as any);
      },
    )
      .then(async (audioBuffer) => {
        const channels: Float32Array[] = [];
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          channels.push(audioBuffer.getChannelData(ch));
        }

        await this.normalizeAudio(channels, audioBuffer.sampleRate);
        this.onChannelDataChange.next();
        this.onChannelDataChange.complete();
        this.statistics.decoding.duration =
          Date.now() - this.statistics.decoding.started;
        this.changeStatus(PlayBackStatus.INITIALIZED);

        settle(() =>
          setTimeout(() => {
            subj.next({ decodeProgress: 1 });
            subj.complete();
          }, 0),
        );
      })
      .catch((e) => {
        settle(() => subj.error(e instanceof Error ? e.message : String(e)));
      });
  }

  private async normalizeAudio(
    channels: Float32Array[],
    srcRate: number,
  ): Promise<void> {
    const mono = mixToMono(channels);
    let resampled: Float32Array;
    if (srcRate !== ML_MODEL_SAMPLE_RATE) {
      // Use OfflineAudioContext for non-blocking, browser-native resampling.
      // The old Lanczos path (resampleChannels) runs synchronously on the main
      // thread and blocks the UI for several seconds on long audio files.
      const outLength = Math.ceil((mono.length * ML_MODEL_SAMPLE_RATE) / srcRate);
      const offlineCtx = new OfflineAudioContext(1, outLength, ML_MODEL_SAMPLE_RATE);
      const inputBuf = offlineCtx.createBuffer(1, mono.length, srcRate);
      inputBuf.copyToChannel(mono, 0);
      const src = offlineCtx.createBufferSource();
      src.buffer = inputBuf;
      src.connect(offlineCtx.destination);
      src.start(0);
      const rendered = await offlineCtx.startRendering();
      resampled = new Float32Array(rendered.getChannelData(0));
    } else {
      resampled = new Float32Array(mono);
    }

    const wavBuf = HtmlAudioMechanism.encodeWav16Mono(resampled, ML_MODEL_SAMPLE_RATE);
    this._resource!.arraybuffer = wavBuf;

    // AudioInfo.sampleRate is readonly — construct a new instance with updated values.
    const oldInfo = this._resource!.info;
    const newInfo = new AudioInfo(
      oldInfo.fullname,
      'audio/wav',
      wavBuf.byteLength,
      ML_MODEL_SAMPLE_RATE,
      resampled.length,
      1,
      oldInfo.bitrate,
      { sampleRate: ML_MODEL_SAMPLE_RATE, samples: resampled.length },
    );
    newInfo.file = oldInfo.file;
    this._resource!.info = newInfo;

    this._channel = resampled;
    this._channelDataFactor = 1;
  }

  /** Fast O(n) WAV encoder — avoids BinaryByteWriter's O(n²) 1-KB-at-a-time growth. */
  private static encodeWav16Mono(
    samples: Float32Array,
    sampleRate: number,
  ): ArrayBuffer {
    const dataSize = samples.length * 2; // Int16 = 2 bytes/sample
    const buf = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // RIFF chunk descriptor
    u8.set([82, 73, 70, 70], 0); // 'RIFF'
    dv.setUint32(4, 36 + dataSize, true);
    u8.set([87, 65, 86, 69], 8); // 'WAVE'
    // fmt sub-chunk
    u8.set([102, 109, 116, 32], 12); // 'fmt '
    dv.setUint32(16, 16, true); // chunk size
    dv.setUint16(20, 1, true); // PCM
    dv.setUint16(22, 1, true); // mono
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * 2, true); // byte rate
    dv.setUint16(32, 2, true); // block align
    dv.setUint16(34, 16, true); // bits per sample
    // data sub-chunk
    u8.set([100, 97, 116, 97], 36); // 'data'
    dv.setUint32(40, dataSize, true);
    // PCM samples — one allocation, no copies
    const pcm = new Int16Array(buf, 44);
    for (let i = 0; i < samples.length; i++) {
      pcm[i] = Math.max(
        -32768,
        Math.min(32767, Math.round(samples[i] * 32767)),
      );
    }
    return buf;
  }

  override decodeAudio(resource: AudioResource) {
    const result = new Subject<{ progress: number }>();

    const format = new WavFormat();
    format.init(resource.info.name, resource.info.type, resource.arraybuffer!);
    this.decoder = new AudioDecoder(
      format,
      resource.info,
      resource.arraybuffer!,
    );

    const subj = this.decoder.onChannelDataCalculate.subscribe({
      next: (status) => {
        if (status.progress === 1 && status.result !== undefined) {
          this.decoder!.destroy();
          this._channel = status.result;
          this._channelDataFactor = this.decoder!.channelDataFactor;
          this._resource!.info.audioBufferInfo = {
            sampleRate:
              this._resource!.info.sampleRate / this._channelDataFactor,
            samples: status.result.length,
          };
          this.onChannelDataChange.next();
          this.onChannelDataChange.complete();

          subj.unsubscribe();
        }

        result.next({ progress: status.progress });
        if (status.progress === 1 && status.result !== undefined) {
          result.complete();
        }
      },
      error: (error) => {
        this.onChannelDataChange.error(error);
        result.error(error);
      },
    });

    this.decoder.started = Date.now();
    this.decoder
      .getChunkedChannelData(
        new SampleUnit(0, resource.info.sampleRate),
        new SampleUnit(
          Math.min(
            resource.info.sampleRate * 60, // chunk of 1 minute
            resource.info.duration.samples,
          ),
          resource.info.sampleRate,
        ),
      )
      .catch((error) => {
        console.error(error);
      });

    return result;
  }

  override async play(
    audioSelection: AudioSelection,
    volume: number,
    playbackRate: number,
    playOnHover: boolean,
    onPlaying: () => void,
    onEnd: () => void,
    onError: () => void,
  ) {
    this.onEnd = () => {
      this.endPlayBack();
      onEnd();
    };
    await super.play(
      audioSelection,
      volume,
      playbackRate,
      playOnHover,
      onPlaying,
      onEnd,
      onError,
    );

    if (!this._audio) {
      throw new Error(`AudioElement not initialized`);
    }

    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    this._audio.addEventListener('canplay', this.initPlayback);
    this._audio!.addEventListener('pause', this.onPlayBackChanged);
    this._audio!.addEventListener('ended', this.onPlayBackChanged);
    this._audio!.addEventListener('error', this.onPlaybackFailed);

    await this.audioContext.resume();
    this.afterAudioContextResumed();
    this._audio.onerror = onError;

    this.playPosition = audioSelection.start!.clone();
    const playPromise = this._audio.play();

    if (playPromise !== undefined) {
      try {
        await playPromise;
      } catch (error: any) {
        this._playbackEndChecker?.unsubscribe();
        if (!this.playOnHover) {
          if (error.name && error.name === 'NotAllowedError') {
            // no permission
            this.missingPermission.next();
          }

          this.statechange.error(new Error(error));
          throw new Error(error);
        }
      }
    }
  }

  private initPlayback = () => {
    if (!this._audio) {
      throw new Error(`AudioElement not initialized`);
    }
    if (!this.audioSelection) {
      throw new Error(`AudioSelection not initialized`);
    }
    if (!this._playbackRate) {
      throw new Error(`PlaybackRate not initialized`);
    }

    this.changeStatus(PlayBackStatus.PLAYING);

    this._playbackEndChecker?.unsubscribe();
    this._playbackEndChecker = timer(
      Math.round(this.audioSelection.duration.unix / this._playbackRate),
    ).subscribe({
      next: this.onEnd,
    });
  };

  override initializeSource() {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }
    if (!this._audio) {
      throw new Error(`AudioElement not initialized`);
    }

    this._source = this.audioContext.createMediaElementSource(this._audio);
  }

  override afterAudioContextResumed() {
    super.afterAudioContextResumed();

    // Firefox issue causes playBackRate working only for volume up to 1
    // create a gain node
    this._gainNode!.gain.value = this.volume!;
    this._source!.connect(this._gainNode!);
    // connect the gain node to an output destination
    this._gainNode!.connect(this.audioContext!.destination);
    this._audio!.playbackRate = this._playbackRate!;
  }

  private removeEventListeners() {
    this._audio?.removeEventListener('ended', this.onPlayBackChanged);
    this._audio?.removeEventListener('pause', this.onPlayBackChanged);
    this._audio?.removeEventListener('error', this.onPlaybackFailed);
    this._audio?.removeEventListener('canplay', this.initPlayback);
    this._gainNode?.disconnect();
    this._source?.disconnect();
    this._playbackEndChecker?.unsubscribe();
  }

  private onPlayBackChanged = () => {
    this.removeEventListeners();
    switch (this._statusRequest) {
      case PlayBackStatus.PAUSED:
        this.onPause();
        break;
      case PlayBackStatus.STOPPED:
        this.onStop();
        break;
      default:
        this.onEnded();
        break;
    }

    for (const callBacksAfterEndedElement of this.callBacksAfterEnded) {
      callBacksAfterEndedElement();
    }
    this.callBacksAfterEnded = [];
  };

  private onPlaybackFailed = (error: any) => {
    console.error(error);
  };

  private onPause = () => {
    this.changeStatus(PlayBackStatus.PAUSED);
  };

  private onStop = () => {
    this.changeStatus(PlayBackStatus.STOPPED);
  };

  private onEnded = () => {
    if (this._state === PlayBackStatus.PLAYING) {
      // audio ended normally
      this.changeStatus(PlayBackStatus.ENDED);
    }

    this._gainNode?.disconnect();
  };

  override stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._audio) {
        reject(new Error('Missing Audio instance.'));
        return;
      }
      // Remove canplay listener first to prevent initPlayback from re-arming after pause
      this._audio.removeEventListener('canplay', this.initPlayback);
      if (this._state === PlayBackStatus.PLAYING) {
        // Audio is actively playing: pause it and wait for the 'pause' DOM event
        // (fired by onPlayBackChanged) before resolving, so the audio element has
        // fully stopped before the caller proceeds.
        this._statusRequest = PlayBackStatus.STOPPED;
        this.callBacksAfterEnded.push(() => {
          resolve();
        });
        this._audio.pause();
      } else {
        // PREPARE / INITIALIZED / PAUSED / STOPPED / ENDED:
        // Audio element is not actively playing.  onPlayBackChanged is only
        // registered as a listener during play(), so calling _audio.pause() here
        // would never fire the 'pause' event (HTMLAudioElement.pause() is a no-op
        // when already paused) and the resolve callback would hang forever.
        // Nothing to stop — resolve immediately.
        resolve();
      }
    });
  }

  override pause(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._state === 'PLAYING') {
        this._statusRequest = PlayBackStatus.PAUSED;
        this.callBacksAfterEnded.push(() => {
          resolve();
        });
        this._audio?.pause();
      } else {
        reject('cant pause because not playing');
      }
    });
  }

  private endPlayBack() {
    this._statusRequest = PlayBackStatus.ENDED;
    this._audio?.pause();
  }

  /**
   * stops the decoding process.
   */
  public override stopDecoding() {
    if (this.decoder) {
      this.decoder.requeststopDecoding();
    }
  }

  public override async destroy(disconnect = false): Promise<void> {
    this.removeEventListeners();
    if (this._playbackObjectUrl) {
      URL.revokeObjectURL(this._playbackObjectUrl);
      this._playbackObjectUrl = undefined;
    }
    await super.destroy(disconnect);
    if (this._resource) {
      this._resource.arraybuffer = undefined;
    }
  }
}
