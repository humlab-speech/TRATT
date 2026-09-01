import { describe, expect, it, jest } from '@jest/globals';

// Break pre-existing issues reached only via the core/component barrel's re-export of
// navbar.component.ts, which linear-editor.component.ts pulls in transitively (it only
// actually uses TranscrEditorComponent/TranscrEditorConfig from that barrel):
//  1) navbar.component.ts -> editors/components.ts -> back to LinearEditorComponent,
//     a circular import that throws under Jest's CommonJS loading while the class is
//     still being defined ("Cannot read properties of undefined (reading 'editorname')").
//  2) navbar.component.ts -> translate-linked-level-modal.component.ts ->
//     local-translation.service.ts, which uses `import.meta.url` and fails to compile
//     under this project's CommonJS ts-jest config.
// Neither concerns this unit test, so the whole navbar module is mocked out.
jest.mock('../../core/component/navbar', () => ({}));

import { LinearEditorComponent } from './linear-editor.component';

function createComponent(currentLevel: any) {
  const annotationStoreService = { currentLevel } as any;
  const audio = {
    audiomanagers: [],
    audioManager: { createSampleUnit: (n: number) => ({ samples: n }) },
  } as any;
  const component = new LinearEditorComponent(
    audio,
    {} as any, // alertService
    annotationStoreService,
    {} as any, // shortcutService
    { markForCheck: () => undefined } as any, // cd
    {} as any, // uiService
    {} as any, // settingsService
    {} as any, // appStorage
  );
  (component as any).audioManager = audio.audioManager;
  return component;
}

describe('LinearEditorComponent.selectSegment resolves on non-segment levels (C10)', () => {
  it('resolves (with undefined) instead of hanging forever when currentLevel is not a SEGMENT level', async () => {
    const nonSegmentLevel = { items: [{}] }; // deliberately not a TrattAnnotationSegmentLevel instance
    const component = createComponent(nonSegmentLevel);

    const result = await Promise.race([
      (component as any).selectSegment(0),
      new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 200)),
    ]);

    expect(result).not.toBe('TIMED_OUT');
    expect(result).toBeUndefined();
  });
});
