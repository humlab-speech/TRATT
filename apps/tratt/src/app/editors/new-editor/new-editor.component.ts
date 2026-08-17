import { Component, EventEmitter } from '@angular/core';
import { AudioService, SettingsService } from '../../core/shared/service';
import { AppStorageService } from '../../core/shared/service/appstorage.service';
import { TRATTEditor, TrattEditorRequirements } from '../tratt-editor';

@Component({
  selector: 'tratt-new-editor',
  templateUrl: './new-editor.component.html',
  styleUrls: ['./new-editor.component.scss'],
})
export class NewEditorComponent
  extends TRATTEditor
  implements TrattEditorRequirements
{
  public static editorname = 'New Editor';
  public initialized: EventEmitter<void> = new EventEmitter<void>();

  constructor(
    public audio: AudioService,
    public settingsService: SettingsService,
    public appStorage: AppStorageService,
  ) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  afterFirstInitialization() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  enableAllShortcuts() {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  disableAllShortcuts() {}

  openSegment(index: number) {
    // no-op: this stub editor does not implement segment-focused popup editing.
  }
}
