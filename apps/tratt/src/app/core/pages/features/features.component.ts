import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppInfo } from '../../../app.info';

interface FeatureItem {
  title: string;
  description: string;
  /**
   * Deep link into the manual. Built with a literal AppInfo.manualLink() call
   * so that scripts/check-manual-links.mjs can verify the target exists.
   */
  url: string;
}

@Component({
  selector: 'tratt-features',
  templateUrl: './features.component.html',
  styleUrls: ['./features.component.scss'],
  imports: [TranslocoPipe],
})
export class FeaturesComponent {
  readonly items: FeatureItem[] = [
    {
      title: 'Transcribe locally',
      description:
        'Load an audio or video file and transcribe it in the browser. The recording never leaves your computer.',
      url: AppInfo.manualLink('quick-start'),
    },
    {
      title: 'Automatic draft transcription',
      description:
        'Whisper speech-recognition models run on your own machine, with models tuned for Swedish, Finnish and Norwegian.',
      url: AppInfo.manualLink('automatic-transcription'),
    },
    {
      title: 'Speaker separation',
      description:
        'Work out who spoke when, locally, and correct the labels as you go.',
      url: AppInfo.manualLink('automatic-transcription', 'speaker-separation'),
    },
    {
      title: 'Record in the browser',
      description:
        'Capture audio or video straight into TRATT, with device selection, level metering and crash recovery.',
      url: AppInfo.manualLink('loading-media', 'recording-in-the-browser'),
    },
    {
      title: 'Three editors',
      description:
        'A waveform editor, a dictaphone-style editor and a dual-display editor over the same transcript. Switch freely.',
      url: AppInfo.manualLink('the-editors'),
    },
    {
      title: 'Export anywhere',
      description:
        'Word, OpenDocument, SubRip, WebVTT, TextGrid, ELAN, AnnotJSON and more — plus custom tables.',
      url: AppInfo.manualLink('exporting'),
    },
    {
      title: 'Nothing is uploaded',
      description:
        'Your recording and your transcript stay in the browser. Only the speech models are downloaded, and only if you ask for them.',
      url: AppInfo.manualLink('privacy'),
    },
  ];

  get manualURL(): string {
    return AppInfo.manualURL;
  }
}
