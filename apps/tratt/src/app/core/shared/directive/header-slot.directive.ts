import {
  Directive,
  inject,
  OnDestroy,
  OnInit,
  TemplateRef,
} from '@angular/core';
import { HeaderSlotService } from '../service/header-slot.service';

/** `<ng-template trattHeaderStart>…</ng-template>` renders in the header, after the brand. */
@Directive({ selector: '[trattHeaderStart]' })
export class HeaderStartDirective implements OnInit, OnDestroy {
  private readonly tpl = inject(TemplateRef);
  private readonly slots = inject(HeaderSlotService);

  ngOnInit(): void {
    this.slots.set('start', this.tpl);
  }

  ngOnDestroy(): void {
    this.slots.clear('start', this.tpl);
  }
}

/** `<ng-template trattHeaderEnd>…</ng-template>` renders in the header, before its menu. */
@Directive({ selector: '[trattHeaderEnd]' })
export class HeaderEndDirective implements OnInit, OnDestroy {
  private readonly tpl = inject(TemplateRef);
  private readonly slots = inject(HeaderSlotService);

  ngOnInit(): void {
    this.slots.set('end', this.tpl);
  }

  ngOnDestroy(): void {
    this.slots.clear('end', this.tpl);
  }
}
