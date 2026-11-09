import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppInfo } from '../../../../app.info';
import { TrattCreditsComponent } from '../../../component/tratt-credits/tratt-credits.component';
import { TrattFooterComponent } from '../../../component/tratt-footer/tratt-footer.component';

/**
 * The start page below the rail's upload and record tabs: other ways in
 * (demo, by hand), what Tratt is, and the page footer. Shown while no file
 * is loaded; the rail itself is the drop target.
 */
@Component({
  selector: 'tratt-workbench-welcome',
  templateUrl: './workbench-welcome.component.html',
  styleUrls: ['./workbench-welcome.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, TrattCreditsComponent, TrattFooterComponent],
})
export class WorkbenchWelcomeComponent {
  /** The transcription language, named in the UI language. */
  readonly language = input<string | undefined>(undefined);
  /** The demo recording is being fetched. */
  readonly demoLoading = input(false);

  /** Files picked with "Transcribe by hand, without AI". */
  readonly addByHand = output<File[]>();
  readonly startDemo = output<void>();
  readonly openSettings = output<void>();

  // A getter: the manual's address comes with the app config.
  protected get manualURL(): string {
    return AppInfo.manualURL;
  }

  onFilesPicked(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    // Picking the same file again must fire `change` again.
    inputEl.value = '';
    if (files.length > 0) {
      this.addByHand.emit(files);
    }
  }
}
