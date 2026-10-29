import {
  Directive,
  inject,
  OnDestroy,
  OnInit,
  TemplateRef,
} from '@angular/core';
import { HeaderSlotService } from '../service/header-slot.service';

/** `<ng-template trattHeaderCenter>…</ng-template>` renders in the header's centre. */
@Directive({ selector: '[trattHeaderCenter]' })
export class HeaderCenterDirective implements OnInit, OnDestroy {
  private readonly tpl = inject(TemplateRef);
  private readonly slots = inject(HeaderSlotService);

  ngOnInit(): void {
    this.slots.setCenter(this.tpl);
  }

  ngOnDestroy(): void {
    this.slots.clearCenter(this.tpl);
  }
}
