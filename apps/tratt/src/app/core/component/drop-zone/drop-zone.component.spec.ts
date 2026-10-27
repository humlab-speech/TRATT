import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DropZoneComponent } from './drop-zone.component';

const dzScss = readFileSync(
  join(__dirname, 'drop-zone.component.scss'),
  'utf8',
);
const trattDir = join(__dirname, '../tratt-dropzone');
const tdHtml = readFileSync(
  join(trattDir, 'tratt-dropzone.component.html'),
  'utf8',
);
const tdScss = readFileSync(
  join(trattDir, 'tratt-dropzone.component.scss'),
  'utf8',
);

describe('DropZoneComponent drag-over state', () => {
  function setup() {
    const fixture = TestBed.createComponent(DropZoneComponent);
    fixture.detectChanges();
    const zone: HTMLElement = fixture.nativeElement.querySelector('.dropzone');
    return { fixture, zone };
  }
  const dragEvent = (type: string) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    (e as any).dataTransfer = { dropEffect: '', files: [] };
    return e;
  };

  it('toggles dropzone--over on dragover, dragleave and drop', () => {
    const { fixture, zone } = setup();
    expect(zone.classList).not.toContain('dropzone--over');

    zone.dispatchEvent(dragEvent('dragover'));
    fixture.detectChanges();
    expect(zone.classList).toContain('dropzone--over');

    zone.dispatchEvent(dragEvent('dragleave'));
    fixture.detectChanges();
    expect(zone.classList).not.toContain('dropzone--over');

    zone.dispatchEvent(dragEvent('dragover'));
    fixture.detectChanges();
    zone.dispatchEvent(dragEvent('drop'));
    fixture.detectChanges();
    expect(zone.classList).not.toContain('dropzone--over');
  });
});

describe('dropzone styles on tokens', () => {
  it('drop-zone scss uses profile tokens', () => {
    expect(dzScss).toContain('2px dashed var(--tratt-border-control)');
    expect(dzScss).toContain('var(--sb-blue-tint)');
    expect(dzScss).toContain('.dropzone--over');
    expect(dzScss).toContain('var(--tratt-next)');
    expect(dzScss).not.toMatch(/color: black/);
  });

  it('tratt-dropzone scss has no raw colours', () => {
    expect(tdScss).not.toMatch(/:\s*(red|green|black)\b/);
    expect(tdScss).toContain('var(--tratt-danger)');
    expect(tdScss).toContain('var(--tratt-success-text)');
    expect(tdScss).toContain('var(--tratt-danger-text)');
    expect(tdScss).toContain('var(--tratt-text-primary)');
    for (const c of [
      '.dz-icon-warning',
      '.dz-spinner',
      '.dz-row-btn',
      '.dz-supported',
    ]) {
      expect(tdScss).toContain(c);
    }
  });

  it('tratt-dropzone html has no inline colours', () => {
    expect(tdHtml).not.toMatch(/style="[^"]*color:/);
    expect(tdHtml).toContain('dz-icon-warning');
    expect(tdHtml).toContain('dz-spinner');
    expect(tdHtml).toContain('dz-row-btn');
    expect(tdHtml).toContain('dz-supported');
  });
});
