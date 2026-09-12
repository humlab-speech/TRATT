import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Store } from '@ngrx/store';
import { LoginMode, RootState } from '../../store/index';
import { selectAllBundleSummaries } from '../../store/login-mode/annotation/annotation.selectors';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';

/**
 * Lists the bundles created by the one `startSession()` call at the start of
 * a session (see `WorkbenchComponent.startSession()`), and lets the user
 * switch between them via `LoginModeActions.selectBundle`.
 *
 * Scope boundary: this does NOT let a user drop more files into an
 * already-active session — `startSession()` remains a single-shot ingest,
 * invoked exactly once at session start. This list only switches between
 * bundles that already exist from that one call; "drop more mid-session" is
 * out of scope for this component.
 */
@Component({
  selector: 'tratt-bundle-list',
  templateUrl: './bundle-list.component.html',
  styleUrls: ['./bundle-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
})
export class BundleListComponent {
  bundles = this.store.selectSignal(selectAllBundleSummaries);

  constructor(private store: Store<RootState>) {}

  selectBundle(bundleId: string): void {
    this.store.dispatch(
      LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }),
    );
  }
}
