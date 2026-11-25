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

describe('LinearEditorComponent.update guards audioChunkDown (C11)', () => {
  it('does not throw when audioChunkDown is undefined', () => {
    const component = createComponent({ items: [] });
    (component as any).audioChunkTop = {
      startpos: undefined,
      time: { start: { clone: () => 'top-start' } },
    };
    (component as any).audioChunkDown = undefined;
    (component as any).cd = { markForCheck: () => undefined };

    expect(() => component.update()).not.toThrow();
  });

  it('still updates audioChunkDown.startpos when it is set', () => {
    const component = createComponent({ items: [] });
    (component as any).audioChunkTop = {
      startpos: undefined,
      time: { start: { clone: () => 'top-start' } },
    };
    (component as any).audioChunkDown = {
      startpos: undefined,
      time: { start: { clone: () => 'down-start' } },
    };
    (component as any).cd = { markForCheck: () => undefined };

    component.update();

    expect((component as any).audioChunkDown.startpos).toBe('down-start');
  });
});

describe('LinearEditorComponent text-loss guards', () => {
  function saveSetup(transcriptLoaded: boolean, rawText: string) {
    const changeCurrentItemById = jest.fn();
    const { TrattAnnotationSegmentLevel } = jest.requireActual(
      '@tratt/annotation',
    ) as any;
    const level = Object.create(TrattAnnotationSegmentLevel.prototype);
    const current: any = {
      id: 7,
      getFirstLabelWithoutName: () => ({ value: 'unit text' }),
      clone: () => ({
        changeFirstLabelWithoutName: () => undefined,
        verified: false,
      }),
    };
    Object.defineProperty(level, 'items', { get: () => [current] });
    const component = createComponent(level);
    (component.annotationStoreService as any).changeCurrentItemById =
      changeCurrentItemById;
    (component as any).segmentselected = true;
    (component as any).selectedIndex = 0;
    (component as any).editor = { transcriptLoaded, rawText };
    return { component, changeCurrentItemById };
  }

  it('save() does not overwrite a unit before the editor holds its text', () => {
    const { component, changeCurrentItemById } = saveSetup(false, '');
    (component as any).save();
    expect(changeCurrentItemById).not.toHaveBeenCalled();
  });

  it('save() still writes edits once the editor is loaded', () => {
    const { component, changeCurrentItemById } = saveSetup(true, 'edited');
    (component as any).save();
    expect(changeCurrentItemById).toHaveBeenCalledTimes(1);
  });

  it('entering a unit from the lower display loads its text into the editor', async () => {
    const component = createComponent({ items: [] });
    const loadTranscript = jest.fn(() => Promise.resolve());
    (component as any).editor = {
      loadTranscript,
      focus: () => Promise.resolve(),
    };
    component.transcript = 'unit text';
    (component as any).selectSegment = () =>
      Promise.resolve({
        clone: () => ({ start: { clone: () => 0 } }),
        start: { clone: () => 0 },
      });
    (component as any).audioChunkDown = {};
    component.onMagnifierSegmentEnter({ index: 3 });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadTranscript).toHaveBeenCalledWith('unit text');
  });
});

describe('LinearEditorComponent commits pending edits before the selection moves', () => {
  it('flushes before selectSegment changes the selected unit', async () => {
    const component = createComponent({ items: [] });
    const order: string[] = [];
    (component as any).segmentselected = true;
    component.flushPendingEdits = () => order.push('flush');
    const original = (component as any).selectSegment.bind(component);
    await original(0);
    expect(order).toEqual(['flush']);
  });

  it('flushes before a viewer mouse down deselects the unit', () => {
    const component = createComponent({ items: [] });
    (component as any).segmentselected = true;
    const flush = jest.fn();
    component.flushPendingEdits = flush;
    component.onViewerMouseDown();
    expect(flush).toHaveBeenCalledTimes(1);
    expect((component as any).segmentselected).toBe(false);
  });
});

describe('LinearEditorComponent.flushPendingEdits disarms the typing debounce', () => {
  it('cancels the editor typing timer so a late "stopped" cannot save into another unit', () => {
    const component = createComponent({ items: [] });
    const cancelTyping = jest.fn();
    (component as any).appStorage = { saving: { emit: () => undefined } };
    (component as any).editor = {
      rawText: '',
      updateRawText: () => undefined,
      cancelTyping,
    };
    component.flushPendingEdits();
    expect(cancelTyping).toHaveBeenCalledTimes(1);
  });
});
