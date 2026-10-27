import { Injectable, signal, TemplateRef } from '@angular/core';

/** Lets a page lend the header its centre (the data selector, per profile). */
@Injectable({ providedIn: 'root' })
export class HeaderSlotService {
  private readonly _center = signal<TemplateRef<unknown> | null>(null);
  readonly center = this._center.asReadonly();

  setCenter(tpl: TemplateRef<unknown>): void {
    this._center.set(tpl);
  }

  /** Only clears if `tpl` is still the registered one (route transitions overlap). */
  clearCenter(tpl: TemplateRef<unknown>): void {
    if (this._center() === tpl) {
      this._center.set(null);
    }
  }
}
