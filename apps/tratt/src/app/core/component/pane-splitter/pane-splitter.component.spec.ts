import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { PaneSplitterComponent } from './pane-splitter.component';

const KEY = 'test.pane-splitter';

@Component({
  template: `
    <div #grid>
      <tratt-pane-splitter
        [container]="grid"
        controls="rail"
        [storageKey]="storageKey()"
      />
    </div>
  `,
  imports: [PaneSplitterComponent],
})
class HostComponent {
  readonly storageKey = signal<string | undefined>(KEY);
}

describe('PaneSplitterComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let splitter: PaneSplitterComponent;
  let grid: HTMLElement;
  let el: HTMLElement;

  const create = (width = 1200) => {
    TestBed.configureTestingModule({
      imports: [
        HostComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: {} },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
        }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    grid = el.querySelector('div')!;
    // jsdom does no layout.
    Object.defineProperty(grid, 'clientWidth', {
      value: width,
      configurable: true,
    });
    fixture.detectChanges();
    splitter = fixture.debugElement.children[0].children[0].componentInstance;
  };

  const sizeVar = () => grid.style.getPropertyValue('--pane-splitter-size');
  const arrows = () =>
    el.querySelectorAll<HTMLButtonElement>('.pane-splitter__arrow');
  const separator = () => el.querySelector<HTMLElement>('[role="separator"]')!;
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { clientX, button: 0, bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    return event;
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => jest.useRealTimers());

  it('starts at its default share of the width, without animating it in', () => {
    create();
    expect(sizeVar()).toBe('300px');
    expect(grid.hasAttribute('data-pane-hidden')).toBe(false);
    expect(grid.hasAttribute('data-pane-resizing')).toBe(false);
    expect(separator().getAttribute('aria-valuenow')).toBe('300');
    expect(separator().getAttribute('aria-controls')).toBe('rail');
  });

  it('restores the remembered share', () => {
    localStorage.setItem(KEY, '0.4');
    create();
    expect(sizeVar()).toBe('480px');
  });

  it('reads a width remembered in px as its share', () => {
    localStorage.setItem(KEY, '480');
    create();
    expect(sizeVar()).toBe('480px');
  });

  it('keeps its share when the container resizes', () => {
    const observers: (() => void)[] = [];
    (globalThis as any).ResizeObserver = class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    };
    try {
      localStorage.setItem(KEY, '0.4');
      create();
      Object.defineProperty(grid, 'clientWidth', {
        value: 1500,
        configurable: true,
      });
      observers.forEach((callback) => callback());
      expect(splitter.size()).toBe(600);
      expect(localStorage.getItem(KEY)).toBe('0.4');
    } finally {
      delete (globalThis as any).ResizeObserver;
    }
  });

  it('steps down with ‹: to the default, then hidden', () => {
    localStorage.setItem(KEY, '0.5');
    create();
    arrows()[0].click();
    expect(splitter.size()).toBe(300);

    arrows()[0].click();
    fixture.detectChanges();
    expect(sizeVar()).toBe('0px');
    expect(grid.hasAttribute('data-pane-hidden')).toBe(true);
    expect(arrows()[0].disabled).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('shows a hidden pane again when its edge is clicked, and only then', () => {
    create();
    const shown = splitter.size();
    separator().click();
    expect(splitter.size()).toBe(shown);

    splitter.setSize('hidden', false);
    fixture.detectChanges();
    expect(separator().getAttribute('title')).toBe('pane_splitter.show');
    separator().click();
    expect(splitter.size()).toBe(300);
  });

  it('steps up with ›: shown at the default, then half the width', () => {
    localStorage.setItem(KEY, '0');
    create();
    arrows()[1].click();
    expect(splitter.size()).toBe(300);

    arrows()[1].click();
    fixture.detectChanges();
    expect(splitter.size()).toBe(600);
    expect(arrows()[1].disabled).toBe(true);
  });

  it('keeps the other pane its minimum', () => {
    create(800);
    splitter.setSize(10_000);
    expect(splitter.size()).toBe(800 - 384);
  });

  it('sizes from the keyboard', () => {
    create();
    const key = (key: string, shiftKey = false) =>
      separator().dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }),
      );

    key('ArrowRight');
    expect(splitter.size()).toBe(316);
    key('ArrowLeft', true);
    expect(splitter.size()).toBe(260);
    key('Home');
    expect(splitter.size()).toBe(0);
    key('ArrowRight');
    expect(splitter.size()).toBe(260);
    key('End');
    expect(splitter.size()).toBe(600);
    key('Enter');
    expect(splitter.size()).toBe(0);
    key('Enter');
    expect(splitter.size()).toBe(300);
  });

  it('lets a drag follow the pointer without the transition, and keeps the result', () => {
    create();
    const handle = el.querySelector<HTMLElement>('.pane-splitter')!;
    handle.dispatchEvent(pointer('pointerdown', 300));
    handle.dispatchEvent(pointer('pointermove', 360));
    expect(grid.hasAttribute('data-pane-resizing')).toBe(true);

    handle.dispatchEvent(pointer('pointermove', 420));
    handle.dispatchEvent(pointer('pointerup', 420));

    expect(grid.hasAttribute('data-pane-resizing')).toBe(false);
    expect(splitter.size()).toBe(420);
    // Remembered as a share of the width.
    expect(localStorage.getItem(KEY)).toBe('0.35');
  });

  it('hides the pane when dragged below half its minimum', () => {
    create();
    const handle = el.querySelector<HTMLElement>('.pane-splitter')!;
    handle.dispatchEvent(pointer('pointerdown', 340));
    handle.dispatchEvent(pointer('pointermove', 200));
    handle.dispatchEvent(pointer('pointerup', 200));
    expect(splitter.size()).toBe(260);

    handle.dispatchEvent(pointer('pointerdown', 260));
    handle.dispatchEvent(pointer('pointermove', 100));
    handle.dispatchEvent(pointer('pointerup', 100));
    expect(splitter.size()).toBe(0);
  });

  it('does not take the click that ends a drag as a click on an arrow', () => {
    create();
    const arrow = arrows()[0];
    arrow.dispatchEvent(pointer('pointerdown', 300));
    arrow.dispatchEvent(pointer('pointermove', 380));
    arrow.dispatchEvent(pointer('pointerup', 380));
    arrow.click();
    expect(splitter.size()).toBe(380);

    // A press without movement is an ordinary click.
    arrow.dispatchEvent(pointer('pointerdown', 380));
    arrow.dispatchEvent(pointer('pointerup', 380));
    arrow.click();
    expect(splitter.size()).toBe(300);
  });

  it('tells the editors to resize once an animated change has settled', () => {
    create();
    jest.useFakeTimers();
    const resized = jest.fn();
    window.addEventListener('resize', resized);

    splitter.setSize('wide');
    expect(resized).not.toHaveBeenCalled();
    const end = new Event('transitionend');
    Object.defineProperty(end, 'propertyName', {
      value: 'grid-template-columns',
    });
    grid.dispatchEvent(end);
    expect(resized).toHaveBeenCalledTimes(1);

    // Reduced motion: no transitionend, the fallback still fires once.
    splitter.setSize('default');
    jest.advanceTimersByTime(500);
    expect(resized).toHaveBeenCalledTimes(2);
    window.removeEventListener('resize', resized);
  });

  it('remembers nothing without a storage key', () => {
    create();
    fixture.componentInstance.storageKey.set(undefined);
    fixture.detectChanges();
    splitter.setSize('hidden');
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
