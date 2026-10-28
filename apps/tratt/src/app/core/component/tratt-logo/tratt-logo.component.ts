import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Platform logo per the Språkbanken profile: name in Jost Light, the orange
 * mark, tagline in Jost Medium. Until Språkbanken delivers the logo as an SVG
 * (decision 1), the name and tagline are live text so the tagline follows the
 * interface language.
 */
@Component({
  selector: 'tratt-logo',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tratt-logo__name">Tratt</span>
    <img class="tratt-logo__mark" src="assets/img/tratt/tratt-mark.svg" alt="" width="44" height="35" />
    @if (tagline()) {
      <span class="tratt-logo__tagline">{{ 'branding.tagline' | transloco }}</span>
    }
  `,
  styleUrl: './tratt-logo.component.scss',
  host: { class: 'tratt-logo' },
})
export class TrattLogoComponent {
  readonly tagline = input(true);
}
