import { Type } from '@angular/core';
import { TwoDEditorComponent } from './2D-editor';
import { DictaphoneEditorComponent } from './dictaphone-editor';
import { LinearEditorComponent } from './linear-editor';
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
    icon: 'fa-solid fa-minus',
  },
  {
    name: LinearEditorComponent.editorname,
    editor: LinearEditorComponent,
    translate: 'interfaces.linear editor',
    icon: 'fa-solid fa-window-maximize',
  },
  {
    name: TwoDEditorComponent.editorname,
    editor: TwoDEditorComponent,
    translate: 'interfaces.2D editor',
    icon: 'fa-solid fa-align-justify',
  },
];
