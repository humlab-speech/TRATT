import { describe, expect, it } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlertService, AlertType } from '../../shared/service/alert.service';
import { AlertComponent } from './alert.component';

// NgbToast's template calls $localize; @angular/localize is not installed
// (the app uses Transloco), so stub the tag for this DOM test.
(globalThis as any).$localize ??= (s: TemplateStringsArray, ...v: unknown[]) =>
  String.raw({ raw: s }, ...v);

describe('AlertComponent', () => {
  const render = (type: AlertType) => {
    TestBed.configureTestingModule({ imports: [AlertComponent] });
    TestBed.inject(AlertService).showAlert(
      type,
      'message ' + type,
      false,
      60000,
    );
    const f = TestBed.createComponent(AlertComponent);
    f.detectChanges();
    return f.nativeElement.querySelector('ngb-toast') as HTMLElement;
  };

  it.each(['success', 'danger', 'warning'] as const)(
    '%s toast uses the state tint and no filled bg class',
    (type) => {
      const toast = render(type);
      expect(toast.classList.contains(`tratt-state-${type}`)).toBe(true);
      expect(toast.classList.contains(`bg-${type}`)).toBe(false);
    },
  );

  it('danger toast has role="alert"', () => {
    expect(render('danger').getAttribute('role')).toBe('alert');
  });

  it('non-danger toasts do not get the forced alert role binding', () => {
    // ngb-toast may set its own role; the template binding yields null here.
    for (const type of ['success', 'warning'] as const) {
      TestBed.resetTestingModule();
      const toast = render(type);
      expect(toast.getAttribute('role')).not.toBe('alert');
    }
  });

  it('the tratt-alert host is a polite live region', () => {
    const html = readFileSync(
      join(__dirname, '../../../app.component.html'),
      'utf8',
    );
    expect(html).toContain('<tratt-alert id="alerts" aria-live="polite">');
  });
});
