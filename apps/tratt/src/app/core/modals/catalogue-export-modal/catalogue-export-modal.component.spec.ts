import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

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
    fixture.componentInstance.bundles = [
      {
        bundleId: 'bundle-1',
        name: 'a.wav',
        hasAudio: true,
        hasTranscript: true,
      },
    ];
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('says how many bundles go without audio, and only when some do', () => {
    expect(
      fixture.debugElement.query(By.css('.catalogue-export__missing-audio')),
    ).toBeNull();

    fixture.componentInstance.bundles = [
      { bundleId: 'b1', name: 'a.wav', hasAudio: false, hasTranscript: true },
      { bundleId: 'b2', name: 'b.wav', hasAudio: false, hasTranscript: true },
      // Left out (no transcript), so not counted as "saved without audio".
      { bundleId: 'b3', name: 'c.wav', hasAudio: false, hasTranscript: false },
    ];
    fixture.detectChanges();
    expect(fixture.componentInstance.withoutAudio()).toBe(2);
    expect(
      fixture.debugElement.query(By.css('.catalogue-export__missing-audio'))
        .nativeElement.textContent,
    ).toContain('workbench.catalogue_export.missing_audio');
  });

  describe('contents preview', () => {
    const files = (folder: number) =>
      fixture.debugElement
        .queryAll(By.css('.catalogue-export__node--folder'))
        [folder].queryAll(By.css('.catalogue-export__file'))
        .map((el) => (el.nativeElement as HTMLElement).textContent?.trim());

    beforeEach(() => {
      fixture.componentInstance.bundles = [
        {
          bundleId: 'b1',
          name: 'talk one.wav',
          hasAudio: true,
          hasTranscript: true,
        },
        {
          bundleId: 'b2',
          name: 'talk.mp3',
          hasAudio: false,
          hasTranscript: true,
        },
        {
          bundleId: 'b3',
          name: 'empty.wav',
          hasAudio: true,
          hasTranscript: false,
        },
      ];
      fixture.detectChanges();
    });

    it('lists the audio only for recording bundles whose audio is attached', () => {
      expect(files(0)).toEqual([
        'talk one.wav',
        'talk one.docx',
        'talk one.srt',
        'talk one.eaf',
        'talk one_annot.json',
      ]);
      expect(files(1)).toEqual([
        'talk.docx',
        'talk.srt',
        'talk.eaf',
        'talk_annot.json',
        'workbench.catalogue_export.no_audio_file',
      ]);
      const badges = fixture.debugElement
        .queryAll(By.css('.catalogue-export__badge'))
        .map((el) => (el.nativeElement as HTMLElement).textContent?.trim());
      expect(badges).toEqual([
        'workbench.catalogue_export.badge_with_audio',
        'workbench.catalogue_export.badge_transcript_only',
      ]);
    });

    it('uses the archive folder names and leaves out bundles without a transcript', () => {
      const c = fixture.componentInstance.contents();
      expect(c.folders.map((f) => f.folder)).toEqual(['talk_one', 'talk']);
      expect(c.leftOut).toEqual(['empty.wav']);
      expect(c.withAudio).toBe(1);
      expect(c.transcriptOnly).toBe(1);
      expect(c.archiveName).toMatch(/^tratt_2_/);
    });

    it('follows the ticked formats', () => {
      fixture.componentInstance.toggleConverter('DOCX');
      fixture.componentInstance.toggleConverter('WebVTT');
      fixture.detectChanges();
      expect(files(1)).toEqual([
        'talk.srt',
        'talk.eaf',
        'talk.vtt',
        'talk_annot.json',
        'workbench.catalogue_export.no_audio_file',
      ]);
    });

    it('does not offer AnnotJSON as a checkbox, since it is always written', () => {
      expect(
        fixture.componentInstance.exportableConverters.map((c) => c.name),
      ).not.toContain('AnnotJSON');
    });

    it('disables Save when no recording bundle has a transcript', () => {
      fixture.componentInstance.bundles = [
        {
          bundleId: 'b3',
          name: 'empty.wav',
          hasAudio: true,
          hasTranscript: false,
        },
      ];
      fixture.detectChanges();
      expect(
        fixture.debugElement.query(By.css('.catalogue-export__empty')),
      ).toBeTruthy();
      expect(
        fixture.debugElement.query(By.css('.catalogue-export__export'))
          .nativeElement.disabled,
      ).toBe(true);
    });
  });

  it('marks Export as the next-step button', () => {
    const btn = fixture.debugElement.query(By.css('.catalogue-export__export'))
      .nativeElement as HTMLElement;
    expect(btn.classList).toContain('btn-next');
  });

  it('calls exportBundles with the given bundle ids and checked converters on Export click', () => {
    fixture.debugElement
      .query(By.css('.catalogue-export__export'))
      .nativeElement.click();

    expect(exportService.exportBundles).toHaveBeenCalledWith(
      ['bundle-1'],
      expect.arrayContaining(['DOCX', 'SRT', 'ELAN']),
    );
  });

  it('ticks DOCX, SRT and ELAN by default, and they exist as export formats', () => {
    const component = fixture.componentInstance;
    expect([...component.checkedConverters()].sort()).toEqual([
      'DOCX',
      'ELAN',
      'SRT',
    ]);
    const exportable = component.exportableConverters.map((c) => c.name);
    for (const name of ['DOCX', 'SRT', 'ELAN']) {
      expect(exportable).toContain(name);
    }
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

  describe('Export dismisses the dialog', () => {
    it('closes the modal on Export while the export keeps running', () => {
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
      expect(activeModal.close).toHaveBeenCalled();

      fixture.componentInstance.ngOnDestroy();
      source.next({
        completedBundles: 1,
        totalBundles: 2,
        currentBundleName: 'a.wav',
        warnings: [],
      });
      expect(fixture.componentInstance.progress()).toEqual({
        completed: 1,
        total: 2,
      });
    });

    it('requires a time-aligned format', () => {
      const c = fixture.componentInstance;
      c.toggleConverter('SRT');
      c.toggleConverter('ELAN');
      fixture.detectChanges();
      expect(c.hasTimeAligned()).toBe(false);
      expect(
        fixture.debugElement.query(By.css('.catalogue-export__export'))
          .nativeElement.disabled,
      ).toBe(true);
      c.toggleConverter('WebVTT');
      expect(c.hasTimeAligned()).toBe(true);
    });
  });

  describe('object URLs', () => {
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
      for (const name of ['DOCX', 'SRT', 'ELAN']) {
        fixture.componentInstance.toggleConverter(name);
      }
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
