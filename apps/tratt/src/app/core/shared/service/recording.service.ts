import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { RecordingMode } from '../octra-recording-database';
import { RecordingDevicesService } from './recording-devices.service';
import {
  assemblePcmToWav,
  extensionForMime,
  pickBestAudioMime,
  pickBestVideoMime,
} from './recording-formats';
import { RecordingPersistenceService } from './recording-persistence.service';

export type RecordingState =
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error';

export interface RecordingLevels {
  peakDb: number;
  rmsDb: number;
}

export interface RecordingResult {
  file: File;
  mimeType: string;
  durationMs: number;
  mode: RecordingMode;
  sessionId: string;
  containerBlob: Blob;
}

export interface StartOptions {
  mode: RecordingMode;
  sessionId?: string;
}

const PCM_FLUSH_INTERVAL_MS = 1000;
const TIMESLICE_MS = 2000;
const LOW_VOLUME_WINDOW = 90;
const LOW_VOLUME_RAISE_DB = -50;
const LOW_VOLUME_CLEAR_DB = -40;
const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class RecordingService {
  readonly state$ = new BehaviorSubject<RecordingState>('idle');
  readonly levels$ = new BehaviorSubject<RecordingLevels>({
    peakDb: -Infinity,
    rmsDb: -Infinity,
  });
  readonly elapsed$ = new BehaviorSubject<number>(0);
  readonly lowVolumeWarning$ = new BehaviorSubject<boolean>(false);
  readonly chunkPersisted$ = new BehaviorSubject<{
    count: number;
    bytes: number;
  }>({ count: 0, bytes: 0 });
  readonly error$ = new Subject<Error>();

  private stream?: MediaStream;
  private audioCtx?: AudioContext;
  private analyser?: AnalyserNode;
  private monoDestination?: MediaStreamAudioDestinationNode;
  private workletNode?: AudioWorkletNode;
  private mediaRecorder?: MediaRecorder;

  private mode: RecordingMode = 'audio';
  private mimeType = '';
  private sessionId = '';
  private startedAt = 0;
  private containerIndex = 0;
  private pcmIndex = 0;
  private pcmPending: Float32Array[] = [];
  private pcmFlushTimer?: ReturnType<typeof setInterval>;
  private rafHandle = 0;
  private levelBuffer: number[] = [];
  private elapsedTimer?: ReturnType<typeof setInterval>;
  private totalChunkCount = 0;
  private totalChunkBytes = 0;

  constructor(
    private persistence: RecordingPersistenceService,
    private devices: RecordingDevicesService,
  ) {}

  get currentMode(): RecordingMode {
    return this.mode;
  }

  get currentMimeType(): string {
    return this.mimeType;
  }

  getStream(): MediaStream | undefined {
    return this.stream;
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.state$.value !== 'idle' && this.state$.value !== 'error') {
      throw new Error('Recording already in progress');
    }
    this.state$.next('requesting-permission');
    this.mode = opts.mode;
    this.resetCounters();

    const audioId = this.devices.selectedAudioId$.value;
    const videoId = this.devices.selectedVideoId$.value;
    const audioConstraint: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      ...(audioId ? { deviceId: { exact: audioId } } : {}),
    };
    const videoConstraint: MediaTrackConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(videoId ? { deviceId: { exact: videoId } } : {}),
    };
    const constraints: MediaStreamConstraints =
      opts.mode === 'audio+video'
        ? { audio: audioConstraint, video: videoConstraint }
        : { audio: audioConstraint, video: false };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err instanceof Error && err.name === 'OverconstrainedError') {
        if (audioId) this.devices.selectAudio(null);
        if (videoId && opts.mode === 'audio+video') {
          this.devices.selectVideo(null);
        }
      }
      this.state$.next('error');
      this.emitError(err);
      throw err;
    }

    this.devices.notePermissionGranted();
    void this.devices.refresh();

    this.mimeType =
      opts.mode === 'audio+video' ? pickBestVideoMime() : pickBestAudioMime();

    if (opts.sessionId) {
      this.sessionId = opts.sessionId;
    } else {
      this.sessionId = this.generateSessionId();
      await this.persistence.createSession({
        id: this.sessionId,
        mode: this.mode,
        mimeType: this.mimeType,
        sampleRate: this.mode === 'audio' ? 48000 : undefined,
        channels: this.mode === 'audio' ? 1 : undefined,
      });
    }

    try {
      this.setupAnalyser();
      if (this.mode === 'audio') {
        await this.setupPcmTap();
      }
      this.setupMediaRecorder();
    } catch (err) {
      await this.releaseStream();
      this.state$.next('error');
      this.emitError(err);
      throw err;
    }

    this.startedAt = Date.now();
    this.state$.next('recording');
    this.startElapsedTimer();
    this.startLevelLoop();
  }

  pause(): void {
    if (this.state$.value !== 'recording') return;
    this.mediaRecorder?.pause();
    this.state$.next('paused');
  }

  resume(): void {
    if (this.state$.value !== 'paused') return;
    this.mediaRecorder?.resume();
    this.state$.next('recording');
  }

  async stop(): Promise<RecordingResult> {
    if (this.state$.value === 'idle') {
      throw new Error('Not recording');
    }
    this.state$.next('stopping');

    const containerBlob = await this.stopMediaRecorder();
    await this.flushPcmPending();
    this.stopLevelLoop();
    this.stopElapsedTimer();
    await this.releaseStream();

    const durationMs = Date.now() - this.startedAt;

    let file: File;
    let outputMime: string;
    const ext = extensionForMime(this.mimeType || containerBlob.type);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (this.mode === 'audio') {
      const pcmChunks = await this.persistence.loadChunks(
        this.sessionId,
        'pcm',
      );
      const sampleRate = this.audioCtx?.sampleRate ?? 48000;
      const floats: Float32Array[] = [];
      for (const c of pcmChunks) {
        const buf = await c.blob.arrayBuffer();
        floats.push(new Float32Array(buf));
      }
      const wavBlob = assemblePcmToWav(floats, sampleRate, 1);
      outputMime = 'audio/wav';
      file = new File([wavBlob], `recording-${stamp}.wav`, {
        type: outputMime,
      });
    } else {
      outputMime = containerBlob.type || this.mimeType;
      file = new File([containerBlob], `recording-${stamp}.${ext}`, {
        type: outputMime,
      });
    }

    await this.persistence.finalizeSession(this.sessionId);
    this.state$.next('idle');

    return {
      file,
      mimeType: outputMime,
      durationMs,
      mode: this.mode,
      sessionId: this.sessionId,
      containerBlob,
    };
  }

  async discard(): Promise<void> {
    try {
      this.mediaRecorder?.stop();
    } catch {
      // ignore
    }
    this.stopLevelLoop();
    this.stopElapsedTimer();
    await this.releaseStream();
    if (this.sessionId) {
      await this.persistence.discardSession(this.sessionId);
    }
    this.resetCounters();
    this.state$.next('idle');
  }

  async assembleSessionToFile(
    sessionId: string,
    mode: RecordingMode,
    mimeType: string,
  ): Promise<File> {
    const ext = extensionForMime(mimeType);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (mode === 'audio') {
      const pcmChunks = await this.persistence.loadChunks(sessionId, 'pcm');
      const sampleRate = 48000;
      const floats: Float32Array[] = [];
      for (const c of pcmChunks) {
        const buf = await c.blob.arrayBuffer();
        floats.push(new Float32Array(buf));
      }
      const wav = assemblePcmToWav(floats, sampleRate, 1);
      return new File([wav], `recording-${stamp}.wav`, { type: 'audio/wav' });
    }
    const containerChunks = await this.persistence.loadChunks(
      sessionId,
      'container',
    );
    const blob = new Blob(
      containerChunks.map((c) => c.blob),
      { type: mimeType },
    );
    return new File([blob], `recording-${stamp}.${ext}`, { type: mimeType });
  }

  private setupAnalyser(): void {
    const ContextCtor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new ContextCtor();
    const source = this.audioCtx.createMediaStreamSource(this.stream!);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    source.connect(this.analyser);
    if (this.mode === 'audio+video') {
      this.monoDestination = this.audioCtx.createMediaStreamDestination();
      this.monoDestination.channelCount = 1;
      this.monoDestination.channelCountMode = 'explicit';
      source.connect(this.monoDestination);
    }
  }

  private async setupPcmTap(): Promise<void> {
    if (!this.audioCtx) return;
    await this.audioCtx.audioWorklet.addModule(
      'assets/workers/pcm-recorder.worklet.js',
    );
    const source = this.audioCtx.createMediaStreamSource(this.stream!);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-recorder');
    this.workletNode.port.onmessage = (ev: MessageEvent) => {
      const { samples } = ev.data as { samples: Float32Array };
      if (samples && samples.length) {
        this.pcmPending.push(samples);
      }
    };
    source.connect(this.workletNode);

    this.pcmFlushTimer = setInterval(
      () => void this.flushPcmPending(),
      PCM_FLUSH_INTERVAL_MS,
    );
  }

  private async flushPcmPending(): Promise<void> {
    if (this.pcmPending.length === 0) return;
    const pending = this.pcmPending;
    this.pcmPending = [];
    const total = pending.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const chunk of pending) {
      merged.set(chunk, off);
      off += chunk.length;
    }
    const blob = new Blob([merged.buffer], {
      type: 'application/octet-stream',
    });
    await this.persistence.appendChunk({
      sessionId: this.sessionId,
      index: this.pcmIndex++,
      kind: 'pcm',
      blob,
    });
    this.bumpChunkStats(blob.size);
  }

  private setupMediaRecorder(): void {
    const options: MediaRecorderOptions = this.mimeType
      ? { mimeType: this.mimeType }
      : {};
    const streamForRecording = this.monoDestination
      ? new MediaStream([
          this.monoDestination.stream.getAudioTracks()[0],
          ...this.stream!.getVideoTracks(),
        ])
      : this.stream!;
    this.mediaRecorder = new MediaRecorder(streamForRecording, options);
    if (!this.mimeType) {
      this.mimeType = this.mediaRecorder.mimeType || '';
    }
    this.mediaRecorder.ondataavailable = (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      void this.persistence
        .appendChunk({
          sessionId: this.sessionId,
          index: this.containerIndex++,
          kind: 'container',
          blob: ev.data,
        })
        .then(() => this.bumpChunkStats(ev.data.size));
    };
    this.mediaRecorder.start(TIMESLICE_MS);
  }

  private stopMediaRecorder(): Promise<Blob> {
    return new Promise<Blob>((resolve) => {
      if (!this.mediaRecorder) {
        resolve(
          new Blob([], { type: this.mimeType || 'application/octet-stream' }),
        );
        return;
      }
      const rec = this.mediaRecorder;
      const onStop = async () => {
        rec.removeEventListener('stop', onStop);
        const chunks = await this.persistence.loadChunks(
          this.sessionId,
          'container',
        );
        const blob = new Blob(
          chunks.map((c) => c.blob),
          { type: this.mimeType || 'application/octet-stream' },
        );
        resolve(blob);
      };
      rec.addEventListener('stop', onStop);
      try {
        rec.stop();
      } catch {
        resolve(new Blob([], { type: this.mimeType }));
      }
    });
  }

  private async releaseStream(): Promise<void> {
    if (this.pcmFlushTimer) {
      clearInterval(this.pcmFlushTimer);
      this.pcmFlushTimer = undefined;
    }
    try {
      this.workletNode?.disconnect();
    } catch {
      // ignore
    }
    this.workletNode = undefined;
    try {
      this.analyser?.disconnect();
    } catch {
      // ignore
    }
    this.analyser = undefined;
    try {
      this.monoDestination?.disconnect();
    } catch {
      // ignore
    }
    this.monoDestination = undefined;
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // ignore
      }
      this.audioCtx = undefined;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = undefined;
    }
  }

  private startElapsedTimer(): void {
    this.elapsed$.next(0);
    this.elapsedTimer = setInterval(() => {
      this.elapsed$.next(Date.now() - this.startedAt);
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = undefined;
    }
  }

  private startLevelLoop(): void {
    if (!this.analyser) return;
    const data = new Float32Array(this.analyser.fftSize);
    let frame = 0;
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(data);
      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
        sumSq += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSq / data.length);
      const peakDb = toDb(peak);
      const rmsDb = toDb(rms);
      this.levels$.next({ peakDb, rmsDb });
      this.updateLowVolume(rmsDb);
      frame++;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopLevelLoop(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    this.levels$.next({ peakDb: -Infinity, rmsDb: -Infinity });
    this.lowVolumeWarning$.next(false);
    this.levelBuffer = [];
  }

  private updateLowVolume(rmsDb: number): void {
    this.levelBuffer.push(rmsDb);
    if (this.levelBuffer.length > LOW_VOLUME_WINDOW) {
      this.levelBuffer.shift();
    }
    const max = Math.max(...this.levelBuffer);
    if (!this.lowVolumeWarning$.value && max < LOW_VOLUME_RAISE_DB) {
      this.lowVolumeWarning$.next(true);
    } else if (this.lowVolumeWarning$.value && rmsDb > LOW_VOLUME_CLEAR_DB) {
      this.lowVolumeWarning$.next(false);
    }
  }

  private bumpChunkStats(byteSize: number): void {
    this.totalChunkCount++;
    this.totalChunkBytes += byteSize;
    this.chunkPersisted$.next({
      count: this.totalChunkCount,
      bytes: this.totalChunkBytes,
    });
    if (
      this.totalChunkBytes >= MAX_RECORDING_BYTES &&
      this.state$.value === 'recording'
    ) {
      this.emitError(
        new Error(
          'Recording exceeded 500 MB safety cap — stopping automatically.',
        ),
      );
      void this.stop().catch(() => undefined);
    }
  }

  private resetCounters(): void {
    this.containerIndex = 0;
    this.pcmIndex = 0;
    this.pcmPending = [];
    this.totalChunkCount = 0;
    this.totalChunkBytes = 0;
    this.startedAt = 0;
    this.sessionId = '';
    this.elapsed$.next(0);
    this.lowVolumeWarning$.next(false);
    this.chunkPersisted$.next({ count: 0, bytes: 0 });
  }

  private generateSessionId(): string {
    const rand = Math.random().toString(36).slice(2, 10);
    return `rec-${Date.now()}-${rand}`;
  }

  private emitError(err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.error$.next(e);
  }
}

function toDb(value: number): number {
  if (value <= 0) return -Infinity;
  return Math.max(-60, 20 * Math.log10(value));
}
