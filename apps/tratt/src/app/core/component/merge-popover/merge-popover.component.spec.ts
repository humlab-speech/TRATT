import { ElementRef } from '@angular/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { MergePopoverComponent } from './merge-popover.component';

describe('MergePopoverComponent', () => {
  const inside = {} as Node;
  const host = {
    nativeElement: { contains: (n: Node) => n === inside },
  } as unknown as ElementRef<HTMLElement>;
  let c: MergePopoverComponent;
  let dismissed: number;

  beforeEach(() => {
    jest.useFakeTimers();
    c = new MergePopoverComponent(host);
    dismissed = 0;
    c.dismiss.subscribe(() => dismissed++);
    c.ngOnInit();
  });
  afterEach(() => jest.useRealTimers());

  it('dismisses on Escape', () => {
    c.onEscape();
    expect(dismissed).toBe(1);
  });

  it('dismisses on pointerdown outside only', () => {
    c.onOutsidePointerDown({ target: inside } as unknown as Event);
    expect(dismissed).toBe(0);
    c.onOutsidePointerDown({ target: {} } as unknown as Event);
    expect(dismissed).toBe(1);
  });

  it('dismisses itself after 8 s', () => {
    jest.advanceTimersByTime(7999);
    expect(dismissed).toBe(0);
    jest.advanceTimersByTime(1);
    expect(dismissed).toBe(1);
  });

  it('clamps into the viewport', () => {
    c.x = 100000;
    c.y = 100000;
    expect(c.left).toBeLessThan(window.innerWidth);
    expect(c.top).toBeLessThan(window.innerHeight);
  });

  it('does not fire the timer after destroy', () => {
    c.ngOnDestroy();
    jest.advanceTimersByTime(10000);
    expect(dismissed).toBe(0);
  });
});
