import { Injectable } from '@angular/core';

/**
 * Lets code that is about to change WHICH bundle the store routes edits to
 * (selecting another bundle, removing the selected one, re-attaching media)
 * first commit whatever the mounted editor still holds in its typing
 * debounce window.
 *
 * Why this has to happen *before* the selection changes, not when the editor
 * is torn down afterwards: every annotation action is routed by
 * `wrapAsLocalBundleCollectionReducer` to the bundle that is selected at
 * dispatch time, and the text editors' `flushPendingEdits()` re-saves their
 * whole raw text unconditionally. Flushing after the switch would write the
 * previous bundle's text over the newly selected bundle's transcript.
 *
 * The workbench registers its mounted editor's flush here; with no editor
 * mounted (e.g. on /local) `flush()` is a no-op.
 */
@Injectable({ providedIn: 'root' })
export class PendingEditsService {
  private flusher: (() => void) | null = null;

  /** Returns an unregister function (no-op if a newer flusher replaced it). */
  register(flusher: () => void): () => void {
    this.flusher = flusher;
    return () => {
      if (this.flusher === flusher) {
        this.flusher = null;
      }
    };
  }

  flush(): void {
    try {
      this.flusher?.();
    } catch (error) {
      // A failing flush must never block the navigation that triggered it.
      console.error(
        'PendingEditsService: flushing pending edits failed',
        error,
      );
    }
  }
}
