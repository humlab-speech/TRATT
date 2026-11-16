import { Injectable, signal, TemplateRef } from '@angular/core';

export type HeaderSlot = 'start' | 'center' | 'end';

/**
 * Lets a page lend content to the header: its centre (the data selector, per
 * profile), or, for an app bar that replaces the page's own toolbar, the
 * start (after the brand) and the end (before the header's menu).
 */
@Injectable({ providedIn: 'root' })
export class HeaderSlotService {
  private readonly slots = {
    start: signal<TemplateRef<unknown> | null>(null),
    center: signal<TemplateRef<unknown> | null>(null),
    end: signal<TemplateRef<unknown> | null>(null),
  };
  readonly start = this.slots.start.asReadonly();
  readonly center = this.slots.center.asReadonly();
  readonly end = this.slots.end.asReadonly();

  set(slot: HeaderSlot, tpl: TemplateRef<unknown>): void {
    this.slots[slot].set(tpl);
  }

  /** Only clears if `tpl` is still the registered one (route transitions overlap). */
  clear(slot: HeaderSlot, tpl: TemplateRef<unknown>): void {
    if (this.slots[slot]() === tpl) {
      this.slots[slot].set(null);
    }
  }

  setCenter(tpl: TemplateRef<unknown>): void {
    this.set('center', tpl);
  }

  clearCenter(tpl: TemplateRef<unknown>): void {
    this.clear('center', tpl);
  }
}
