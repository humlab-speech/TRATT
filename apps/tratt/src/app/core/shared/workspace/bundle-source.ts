import { Observable, of } from 'rxjs';

export interface BundleRef {
  session: string;
  name: string;
  finishedEditing?: boolean;
  comment?: string;
}

/** Separates "where bundles come from" from the workbench. */
export interface BundleSource {
  /** Drop zone, record, zip import and remove are offered only if true. */
  readonly canAddBundles: boolean;
  listBundles(): Observable<BundleRef[]>;
  loadBundle(
    ref: BundleRef,
  ): Promise<{ annotation: unknown; audio: () => Promise<Blob> }>;
  save(
    ref: BundleRef,
    annotation: unknown,
    meta?: { finishedEditing?: boolean; comment?: string },
  ): Promise<void>;
}

/**
 * Today's behaviour: bundles are the user's own files, held in the browser
 * database. Persistence is the IDB autosave, so saving is a no-op here and the
 * list comes from the bundle entity collection, not from this source.
 */
export class LocalBundleSource implements BundleSource {
  readonly canAddBundles = true;

  listBundles(): Observable<BundleRef[]> {
    return of([]);
  }

  async loadBundle(): Promise<never> {
    throw new Error('Local bundles are loaded from the browser database.');
  }

  async save(): Promise<void> {
    // IDB autosave already persisted the change.
  }
}
