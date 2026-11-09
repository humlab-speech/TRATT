import { ElementRef } from '@angular/core';
import { FastbarComponent } from './taskbar.component';

/**
 * The fastbar's buttons need `full` px with labels and hints, `noKbd` px
 * without the hints and `icons` px as icons only; the host has `available`.
 */
function fastbar(
  available: number,
  widths = { full: 400, noKbd: 300, icons: 100 },
) {
  const host = document.createElement('tratt-fastbar');
  const bar = document.createElement('div');
  const buttons = document.createElement('div');
  bar.appendChild(buttons);
  host.appendChild(bar);
  let width = available;
  Object.defineProperty(host, 'clientWidth', { get: () => width });
  Object.defineProperty(buttons, 'scrollWidth', {
    get: () =>
      bar.classList.contains('fastbar--icons')
        ? widths.icons
        : bar.classList.contains('fastbar--no-kbd')
          ? widths.noKbd
          : widths.full,
  });
  const component = new FastbarComponent(
    {} as never,
    {} as never,
    {} as never,
    new ElementRef(host),
  );
  Object.assign(component, {
    bar: new ElementRef(bar),
    buttons: new ElementRef(buttons),
  });
  return {
    component,
    bar,
    setAvailable: (w: number) => (width = w),
  };
}

const steps = (bar: HTMLElement) =>
  ['fastbar--no-kbd', 'fastbar--icons'].filter((c) =>
    bar.classList.contains(c),
  );

describe('FastbarComponent.fit', () => {
  it('shows everything when it fits', () => {
    const { component, bar } = fastbar(500);
    component.fit();
    expect(steps(bar)).toEqual([]);
  });

  it('drops the keyboard hints first', () => {
    const { component, bar } = fastbar(350);
    component.fit();
    expect(steps(bar)).toEqual(['fastbar--no-kbd']);
  });

  it('then shows icons only', () => {
    const { component, bar } = fastbar(150);
    component.fit();
    expect(steps(bar)).toEqual(['fastbar--no-kbd', 'fastbar--icons']);
  });

  it('expands again when room comes back', () => {
    const { component, bar, setAvailable } = fastbar(150);
    component.fit();
    setAvailable(500);
    component.fit();
    expect(steps(bar)).toEqual([]);
  });

  it('stays icons-only when even that does not fit', () => {
    const { component, bar } = fastbar(50);
    component.fit();
    expect(steps(bar)).toEqual(['fastbar--no-kbd', 'fastbar--icons']);
  });
});
