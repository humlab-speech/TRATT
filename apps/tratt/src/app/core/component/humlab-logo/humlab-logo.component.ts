import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

/**
 * Humlab (Umeå University) logo. Swedish UI gets the Swedish logotype, every other
 * language the English one. `centered` is the stacked version, `left` the
 * wide version for left-aligned placement.
 */
@Component({
  selector: 'tratt-humlab-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Both themes are rendered; CSS shows the one matching data-bs-theme.
  template: `
    <img class="humlab-logo--light" [src]="src()" alt="Humlab, Umeå universitet" />
    <img class="humlab-logo--dark" [src]="src(true)" alt="" aria-hidden="true" />
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
    .humlab-logo--dark {
      display: none;
    }
:host-context([data-bs-theme='dark']) .humlab-logo--light {
      display: none;
    }
    :host-context([data-bs-theme='dark']) .humlab-logo--dark {
      display: block;
    }
  `,
})
export class HumlabLogoComponent {
  readonly variant = input<'centered' | 'left'>('centered');
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, {
    initialValue: inject(TranslocoService).getActiveLang(),
  });
  readonly src = (negative = false) => {
    const lang = this.lang() === 'sv' ? 'se' : 'en';
    const parts = ['humlab_logo'];
    if (this.variant() === 'left') parts.push('left');
    if (negative) parts.push('neg');
    return `assets/img/humlab/${[...parts, lang].join('_')}.svg`;
  };
}
