import { AsyncPipe, DecimalPipe, NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgbTooltipModule } from '@ng-bootstrap/ng-bootstrap';
import { Subscription } from 'rxjs';
import {
  RecordingPersistenceService,
  RecoverableSession,
} from '../../shared/service/recording-persistence.service';
import {
  RecordingResult,
  RecordingService,
  RecordingState,
} from '../../shared/service/recording.service';
import { DevicePickerComponent } from './device-picker.component';
import { RecordingRecoveryBannerComponent } from './recording-recovery-banner.component';
import { VuMeterComponent } from './vu-meter.component';

const RECOVERY_PRUNE_AGE_MS = 7 * 24 * 3600 * 1000;

type StagedResult = RecordingResult;

@Component({
  selector: 'octra-recording-panel',
  standalone: true,
  templateUrl: './recording-panel.component.html',
  styleUrls: ['./recording-panel.component.scss'],
  imports: [
    AsyncPipe,
    DecimalPipe,
    NgIf,
    NgbTooltipModule,
    TranslocoPipe,
    DevicePickerComponent,
    RecordingRecoveryBannerComponent,
    VuMeterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingPanelComponent implements OnInit, OnDestroy {
  @Output() recordingActiveChange = new EventEmitter<boolean>();
  @Output() useRecording = new EventEmitter<File>();

  staged: StagedResult | null = null;
  errorMessage: string | null = null;
  recoverable: RecoverableSession[] = [];
  selectedMode: 'audio' | 'audio+video' = 'audio';
  previewStream: MediaStream | null = null;
  showFirefoxWebmNotice = false;

  private subs = new Subscription();

  constructor(
    public service: RecordingService,
    private persistence: RecordingPersistenceService,
    private cdr: ChangeDetectorRef,
  ) {
    this.subs.add(
      this.service.state$.subscribe((s) => {
        this.recordingActiveChange.emit(
          s === 'recording' || s === 'paused' || s === 'requesting-permission',
        );
      }),
    );
    this.subs.add(
      this.service.error$.subscribe((err) => {
        this.errorMessage = err.message;
        this.cdr.markForCheck();
      }),
    );
    this.subs.add(
      this.persistence.recoverableSessions$.subscribe((list) => {
        this.recoverable = list;
        this.cdr.markForCheck();
      }),
    );
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.persistence.pruneOlderThan(RECOVERY_PRUNE_AGE_MS);
    } catch {
      // ignore prune failures
    }
    await this.persistence.refreshRecoverable();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  async onContinueRecovery(s: RecoverableSession): Promise<void> {
    this.errorMessage = null;
    try {
      await this.service.start({ mode: s.mode, sessionId: s.id });
      await this.persistence.refreshRecoverable();
    } catch {
      // surfaced via error$
    }
  }

  async onDownloadRecovery(s: RecoverableSession): Promise<void> {
    try {
      const file = await this.service.assembleSessionToFile(
        s.id,
        s.mode,
        s.mimeType,
      );
      this.triggerDownload(file);
    } catch (err) {
      this.errorMessage = (err as Error).message;
    }
  }

  async onDiscardRecovery(s: RecoverableSession): Promise<void> {
    await this.persistence.discardSession(s.id);
    await this.persistence.refreshRecoverable();
  }

  private triggerDownload(file: File): void {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async onStart(): Promise<void> {
    this.errorMessage = null;
    this.staged = null;
    this.previewStream = null;
    try {
      await this.service.start({ mode: this.selectedMode });
      if (this.selectedMode === 'audio+video') {
        const stream = this.service.getStream();
        this.previewStream = stream
          ? new MediaStream(stream.getVideoTracks())
          : null;
        const picked = this.service.currentMimeType.toLowerCase();
        this.showFirefoxWebmNotice = picked.startsWith('video/webm');
      } else {
        this.showFirefoxWebmNotice = false;
      }
      this.cdr.markForCheck();
    } catch {
      // error already surfaced via error$
    }
  }

  onSelectMode(mode: 'audio' | 'audio+video'): void {
    if (
      this.service.state$.value !== 'idle' &&
      this.service.state$.value !== 'error'
    )
      return;
    this.selectedMode = mode;
  }

  async onStop(): Promise<void> {
    try {
      this.staged = await this.service.stop();
      this.previewStream = null;
      await this.persistence.refreshRecoverable();
    } catch (err) {
      this.errorMessage = (err as Error).message;
    }
  }

  onUse(): void {
    if (!this.staged) return;
    this.useRecording.emit(this.staged.file);
    this.staged = null;
  }

  onDownload(): void {
    if (!this.staged) return;
    this.triggerDownload(this.staged.file);
  }

  async onDiscard(): Promise<void> {
    if (this.staged) {
      this.staged = null;
      return;
    }
    await this.service.discard();
  }

  isState(s: RecordingState, current: RecordingState | null): boolean {
    return current === s;
  }

  formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Three-state level indicator beside the VU meter. Always rendered while
   * recording so the surrounding buttons don't jump around when the warning
   * appears or clears. Thresholds mirror recording.service.ts:
   *   LOW_VOLUME_RAISE_DB = -50 dB → red
   *   LOW_VOLUME_CLEAR_DB = -40 dB → still orange margin
   */
  levelLightStatus(rmsDb: number): 'red' | 'orange' | 'green' {
    if (!isFinite(rmsDb) || rmsDb < -50) return 'red';
    if (rmsDb < -30) return 'orange';
    return 'green';
  }
}
