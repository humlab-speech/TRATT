import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

/**
 * Umeå University logo. Swedish UI gets the Swedish logotype, every other
 * language the English one. `centered` is the stacked version, `left` the
 * wide version for left-aligned placement.
 */
@Component({
  selector: 'tratt-umu-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Both themes are rendered; CSS shows the one matching data-bs-theme.
  template: `
    <img class="umu-logo--light" [src]="src()" alt="Umeå universitet / Umeå University" />
    <img class="umu-logo--dark" [src]="src(true)" alt="" aria-hidden="true" />
  `,
  styles: `
    :host {
      display: block;
    }
    img {
      display: block;
      height: 100%;
      max-width: 100%;
    }
    .umu-logo--dark {
      display: none;
    }
:host-context([data-bs-theme='dark']) .umu-logo--light {
      display: none;
    }
    :host-context([data-bs-theme='dark']) .umu-logo--dark {
      display: block;
    }
  `,
})
export class UmuLogoComponent {
  readonly variant = input<'centered' | 'left'>('centered');
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, {
    initialValue: inject(TranslocoService).getActiveLang(),
  });
  readonly src = (negative = false) => {
    const sv = this.lang() === 'sv';
    const neg = negative ? 'neg-' : '';
    const base = 'assets/img/umu/';
    const lang = sv ? 'SE' : 'EN';
    if (this.variant() === 'left') return `${base}umu-logo-left-${neg}${lang}.svg`;
    // The light centered EN file is named "logotyp", the rest "logo".
    return !negative && !sv
      ? `${base}umu-logotyp-EN.svg`
      : `${base}umu-logo-${neg}${lang}.svg`;
  };
}
