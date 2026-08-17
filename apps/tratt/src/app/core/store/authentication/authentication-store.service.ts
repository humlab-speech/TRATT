import { Injectable } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { AccountLoginMethod } from '@octra/api-types';
import { OAnnotJSON } from '@tratt/annotation';
import { Observable } from 'rxjs';
import { LoginMode, RootState } from '../index';
import { AuthenticationActions } from './authentication.actions';

@Injectable({
  providedIn: 'root',
})
export class AuthenticationStoreService {
  // Observable compatibility
  serverOnline$: Observable<boolean | undefined>;

  constructor(private store: Store<RootState>) {
    this.serverOnline$ = this.store.select(
      (store: RootState) => store.authentication.serverOnline,
    );
  }

  me = this.store.selectSignal((store: RootState) => store.authentication.me);
  serverOnline = this.store.selectSignal(
    (store: RootState) => store.authentication.serverOnline,
  );

  authenticated = this.store.selectSignal(
    (store: RootState) => store.authentication.authenticated,
  );
  authType = this.store.selectSignal(
    (store: RootState) => store.authentication.type,
  );
  logoutMessage = this.store.selectSignal(
    (store: RootState) => store.authentication.logoutMessage,
  );
  logoutMessageType = this.store.selectSignal(
    (store: RootState) => store.authentication.logoutMessageType,
  );
  loginErrorMessage = this.store.selectSignal(
    (store: RootState) => store.authentication.loginErrorMessage,
  );

  otherUserLoggedIn = this.store.selectSignal((store: RootState) => {
    return this.getDifferentUserData(store);
  });

  sameUserWithOpenTask = this.store.selectSignal((store: RootState) => {
    const differentUserData = this.getDifferentUserData(store);
    if (
      !differentUserData &&
      store.onlineMode.currentSession.currentProject &&
      store.onlineMode.currentSession.task
    ) {
      return store.onlineMode.currentSession;
    }

    return undefined;
  });

  loginOnline(
    method: AccountLoginMethod,
    username?: string,
    password?: string,
  ) {
    this.store.dispatch(
      AuthenticationActions.loginOnline.do({
        method,
        username,
        password,
        mode: LoginMode.ONLINE,
      }),
    );
  }

  loginDemo() {
    this.store.dispatch(
      AuthenticationActions.loginDemo.do({
        mode: LoginMode.DEMO,
      }),
    );
  }

  async loginLocal(files: File[], annotation?: OAnnotJSON, removeData = false) {
    this.store.dispatch(
      AuthenticationActions.loginLocal.do({
        files,
        annotation,
        removeData,
        mode: LoginMode.LOCAL,
      }),
    );
  }

  loginAuto(method: AccountLoginMethod, params?: any) {
    this.store.dispatch(AuthenticationActions.loginAuto.do({ method, params }));
  }

  reauthenticate(
    method: AccountLoginMethod,
    actionAfterSuccess?: Action,
    username?: string,
    password?: string,
  ) {
    this.store.dispatch(
      AuthenticationActions.reauthenticate.do({
        method,
        username,
        password,
        actionAfterSuccess,
      }),
    );
  }

  setReAuthenticationSuccess(actionAfterSuccess?: Action) {
    this.store.dispatch(
      AuthenticationActions.needReAuthentication.success({
        actionAfterSuccess,
      }),
    );
  }

  getDifferentUserData(store: RootState) {
    const previousUser = store.authentication.previousUser;
    if (previousUser?.username && previousUser?.email) {
      if (
        previousUser.username !== store.authentication.me?.username ||
        previousUser.email !== store.authentication.me?.email
      ) {
        return previousUser;
      }
    }
    return undefined;
  }
}
