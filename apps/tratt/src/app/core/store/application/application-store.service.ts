import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { SubscriptionManager } from '@tratt/utilities';
import { Observable } from 'rxjs';
import { IDBApplicationOptionName } from '../../shared/tratt-database';
import { RootState } from '../index';
import { ApplicationActions } from './application.actions';
import {
  selectAppConfiguration,
  selectIdb,
  selectInitialized,
  selectLoading,
  selectLoggedIn,
  selectMode,
  selectOptions,
  selectShortcutsEnabled,
} from './application.selectors';

@Injectable({
  providedIn: 'root',
})
export class ApplicationStoreService {
  private _useMode = this.store.selectSignal(selectMode);

  get useMode() {
    return this._useMode();
  }

  private subscrManager = new SubscriptionManager();

  constructor(private store: Store<RootState>) {
    // Initialize observables for backward compatibility
    this.options$ = this.store.select(selectOptions);
    this.idb$ = this.store.select(selectIdb);
    this.appInitialized$ = this.store.select(selectInitialized);
    this.appconfig$ = this.store.select(selectAppConfiguration);
    this.loading$ = this.store.select(selectLoading);
    this.loggedIn$ = this.store.select(selectLoggedIn);
    this.shortcutsEnabled$ = this.store.select(selectShortcutsEnabled);
  }

  loading = this.store.selectSignal(selectLoading);
  appconfig = this.store.selectSignal(selectAppConfiguration);
  idb = this.store.selectSignal(selectIdb);
  loggedIn = this.store.selectSignal(selectLoggedIn);
  appInitialized = this.store.selectSignal(selectInitialized);
  shortcutsEnabled = this.store.selectSignal(selectShortcutsEnabled);
  options = this.store.selectSignal(selectOptions);

  // Observable compatibility for components using subscribe()
  options$: Observable<Record<string, any>>;
  idb$: Observable<any>;
  appInitialized$: Observable<boolean>;
  appconfig$: Observable<any>;
  loading$: Observable<any>;
  loggedIn$: Observable<boolean>;
  shortcutsEnabled$: Observable<boolean>;

  public initApplication() {
    this.store.dispatch(ApplicationActions.initApplication.do());
  }

  public destroy() {
    this.subscrManager.destroy();
  }

  setShortcutsEnabled(shortcutsEnabled: boolean) {
    this.store.dispatch(
      ApplicationActions.setShortcutsEnabled.do({
        shortcutsEnabled,
      }),
    );
  }

  changeApplicationOption(
    name: IDBApplicationOptionName,
    value: boolean | number | string,
  ) {
    this.store.dispatch(
      ApplicationActions.changeApplicationOption.do({
        name,
        value,
      }),
    );
  }
}
