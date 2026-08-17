import { NgClass } from '@angular/common';
import { Component, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  NgbActiveModal,
  NgbModalOptions,
  NgbPopover,
  NgbTooltip,
} from '@ng-bootstrap/ng-bootstrap';
import { Converter, ExportCategory, ExportResult } from '@tratt/annotation';
import {
  fadeInExpandOnEnterAnimation,
  fadeOutCollapseOnLeaveAnimation,
} from 'angular-animations';
import { timer } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { NavbarService } from '../../component/navbar/navbar.service';
import { AudioService, UserInteractionsService } from '../../shared/service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { RecordedFileService } from '../../shared/service/recorded-file.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { NamingDragAndDropComponent } from '../../tools/naming-drag-and-drop/naming-drag-and-drop.component';
import { TableConfiguratorComponent } from '../../tools/table-configurator/table-configurator.component';
import { TrattModal } from '../types';

@Component({
  selector: 'tratt-export-files-modal',
  templateUrl: './export-files-modal.component.html',
  styleUrls: ['./export-files-modal.component.scss'],
  animations: [
    fadeInExpandOnEnterAnimation(),
    fadeOutCollapseOnLeaveAnimation(),
  ],
  imports: [
    NgClass,
    NgbPopover,
    NgbTooltip,
    FormsModule,
    TableConfiguratorComponent,
    TranslocoPipe,
  ],
})
export class ExportFilesModalComponent extends TrattModal implements OnInit {
  public static options: NgbModalOptions = {
    size: 'xl',
    keyboard: true,
    backdrop: true,
    scrollable: true,
  };

  AppInfo = AppInfo;
  public exportStates: string[] = [];
  public preparing = {
    name: '',
    preparing: false,
  };
  public parentformat: {
    download: string;
    uri: SafeUrl;
  } = {
    download: '',
    uri: '',
  };

  public tools = {
    audioCutting: {
      opened: false,
      selectedMethod: 'client',
      progress: 0,
      result: {
        url: undefined,
        filename: '',
      },
      status: 'idle',
      message: '',
      progressbarType: 'info',
      showConfigurator: false,
      subscriptionIDs: [-1, -1, -1],
      exportFormats: [
        {
          label: 'TextTable',
          value: 'textTable',
          selected: true,
        },
        {
          label: 'JSON',
          value: 'json',
          selected: true,
        },
      ],
      clientStreamHelper: undefined,
      zippingSpeed: -1,
      cuttingSpeed: -1,
      cuttingTimeLeft: 0,
      timeLeft: 0,
      wavFormat: undefined,
    },
    tableConfigurator: {
      opened: false,
      numberOfColumns: 3,
      columns: [],
      result: {
        url: undefined,
        filename: '',
      },
    },
  };

  @ViewChild('namingConvention', { static: false })
  namingConvention!: NamingDragAndDropComponent;
  @ViewChild('tableConfigurator', { static: false })
  tableConfigurator!: TableConfiguratorComponent;

  navbarService!: NavbarService;
  uiService!: UserInteractionsService;

  public selectedLevel = 0;
  public selectedLevels: number[] = [0];

  converters: Converter[] = [];

  constructor(
    private sanitizer: DomSanitizer,
    private audio: AudioService,
    public annotationStoreService: AnnotationStoreService,
    private appStorage: AppStorageService,
    protected override activeModal: NgbActiveModal,
    public recordedFileService: RecordedFileService,
  ) {
    super('ExportFilesModalComponent', activeModal);
    this.converters = AppInfo.converters;

    const map = new Map<
      ExportCategory,
      { converter: Converter; index: number }[]
    >();
    for (const cat of this.categoryOrder) map.set(cat, []);
    this.converters.forEach((c, i) => {
      if (c.conversion.export && map.has(c.category)) {
        map.get(c.category)!.push({ converter: c, index: i });
      }
    });
    this.convertersByCategory = map;
  }

  ngOnInit() {
    this.uiService.addElementFromEvent(
      'export',
      {
        value: 'opened',
      },
      Date.now(),
      this.audio.audioManager.playPosition,
      undefined,
      undefined,
      undefined,
      'modals',
    );

    const breakMarkerCode =
      this.annotationStoreService.breakMarker?.code ?? '<P>';
    const uiLanguage = this.appStorage.language ?? 'en';
    for (const converter of this.converters) {
      this.exportStates.push('close');
      if (converter.options && 'breakMarkerCode' in converter.options) {
        converter.options.breakMarkerCode = breakMarkerCode;
      }
      if (converter.options && 'uiLanguage' in converter.options) {
        (converter.options as any).uiLanguage = uiLanguage;
      }
    }

    if (this.tableConfigurator) {
      this.tableConfigurator.updateAllTableCells();
    }
  }

  public override close() {
    this.uiService.addElementFromEvent(
      'export',
      {
        value: 'closed',
      },
      Date.now(),
      this.audio.audiomanagers[0].playPosition,
      undefined,
      undefined,
      undefined,
      'modals',
    );

    return super.close();
  }

  onLineClick(converter: Converter, index: number) {
    if (
      converter.multitiers ||
      (!converter.multitiers &&
        this.annotationStoreService.transcript!.levels.length === 1)
    ) {
      this.updateParentFormat(converter);
    } else if (converter.multiTierExport) {
      this.updateParentFormat(converter);
    } else {
      this.updateParentFormat(converter, this.selectedLevel);
    }
    this.toggleLine(index);
  }

  isLevelSelected(idx: number): boolean {
    return this.selectedLevels.includes(idx);
  }

  toggleLevelSelection(converter: Converter, idx: number, checked: boolean) {
    if (checked) {
      if (!this.selectedLevels.includes(idx)) {
        this.selectedLevels = [...this.selectedLevels, idx].sort(
          (a, b) => a - b,
        );
      }
    } else {
      this.selectedLevels = this.selectedLevels.filter((i) => i !== idx);
    }
    if (this.selectedLevels.length === 0) {
      this.selectedLevels = [0];
    }
    this.updateParentFormat(converter);
  }

  sanitize(url: string): SafeUrl {
    return this.sanitizer.bypassSecurityTrustUrl(url);
  }

  toggleLine(index: number) {
    for (let i = 0; i < this.exportStates.length; i++) {
      if (this.exportStates[i] === 'active') {
        this.exportStates[i] = 'close';
      }
    }

    if (index < this.exportStates.length) {
      if (this.exportStates[index] === 'active') {
        this.exportStates[index] = 'inactive';
      } else {
        this.exportStates[index] = 'active';
      }
    }
  }

  private setParentFormatURI(url: string) {
    if (this.parentformat.uri !== undefined) {
      window.URL.revokeObjectURL(this.parentformat!.uri.toString());
    }
    this.parentformat.uri = this.sanitize(url);
  }

  onSelectionChange(converter: Converter, value: any) {
    if (value !== '') {
      this.updateParentFormat(converter, value);
    }
  }

  updateParentFormat(converter: Converter, levelnum?: number) {
    if (levelnum === undefined && !converter.multitiers) {
      levelnum = 0;
    }
    const levelnums = converter.multiTierExport
      ? this.selectedLevels
      : undefined;

    if (!this.preparing.preparing) {
      if (this.annotationStoreService.transcript?.levels === undefined) {
        console.error(`annotation is undefined!`);
        return;
      }
      const oannotjson = this.annotationStoreService.transcript?.serialize(
        this.audio.audioManager.resource.info.fullname,
        this.audio.audioManager.sampleRate,
        this.audio.audioManager.resource.info.duration,
      );
      this.preparing = {
        name: converter.name,
        preparing: true,
      };
      this.subscribe(timer(300), () => {
        if (converter.name === 'BundleJSON') {
          // only this converter needs an array buffer
          /*
            this.transcriptionService.audiofile.arraybuffer =
              this.transcriptionService.audioManager.resource.arraybuffer!;
             */
        }

        const oAudioFile = this.audio.audioManager.resource.getOAudioFile();
        const result: ExportResult = converter.export(
          oannotjson,
          oAudioFile,
          levelnum,
          levelnums,
        );

        if (!result.error && result.file) {
          this.parentformat.download = result.file.name;

          if (this.parentformat.uri !== undefined) {
            window.URL.revokeObjectURL(this.parentformat.uri.toString());
          }
          const test = new File(
            [result.file.content as BlobPart],
            result.file.name,
            result.file.encoding === 'binary'
              ? { type: result.file.type }
              : undefined,
          );
          this.setParentFormatURI(window.URL.createObjectURL(test));
          this.preparing = {
            name: converter.name,
            preparing: false,
          };
        } else {
          console.error(`Annotation conversion error: ${result.error}`);
          this.preparing = {
            name: converter.name,
            preparing: false,
          };
        }
      });
    }
  }

  getProtocol() {
    this.preparing = {
      name: 'Protocol',
      preparing: true,
    };
    this.parentformat.download =
      this.audio.audioManager.resource.info.name + '.json';

    if (this.parentformat.uri !== undefined) {
      window.URL.revokeObjectURL(this.parentformat.uri.toString());
    }
    const json = new File(
      [
        JSON.stringify(
          this.annotationStoreService.extractUI(this.uiService.elements),
          undefined,
          2,
        ),
      ],
      this.parentformat.download,
    );
    this.setParentFormatURI(window.URL.createObjectURL(json));
    this.preparing = {
      name: 'Protocol',
      preparing: false,
    };
  }

  onDownloadClick(i: number) {
    this.subscribe(timer(500), () => {
      this.exportStates[i] = 'inactive';
    });
  }

  onHidden() {
    for (let i = 0; i < this.exportStates.length; i++) {
      this.exportStates[i] = 'inactive';
    }

    this.tools.audioCutting.status = 'idle';
    this.tools.audioCutting.progressbarType = 'idle';
    this.tools.audioCutting.progressbarType = 'idle';
    this.tools.audioCutting.progress = 0;
    this.tools.audioCutting.result.filename = '';
    this.tools.audioCutting.result.url = undefined;
    this.tools.audioCutting.opened = false;
    this.tools.audioCutting.subscriptionIDs = [-1, -1];
    this.subscriptionManager.destroy();

    if (this.tools.audioCutting.result.url !== undefined) {
      window.URL.revokeObjectURL(this.tools.audioCutting.result.url);
    }

    if (this.parentformat.uri !== undefined) {
      const url = this.parentformat.uri.toString();
      window.URL.revokeObjectURL(url);
    }
  }

  readonly categoryLabels: Record<ExportCategory, string> = {
    general:
      'General output formats (Only SRT support re-uploading to this app when you want to continue your work)',
    linguistic: 'Linguistic formats (All support re-uploading to this app)',
    specialist:
      'Specialist technical formats (All support re-uploading to this app)',
  };

  readonly categoryOrder: ExportCategory[] = [
    'general',
    'linguistic',
    'specialist',
  ];

  readonly convertersByCategory: Map<
    ExportCategory,
    { converter: Converter; index: number }[]
  >;

  onPlaintextTimestampOptionChanged(converter: Converter) {
    this.updateParentFormat(converter, this.selectedLevel);
  }

  onDocxOptionChanged(converter: Converter) {
    this.updateParentFormat(converter, this.selectedLevel);
  }

  onOdtOptionChanged(converter: Converter) {
    this.updateParentFormat(converter, this.selectedLevel);
  }

  onSRTOptionChanged(converter: Converter) {
    this.updateParentFormat(converter, this.selectedLevel);
  }

  onWebVTTOptionChanged(converter: Converter) {
    this.updateParentFormat(converter, this.selectedLevel);
  }
}
