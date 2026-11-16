import { NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { HelpModalComponent } from '../../modals/help-modal/help-modal.component';
import { TrattModalService } from '../../modals/tratt-modal.service';
import { AppStorageService } from '../../shared/service/appstorage.service';
import { ApplicationStoreService } from '../../store/application/application-store.service';

/**
 * What the inline fastbar gives up to fit its space, in order: first the
 * keyboard hints (Alt+8), then the labels (icons only; the labels stay for
 * screen readers, and the buttons' titles show them on hover).
 */
export const FASTBAR_COMPACT_CLASSES = [
  'fastbar--no-kbd',
  'fastbar--icons',
] as const;

@Component({
  selector: 'tratt-fastbar',
  imports: [NgTemplateOutlet],
  templateUrl: './taskbar.component.html',
  styleUrls: ['./taskbar.component.scss'],
})
export class FastbarComponent implements AfterViewInit, OnDestroy {
  @Input() variant: 'stacked' | 'inline' = 'stacked';
  @Input() buttonLabels: any = {
    shortcuts: 'Shortcuts',
    overview: 'Overview',
    help: 'Help',
  };

  @Output() shortcutbtnclicked: EventEmitter<void> = new EventEmitter<void>();
  @Output() overviewbtnclicked: EventEmitter<void> = new EventEmitter<void>();

  @ViewChild('bar') private bar?: ElementRef<HTMLElement>;
  @ViewChild('buttons') private buttons?: ElementRef<HTMLElement>;
  private resizeObserver?: ResizeObserver;

  constructor(
    public appStorage: AppStorageService,
    private appStoreService: ApplicationStoreService,
    private modalService: TrattModalService,
    private host: ElementRef<HTMLElement>,
  ) {}

  ngAfterViewInit(): void {
    if (this.variant !== 'inline' || typeof ResizeObserver === 'undefined') {
      return;
    }
    // The host's width is what the surrounding bar leaves over (the editor
    // tabs come first); the buttons' width changes with language and labels.
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.host.nativeElement);
    if (this.buttons) this.resizeObserver.observe(this.buttons.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  /**
   * Takes the least compact step whose buttons fit the host's width. Done on
   * the DOM directly so each step is measured at once (no change detection in
   * between); it ends in the same state for the same width, so the observer
   * does not loop.
   */
  fit(): void {
    const bar = this.bar?.nativeElement;
    const buttons = this.buttons?.nativeElement;
    if (!bar || !buttons) return;
    const available = this.host.nativeElement.clientWidth;
    for (let step = 0; step <= FASTBAR_COMPACT_CLASSES.length; step++) {
      FASTBAR_COMPACT_CLASSES.forEach((cls, i) =>
        bar.classList.toggle(cls, i < step),
      );
      if (buttons.scrollWidth <= available) return;
    }
  }

  openHelpModal() {
    this.appStoreService.setShortcutsEnabled(false);
    this.modalService
      .openModal(HelpModalComponent, HelpModalComponent.options)
      .then(() => {
        this.appStoreService.setShortcutsEnabled(true);
      })
      .catch(() => {
        this.appStoreService.setShortcutsEnabled(true);
      });
  }
}
