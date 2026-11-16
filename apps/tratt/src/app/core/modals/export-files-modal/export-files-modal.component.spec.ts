import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// CatalogueExportService is mocked below, but its module is still compiled
// and transitively imports LocalTranscriptionService, which builds its Worker
// with `new URL('...', import.meta.url)` at module scope — syntax ts-jest's
// CommonJS config cannot compile. Stub it out before anything imports it.
jest.mock('../../shared/service/local-transcription.service', () => ({
  LocalTranscriptionService: class LocalTranscriptionService {},
}));
jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { TranslocoService } from '@jsverse/transloco';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { OAudiofile, SampleUnit } from '@tratt/media';
import { of, Subject } from 'rxjs';
import { AudioService, UserInteractionsService } from '../../shared/service';
import { AlertService } from '../../shared/service/alert.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import {
  CatalogueExportProgress,
  CatalogueExportService,
} from '../../shared/service/catalogue-export.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import {
  ExportBundle,
  ExportFilesModalComponent,
} from './export-files-modal.component';

function bundle(
  bundleId: string,
  name: string,
  extra: Partial<ExportBundle> = {},
): ExportBundle {
  return {
    bundleId,
    name,
    hasAudio: true,
    hasTranscript: true,
    levels: [{ name: 'OCTRA_1', segment: true }],
    ...extra,
  };
}

const zipDone: CatalogueExportProgress = {
  completedBundles: 1,
  totalBundles: 1,
  currentBundleName: null,
  download: {
    name: 'tratt_1.zip',
    bytes: new Uint8Array([1]),
    type: 'application/zip',
    archive: true,
  },
  exportedCount: 1,
  warnings: [],
};

describe('ExportFilesModalComponent', () => {
  let fixture: ComponentFixture<ExportFilesModalComponent>;
  let component: ExportFilesModalComponent;
  let exportService: {
    exportBundles: jest.Mock<(...args: any[]) => any>;
    exportTranscript: jest.Mock<(...args: any[]) => any>;
  };
  let activeModal: { close: jest.Mock; dismiss: jest.Mock };
  let annotationStore: any;
  let clicked: string[];

  beforeEach(async () => {
    (ExportFilesModalComponent as any).lastFormats = undefined;
    exportService = {
      exportBundles: jest.fn(() => of(zipDone)),
      exportTranscript: jest.fn(() => ({
        download: {
          name: 'restored.srt',
          bytes: new Uint8Array([1]),
          type: 'text/plain',
          archive: false,
        },
        warnings: [],
      })),
    };
    activeModal = { close: jest.fn(), dismiss: jest.fn() };
    annotationStore = {
      transcript: undefined,
      breakMarker: undefined,
      extractUI: () => ({}),
    };
    clicked = [];
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    (URL as any).createObjectURL = jest.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = jest.fn();

    await TestBed.configureTestingModule({
      imports: [ExportFilesModalComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CatalogueExportService, useValue: exportService },
        { provide: NgbActiveModal, useValue: activeModal },
        { provide: AudioService, useValue: { current: undefined } },
        { provide: AnnotationStoreService, useValue: annotationStore },
        { provide: AppStorageService, useValue: { language: 'en' } },
        { provide: RecordedFileService, useValue: { recordedFile: undefined } },
        {
          provide: AlertService,
          useValue: {
            showAlert: jest.fn(async () => ({ id: 1 })),
            closeAlert: jest.fn(),
          },
        },
        {
          provide: UserInteractionsService,
          useValue: { addElementFromEvent: jest.fn(), elements: [] },
        },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            // TranslocoPipe resolves the scope through this before it
            // translates anything.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ExportFilesModalComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function openFromList(
    bundles: ExportBundle[],
    tickedIds: string[] = [],
    openBundleId?: string,
  ) {
    component.bundles = bundles;
    component.tickedIds = tickedIds;
    component.openBundleId = openBundleId;
    fixture.detectChanges();
  }

  function exportButton(): HTMLButtonElement {
    return fixture.debugElement.query(By.css('.export__export')).nativeElement;
  }

  describe('scope', () => {
    const list = [
      bundle('b1', 'a.wav'),
      bundle('b2', 'b.wav'),
      bundle('b3', 'c.wav'),
    ];

    it('starts on the ticked bundles when some are ticked', () => {
      openFromList(list, ['b2', 'b3'], 'b1');
      expect(component.scope()).toBe('ticked');
      expect(component.scopedBundles().map((b) => b.bundleId)).toEqual([
        'b2',
        'b3',
      ]);
    });

    it('starts on the open bundle when none is ticked', () => {
      openFromList(list, [], 'b1');
      expect(component.scope()).toBe('open');
      expect(component.scopedBundles().map((b) => b.bundleId)).toEqual(['b1']);
    });

    it('offers all of them, and switches when chosen', () => {
      openFromList(list, [], 'b1');
      const radios = fixture.debugElement.queryAll(
        By.css('.export__scope input[type=radio]'),
      );
      expect(radios).toHaveLength(2);
      component.setScope('all');
      expect(component.scopedBundles()).toHaveLength(3);
    });

    it('asks nothing when there is only one recording bundle', () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      expect(fixture.debugElement.query(By.css('.export__scope'))).toBeNull();
    });
  });

  describe('one file or a .zip', () => {
    it('is one file for one recording in one format, without audio', () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      expect(component.includeAudio()).toBe(false);
      expect(component.contents().single?.name).toBe('a.docx');
      expect(exportButton().textContent).toContain(
        'workbench.export.download_file',
      );
    });

    it("is a .zip with Tratt's own file once a second format is ticked", () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      component.toggleFormat('SRT');
      fixture.detectChanges();
      const toc = component.contents();
      expect(toc.single).toBeUndefined();
      expect(toc.folders[0].files.map((f) => f.name)).toEqual([
        'a.docx',
        'a.srt',
        'a_annot.json',
      ]);
      expect(exportButton().textContent).toContain(
        'workbench.export.download_zip',
      );
    });

    it("does not list Tratt's own file twice when it is ticked", () => {
      openFromList([bundle('b1', 'a.wav'), bundle('b2', 'b.wav')]);
      component.toggleFormat('AnnotJSON');
      const names = component.contents().folders[0].files.map((f) => f.name);
      expect(names.filter((n) => n === 'a_annot.json')).toHaveLength(1);
    });

    it('includes the audio by default for several recordings, and lists it', () => {
      openFromList([bundle('b1', 'a.wav'), bundle('b2', 'b.wav')]);
      expect(component.includeAudio()).toBe(true);
      expect(component.contents().folders[0].files[0]).toEqual({
        name: 'a.wav',
        kind: 'audio',
      });
    });

    it('shows one file per tier for a single-tier format, one for DOCX', () => {
      openFromList(
        [
          bundle('b1', 'a.wav', {
            levels: [
              { name: 'OCTRA_1', segment: true },
              { name: 'English', segment: true },
            ],
          }),
        ],
        [],
        'b1',
      );
      component.toggleFormat('SRT');
      expect(component.contents().folders[0].files.map((f) => f.name)).toEqual([
        'a.docx',
        'a-OCTRA_1.srt',
        'a-English.srt',
        'a_annot.json',
      ]);
      expect(component.hasSeveralTiers()).toBe(true);
    });

    it('leaves out recordings without a transcript and disables Download when nothing is left', () => {
      openFromList([
        bundle('b1', 'a.wav', { hasTranscript: false, hasAudio: false }),
        bundle('b2', 'b.wav', { hasTranscript: false, hasAudio: false }),
      ]);
      expect(component.contents().leftOut).toEqual(['a.wav', 'b.wav']);
      expect(exportButton().disabled).toBe(true);
    });

    it('exports only the audio of recordings without a transcript (e.g. VISP, not yet transcribed)', () => {
      openFromList(
        [
          bundle('b1', 'a.wav', { hasTranscript: false }),
          bundle('b2', 'b.wav', { hasTranscript: false }),
        ],
        [],
        'b1',
      );
      // One recording: the audio is offered but not ticked, and the dialog
      // says so instead of only "nothing to export".
      expect(component.audioAvailable()).toBe(true);
      expect(component.contents().onlyAudio).toBe(true);
      expect(exportButton().disabled).toBe(true);

      component.setIncludeAudio(true);
      fixture.detectChanges();
      expect(component.contents().single).toEqual({
        name: 'a.wav',
        kind: 'audio',
      });

      component.setScope('all');
      expect(
        component.contents().folders.map((f) => f.files.map((x) => x.name)),
      ).toEqual([['a.wav'], ['b.wav']]);
      component.onExport();
      expect(exportService.exportBundles).toHaveBeenCalledWith(
        ['b1', 'b2'],
        ['DOCX'],
        { includeAudio: true },
      );
    });

    it('disables Download with no format ticked', () => {
      openFromList([bundle('b1', 'a.wav', { hasAudio: false })], [], 'b1');
      component.toggleFormat('DOCX');
      fixture.detectChanges();
      expect(exportButton().disabled).toBe(true);
    });
  });

  describe('format options', () => {
    it("shows a format's options only once it is ticked", () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      const optionBlocks = () =>
        fixture.debugElement.queryAll(By.css('.export__options')).length;
      expect(optionBlocks()).toBe(1); // DOCX, ticked by default
      component.toggleFormat('SRT');
      fixture.detectChanges();
      expect(optionBlocks()).toBe(2);
    });

    it('offers "group by tier" only when a recording has several tiers', () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      const docx = component.exportableConverters.find(
        (c) => c.name === 'DOCX',
      )!;
      expect(component.optionsOf(docx).map((o) => o.key)).not.toContain(
        'groupByTier',
      );
    });
  });

  describe('exporting from the list', () => {
    it('exports the scoped bundles with the ticked formats and the audio choice, then closes', () => {
      openFromList([
        bundle('b1', 'a.wav'),
        bundle('b2', 'b.wav', { hasTranscript: false }),
      ]);
      component.toggleFormat('SRT');
      component.setIncludeAudio(false);
      component.onExport();

      expect(exportService.exportBundles).toHaveBeenCalledWith(
        ['b1'],
        ['DOCX', 'SRT'],
        { includeAudio: false },
      );
      expect(activeModal.close).toHaveBeenCalled();
      expect(clicked).toEqual(['tratt_1.zip']);
    });

    it('remembers the formats for the next time the dialog opens', () => {
      openFromList([bundle('b1', 'a.wav')], [], 'b1');
      component.toggleFormat('ELAN');
      component.onExport();
      const next = TestBed.createComponent(ExportFilesModalComponent);
      expect([...next.componentInstance.checkedFormats()].sort()).toEqual([
        'DOCX',
        'ELAN',
      ]);
    });

    it('does not start a second export while one is running', () => {
      const running = new Subject<CatalogueExportProgress>();
      exportService.exportBundles.mockReturnValue(running);
      openFromList([bundle('b1', 'a.wav'), bundle('b2', 'b.wav')]);
      component.onExport();
      component.onExport();
      expect(exportService.exportBundles).toHaveBeenCalledTimes(1);
      running.next(zipDone);
      running.complete();
      expect(component.isExporting()).toBe(false);
    });
  });

  describe('exporting the transcript on screen (navbar)', () => {
    function openFromNavbar() {
      const oAudioFile = new OAudiofile();
      oAudioFile.name = 'restored.wav';
      annotationStore.transcript = {
        levels: [{ name: 'OCTRA_1', type: 'SEGMENT' }],
        serialize: jest.fn(() => ({ serialized: true })),
      };
      component.media = {
        oAudioFile,
        sampleRate: 16000,
        duration: new SampleUnit(48000, 16000),
      };
      fixture.detectChanges();
      return oAudioFile;
    }

    it('names the file, offers no scope or audio, and shows the extras', () => {
      openFromNavbar();
      expect(component.audioFileName).toBe('restored.wav');
      expect(component.listMode()).toBe(false);
      expect(component.audioAvailable()).toBe(false);
      expect(fixture.debugElement.query(By.css('.export__scope'))).toBeNull();
      expect(component.showMore()).toBe(true);
    });

    it('converts against the passed media and downloads at once', () => {
      const oAudioFile = openFromNavbar();
      component.onExport();
      expect(annotationStore.transcript.serialize).toHaveBeenCalledWith(
        'restored.wav',
        16000,
        component.media!.duration,
      );
      expect(exportService.exportTranscript).toHaveBeenCalledWith(
        { serialized: true },
        oAudioFile,
        ['DOCX'],
        '<P>',
      );
      expect(clicked).toEqual(['restored.srt']);
      expect(activeModal.close).toHaveBeenCalled();
    });

    it('names the protocol file after the recording', () => {
      openFromNavbar();
      component.getProtocol();
      expect(component.protocol?.download).toBe('restored.json');
    });
  });
});
