import { describe, expect, it } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { UnsavedRecordingModalComponent } from './unsaved-recording-modal.component';

describe('UnsavedRecordingModalComponent', () => {
  const create = () => {
    TestBed.configureTestingModule({
      imports: [
        UnsavedRecordingModalComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: {} },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: NgbActiveModal, useValue: { close: () => {} } }],
    });
    const f = TestBed.createComponent(UnsavedRecordingModalComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('leave is danger (recording is lost); export is the next step', () => {
    const buttons = Array.from(
      create().querySelectorAll('.modal-footer button'),
    );
    expect(buttons.map((b) => b.className)).toEqual([
      'btn btn-secondary',
      'btn btn-danger',
      'btn btn-next',
    ]);
  });
});
