import { describe, it, expect, jest } from '@jest/globals';

// editorComponents pulls in 2D-editor/dictaphone-editor/linear-editor, which all import
// TranscrEditorComponent from the core/component barrel. That barrel re-exports
// navbar.component.ts, which imports translate-linked-level-modal.component.ts ->
// local-translation.service.ts, which uses `import.meta.url` and fails to compile
// under this project's CommonJS ts-jest config (same pre-existing issue worked around
// in linear-editor.component.spec.ts). This test never touches navbar behavior, so the
// whole navbar submodule is mocked out; the barrel's other re-exports (including
// TranscrEditorComponent) are untouched.
jest.mock('../core/component/navbar', () => ({}));

import { Type } from '@angular/core';
import { editorComponents } from './components';
import { TRATTEditor } from './tratt-editor';

describe('editorComponents', () => {
  it('declares every entry as a component Type<TRATTEditor>', () => {
    editorComponents.forEach((entry) => {
      const editorType: Type<TRATTEditor> = entry.editor;
      expect(typeof editorType).toBe('function');
    });
  });
});
