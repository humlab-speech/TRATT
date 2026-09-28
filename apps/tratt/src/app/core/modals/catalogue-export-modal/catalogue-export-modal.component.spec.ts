import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Same workaround as catalogue-export.service.spec.ts / pipeline-queue.service.spec.ts:
// CatalogueExportService is imported below only for its DI token/type (it's
// fully mocked via `useValue` in setup()), but the real module still gets
// pulled into the compile graph, and it transitively imports
// LocalTranscriptionService, which constructs its Worker via
// `new URL('...', import.meta.url)` at module scope — syntax ts-jest's
// CommonJS config cannot compile. Stub it out before anything else imports it.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { of } from 'rxjs';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';
import { CatalogueExportModalComponent } from './catalogue-export-modal.component';

describe('CatalogueExportModalComponent', () => {
  let fixture: ComponentFixture<CatalogueExportModalComponent>;
  let exportService: { exportBundles: jest.Mock };

  beforeEach(async () => {
    exportService = {
      exportBundles: jest.fn(() =>
        of({
          completedBundles: 1,
          totalBundles: 1,
          currentBundleName: 'a.wav',
          archive: new Uint8Array([1, 2, 3]),
          warnings: [],
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [CatalogueExportModalComponent],
      providers: [
        { provide: CatalogueExportService, useValue: exportService },
        { provide: NgbActiveModal, useValue: { close: jest.fn(), dismiss: jest.fn() } },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() calls this to resolve the scope
            // before it will call translate() at all — without it, the
            // pipe's internal subscribe() throws (swallowed by RxJS as an
            // unhandled error) and every transloco-piped label renders as
            // the pipe's empty initial `lastValue` instead of the key.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CatalogueExportModalComponent);
    fixture.componentInstance.bundleIds = ['bundle-1'];
    fixture.detectChanges();
  });

  it('calls exportBundles with the given bundle ids and checked converters on Export click', () => {
    fixture.debugElement
      .query(By.css('.catalogue-export__export'))
      .nativeElement.click();

    expect(exportService.exportBundles).toHaveBeenCalledWith(
      ['bundle-1'],
      expect.arrayContaining(['AnnotJSON']),
    );
  });

  it('triggers a download once the archive is produced', () => {
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL at all, so
    // jest.spyOn() (which requires the property to already exist) has
    // nothing to spy on until it's stubbed in first. revokeObjectURL is
    // exercised indirectly by ngOnDestroy() when TestBed tears the fixture
    // down at the end of this test.
    if (!URL.createObjectURL) {
      (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL =
        () => '';
    }
    if (!URL.revokeObjectURL) {
      (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL =
        () => {};
    }
    const createObjectURLSpy = jest
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    fixture.debugElement
      .query(By.css('.catalogue-export__export'))
      .nativeElement.click();
    fixture.detectChanges();

    expect(createObjectURLSpy).toHaveBeenCalled();
  });
});
