import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

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
import { of, Subject } from 'rxjs';
import { CatalogueExportService } from '../../shared/service/catalogue-export.service';
import { CatalogueExportModalComponent } from './catalogue-export-modal.component';

describe('CatalogueExportModalComponent', () => {
  let fixture: ComponentFixture<CatalogueExportModalComponent>;
  let exportService: { exportBundles: jest.Mock };
  let activeModal: { close: jest.Mock; dismiss: jest.Mock };

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
    activeModal = { close: jest.fn(), dismiss: jest.fn() };

    if (!URL.createObjectURL) {
      (URL as { createObjectURL?: (obj: Blob) => string }).createObjectURL =
        () => '';
    }
    if (!URL.revokeObjectURL) {
      (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL =
        () => undefined;
    }

    await TestBed.configureTestingModule({
      imports: [CatalogueExportModalComponent],
      providers: [
        { provide: CatalogueExportService, useValue: exportService },
        { provide: NgbActiveModal, useValue: activeModal },
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

  afterEach(() => {
    jest.restoreAllMocks();
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
        () => undefined;
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

  // Finding #4 (final whole-branch review fix wave): Cancel used to leave a
  // running export subscribed in the background, still writing to signals
  // on a (soon-to-be) destroyed component. A manually-controlled Subject
  // (rather than of(...)) lets this test emit AFTER close() is called.
  describe('Finding #4: close() unsubscribes the in-flight export', () => {
    it('a next emission from the source observable after close() has no effect', () => {
      const source = new Subject<{
        completedBundles: number;
        totalBundles: number;
        currentBundleName: string | null;
        archive?: Uint8Array;
        warnings: string[];
      }>();
      exportService.exportBundles.mockReturnValue(source.asObservable());

      fixture.debugElement
        .query(By.css('.catalogue-export__export'))
        .nativeElement.click();
      fixture.detectChanges();

      fixture.componentInstance.close();
      expect(activeModal.close).toHaveBeenCalled();

      source.next({
        completedBundles: 1,
        totalBundles: 2,
        currentBundleName: 'a.wav',
        warnings: [],
      });

      expect(fixture.componentInstance.progress()).toBeNull();
      expect(fixture.componentInstance.downloadUrl()).toBeNull();
    });

    it('ngOnDestroy (Esc/backdrop dismiss) also unsubscribes, even when close() was never called', () => {
      const source = new Subject<{
        completedBundles: number;
        totalBundles: number;
        currentBundleName: string | null;
        archive?: Uint8Array;
        warnings: string[];
      }>();
      exportService.exportBundles.mockReturnValue(source.asObservable());

      fixture.debugElement
        .query(By.css('.catalogue-export__export'))
        .nativeElement.click();
      fixture.componentInstance.ngOnDestroy();

      source.next({
        completedBundles: 1,
        totalBundles: 2,
        currentBundleName: 'a.wav',
        warnings: [],
      });

      expect(fixture.componentInstance.progress()).toBeNull();
    });

    it('revokes a prior object URL before setting a new one', () => {
      jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:first');
      const revokeSpy = jest.spyOn(URL, 'revokeObjectURL');

      fixture.debugElement
        .query(By.css('.catalogue-export__export'))
        .nativeElement.click();
      expect(fixture.componentInstance.downloadUrl()).toBe('blob:first');

      jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:second');
      fixture.debugElement
        .query(By.css('.catalogue-export__export'))
        .nativeElement.click();

      expect(revokeSpy).toHaveBeenCalledWith('blob:first');
      expect(fixture.componentInstance.downloadUrl()).toBe('blob:second');
    });
  });

  // Bundled fix: disable Export when nothing is checked, or while an export
  // is already in progress (prevents a manifests-only zip and prevents
  // double-clicking starting two concurrent exports/downloads).
  describe('Export button disabled states', () => {
    it('is disabled once every converter is unchecked', () => {
      fixture.componentInstance.toggleConverter('AnnotJSON');
      fixture.detectChanges();

      const button = fixture.debugElement.query(
        By.css('.catalogue-export__export'),
      ).nativeElement as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('is disabled while an export is in progress, and re-enabled once it settles', () => {
      const source = new Subject<{
        completedBundles: number;
        totalBundles: number;
        currentBundleName: string | null;
        archive?: Uint8Array;
        warnings: string[];
      }>();
      exportService.exportBundles.mockReturnValue(source.asObservable());

      const button = fixture.debugElement.query(
        By.css('.catalogue-export__export'),
      ).nativeElement as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBe(true);

      source.next({
        completedBundles: 1,
        totalBundles: 1,
        currentBundleName: 'a.wav',
        archive: new Uint8Array([1]),
        warnings: [],
      });
      source.complete();
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
    });

    it('a click while already exporting does not start a second concurrent export', () => {
      const source = new Subject<{
        completedBundles: number;
        totalBundles: number;
        currentBundleName: string | null;
        archive?: Uint8Array;
        warnings: string[];
      }>();
      exportService.exportBundles.mockReturnValue(source.asObservable());

      fixture.componentInstance.onExport();
      fixture.componentInstance.onExport();

      expect(exportService.exportBundles).toHaveBeenCalledTimes(1);
    });
  });

  // Bundled fix: binds the two previously-unused i18n keys.
  describe('i18n hint/done bindings', () => {
    it('shows the all_bundles_hint text instead of bundles_label when wasAllBundlesDefault is true', () => {
      fixture.componentInstance.wasAllBundlesDefault = true;
      fixture.detectChanges();

      const hint = fixture.debugElement.query(
        By.css('.catalogue-export__all-hint'),
      );
      expect(hint).toBeTruthy();
    });

    it('does not show the hint when wasAllBundlesDefault is false (default)', () => {
      fixture.detectChanges();
      const hint = fixture.debugElement.query(
        By.css('.catalogue-export__all-hint'),
      );
      expect(hint).toBeFalsy();
    });

    it('shows the done message instead of the progress line once the archive-bearing emission arrives', () => {
      fixture.debugElement
        .query(By.css('.catalogue-export__export'))
        .nativeElement.click();
      fixture.detectChanges();

      const done = fixture.debugElement.query(
        By.css('.catalogue-export__done'),
      );
      const progressEl = fixture.debugElement.query(
        By.css('.catalogue-export__progress'),
      );
      expect(done).toBeTruthy();
      expect(progressEl).toBeFalsy();
    });
  });
});
