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

  it('keeps the start, centre and end slots apart', () => {
    slots.set('start', a);
    slots.set('end', b);
    expect(slots.start()).toBe(a);
    expect(slots.end()).toBe(b);
    expect(slots.center()).toBeNull();

    slots.clear('start', b);
    expect(slots.start()).toBe(a);
    slots.clear('start', a);
    slots.clear('end', b);
    expect(slots.start()).toBeNull();
    expect(slots.end()).toBeNull();
  });
});
