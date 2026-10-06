import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Actions, ofType } from '@ngrx/effects';
import { ANNOTATION_SAVE_TRIGGERS } from '../../store/idb/annotation-save-triggers';
import { IDBActions } from '../../store/idb/idb.actions';

/**
 * Counts transcript writes to IndexedDB that have been triggered but not yet
 * answered (`IDBActions.saveAnnotation.success/fail`), so a page can warn
 * before it is closed while a write is still in flight.
 *
 * Writes triggered before this service was first injected are not counted;
 * their answers are ignored rather than driving the count below zero.
 */
@Injectable({ providedIn: 'root' })
export class AnnotationSaveTracker {
  private pending = 0;

  get inFlight(): number {
    return this.pending;
  }

  constructor() {
    const actions$ = inject(Actions);
    const destroyRef = inject(DestroyRef);
    actions$
      .pipe(ofType(...ANNOTATION_SAVE_TRIGGERS), takeUntilDestroyed(destroyRef))
      .subscribe(() => this.pending++);
    actions$
      .pipe(
        ofType(
          IDBActions.saveAnnotation.success,
          IDBActions.saveAnnotation.fail,
        ),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => {
        this.pending = Math.max(0, this.pending - 1);
      });
  }
}
