import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'tratt-credits',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tratt-credits.component.html',
  styleUrl: './tratt-credits.component.scss',
})
export class TrattCreditsComponent {
  readonly funders: { name: string; url?: string }[] = [
    { name: 'VISP — Visible Speech' },
    { name: 'SweCLARIN', url: 'https://www.sweclarin.se/' },
    { name: 'Humlab – Umeå University', url: 'https://www.umu.se/en/humlab/' },
    { name: 'IPS LMU Munich', url: 'http://www.en.phonetik.uni-muenchen.de/' },
    { name: 'BAS', url: 'https://www.bas.uni-muenchen.de/Bas/BasHomeeng.html' },
    { name: 'Clarin-D', url: 'https://www.clarin-d.net/en/' },
  ];
  readonly modelGroups: { name: string; url: string }[] = [
    { name: 'Language Technology at the University of Helsinki', url: 'https://github.com/Helsinki-NLP' },
    { name: 'Finnish-NLP', url: 'https://huggingface.co/Finnish-NLP' },
    { name: 'AI-lab at National Library of Norway', url: 'https://ai.nb.no/' },
    { name: 'KBLab – National Library of Sweden', url: 'https://www.kb.se/eng/research-collaboration/kblab.html' },
    { name: 'OpenAI', url: 'https://huggingface.co/openai' },
    { name: 'pyannote', url: 'https://github.com/pyannote/pyannote-audio' },
  ];
}
