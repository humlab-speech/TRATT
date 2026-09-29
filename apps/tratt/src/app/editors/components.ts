import { Type } from '@angular/core';
import { TwoDEditorComponent } from './2D-editor';
import { DictaphoneEditorComponent } from './dictaphone-editor';
import { LinearEditorComponent } from './linear-editor';
import { TrnEditorComponent } from './trn-editor';
import { TRATTEditor } from './tratt-editor';

export const editorComponents: {
  name: string;
  editor: Type<TRATTEditor>;
  translate: string;
  icon: string;
}[] = [
  {
    name: DictaphoneEditorComponent.editorname,
    editor: DictaphoneEditorComponent,
    translate: 'interfaces.simple editor',
    icon: 'bi bi-dash-lg',
  },
  {
    name: LinearEditorComponent.editorname,
    editor: LinearEditorComponent,
    translate: 'interfaces.linear editor',
    icon: 'bi bi-window-desktop',
  },
  {
    name: TrnEditorComponent.editorname,
    editor: TrnEditorComponent,
    translate: 'interfaces.TRN editor',
    icon: 'bi bi-table',
  },
  {
    name: TwoDEditorComponent.editorname,
    editor: TwoDEditorComponent,
    translate: 'interfaces.2D editor',
    icon: 'bi bi-justify',
  },
];
