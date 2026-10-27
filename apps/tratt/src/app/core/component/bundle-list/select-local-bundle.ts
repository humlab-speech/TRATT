import { Store } from '@ngrx/store';
import { PendingEditsService } from '../../shared/service/pending-edits.service';
import { LoginMode } from '../../store/index';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';

/**
 * Selects a LOCAL bundle. Flushes the editor's debounced typing first –
 * afterwards it would be routed into the newly selected bundle.
 */
export function selectLocalBundle(
  store: Store<any>,
  pendingEdits: PendingEditsService,
  currentId: string | undefined,
  bundleId: string,
): void {
  if (currentId === bundleId) return;
  pendingEdits.flush();
  store.dispatch(
    LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }),
  );
}
