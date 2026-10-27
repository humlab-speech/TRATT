import { TemplateRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HeaderSlotService } from './header-slot.service';

describe('HeaderSlotService', () => {
  const a = {} as TemplateRef<unknown>;
  const b = {} as TemplateRef<unknown>;
  let slots: HeaderSlotService;

  beforeEach(() => {
    slots = TestBed.inject(HeaderSlotService);
  });

  it('does not clear when another template is passed', () => {
    slots.setCenter(a);
    slots.clearCenter(b);
    expect(slots.center()).toBe(a);
  });

  it('clears when the registered template is passed', () => {
    slots.setCenter(a);
    slots.clearCenter(a);
    expect(slots.center()).toBeNull();
  });
});
