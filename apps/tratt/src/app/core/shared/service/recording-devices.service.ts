import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const LS_AUDIO_KEY = 'octra.recording.deviceId.audio';
const LS_VIDEO_KEY = 'octra.recording.deviceId.video';

export interface RecordingDeviceLists {
  audio: MediaDeviceInfo[];
  video: MediaDeviceInfo[];
}

@Injectable({ providedIn: 'root' })
export class RecordingDevicesService {
  readonly devices$ = new BehaviorSubject<RecordingDeviceLists>({
    audio: [],
    video: [],
  });
  readonly selectedAudioId$ = new BehaviorSubject<string | null>(null);
  readonly selectedVideoId$ = new BehaviorSubject<string | null>(null);
  readonly hasPermission$ = new BehaviorSubject<boolean>(false);
  readonly selectionCleared$ = new BehaviorSubject<'audio' | 'video' | null>(
    null,
  );

  constructor() {
    this.selectedAudioId$.next(this.readStorage(LS_AUDIO_KEY));
    this.selectedVideoId$.next(this.readStorage(LS_VIDEO_KEY));

    const md = this.mediaDevices();
    if (md && typeof md.addEventListener === 'function') {
      md.addEventListener('devicechange', () => {
        void this.refresh();
      });
    }
  }

  async refresh(): Promise<void> {
    const md = this.mediaDevices();
    if (!md || typeof md.enumerateDevices !== 'function') {
      this.devices$.next({ audio: [], video: [] });
      return;
    }
    const all = await md.enumerateDevices();
    const audio = all.filter((d) => d.kind === 'audioinput');
    const video = all.filter((d) => d.kind === 'videoinput');
    this.devices$.next({ audio, video });

    if (audio.some((d) => d.label) || video.some((d) => d.label)) {
      if (!this.hasPermission$.value) this.hasPermission$.next(true);
    }

    const audioSel = this.selectedAudioId$.value;
    if (audioSel && !audio.some((d) => d.deviceId === audioSel)) {
      this.selectAudio(null);
      this.selectionCleared$.next('audio');
    }
    const videoSel = this.selectedVideoId$.value;
    if (videoSel && !video.some((d) => d.deviceId === videoSel)) {
      this.selectVideo(null);
      this.selectionCleared$.next('video');
    }
  }

  selectAudio(id: string | null): void {
    this.selectedAudioId$.next(id);
    this.writeStorage(LS_AUDIO_KEY, id);
  }

  selectVideo(id: string | null): void {
    this.selectedVideoId$.next(id);
    this.writeStorage(LS_VIDEO_KEY, id);
  }

  async requestPermissionAndEnumerate(): Promise<void> {
    const md = this.mediaDevices();
    if (!md || typeof md.getUserMedia !== 'function') return;
    const stream = await md.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    await this.refresh();
  }

  notePermissionGranted(): void {
    if (!this.hasPermission$.value) this.hasPermission$.next(true);
  }

  private mediaDevices(): MediaDevices | undefined {
    if (typeof navigator === 'undefined') return undefined;
    return navigator.mediaDevices;
  }

  private readStorage(key: string): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const v = localStorage.getItem(key);
      return v && v.length > 0 ? v : null;
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}
