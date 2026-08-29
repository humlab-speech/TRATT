import { ChangeDetectorRef, Renderer2, SimpleChange } from '@angular/core';
import { describe, expect, it, jest } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { TrattAnnotationSegment } from '@tratt/annotation';
import { ShortcutService } from '../../shared/service/shortcut.service';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { TranscrEditorComponent } from './transcr-editor.component';

describe('TranscrEditorComponent', () => {
  function createComponent(): TranscrEditorComponent {
    return new TranscrEditorComponent(
      {} as ChangeDetectorRef,
      {} as ShortcutService,
      {} as TranslocoService,
      {} as AnnotationStoreService,
      {} as Renderer2,
    );
  }

  // Regression test for a bug where `ngOnChanges` passed the raw
  // `SimpleChange` wrapper object (via `obj['segments'] as any`) to
  // `setSegments(segments: TrattAnnotationSegment[])` instead of
  // `obj['segments'].currentValue`. Since a `SimpleChange` has no
  // `.length`, `setSegments`'s loop never ran and the transcript was
  // silently reset to an empty string whenever the `segments` input
  // changed.
  it('passes the new segments array (not the SimpleChange wrapper) to setSegments when the segments input changes', async () => {
    const component = createComponent();
    const setSegmentsSpy = jest
      .spyOn(
        component as unknown as { setSegments: (s: unknown) => void },
        'setSegments',
      )
      .mockImplementation(() => undefined);

    const segments = [
      {} as TrattAnnotationSegment,
      {} as TrattAnnotationSegment,
    ];

    await component.ngOnChanges({
      segments: new SimpleChange(undefined, segments, false),
    });

    expect(setSegmentsSpy).toHaveBeenCalledTimes(1);
    expect(setSegmentsSpy).toHaveBeenCalledWith(segments);
  });
});
