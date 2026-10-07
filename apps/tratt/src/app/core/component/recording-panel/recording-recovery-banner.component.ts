import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RecoverableSession } from '../../shared/service/recording-persistence.service';

@Component({
  selector: 'tratt-recording-recovery-banner',
  standalone: true,
  template: `
    @for (s of sessions; track s) {
      <div
        class="alert alert-warning py-2 px-3 mt-2 mb-0"
        role="alert"
        >
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span>
            <strong>{{ 'recording.recovery.title' | transloco }}</strong>
            {{
            'recording.recovery.found'
            | transloco
            : {
            mode: s.mode,
            started: (s.startedAt | date: 'short'),
            seconds: (s.durationMs / 1000 | number: '1.0-0'),
            mb: (s.totalBytes / 1048576 | number: '1.0-1'),
          }
          }}
        </span>
        <span class="ms-auto"></span>
        @if (s.mode === 'audio') {
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="continueSession.emit(s)"
            >
            {{ 'recording.recovery.continue' | transloco }}
          </button>
        }
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          (click)="downloadSession.emit(s)"
          >
          {{ 'recording.recovery.download partial' | transloco }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-danger"
          (click)="discardSession.emit(s)"
          >
          {{ 'recording.recovery.discard' | transloco }}
        </button>
      </div>
    </div>
    }
    `,
  imports: [DatePipe, DecimalPipe, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordingRecoveryBannerComponent {
  @Input() sessions: RecoverableSession[] = [];
  @Output() continueSession = new EventEmitter<RecoverableSession>();
  @Output() downloadSession = new EventEmitter<RecoverableSession>();
  @Output() discardSession = new EventEmitter<RecoverableSession>();
}
