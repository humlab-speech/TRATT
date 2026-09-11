import { ApplicationState } from './application';
import { AuthenticationState } from './authentication';
import { AnnotationState } from './login-mode/annotation';
import {
  LocalBundleCollectionState,
  resolveLocalBundleState,
} from './login-mode/annotation/local-bundle-collection';
import { UserState } from './user';

export enum LoginMode {
  URL = 'url',
  DEMO = 'demo',
  ONLINE = 'online',
  LOCAL = 'local',
}

export enum LoadingStatus {
  INITIALIZE = 'INITIALIZE',
  WAITING = 'WAITING',
  LOADING = 'LOADING',
  FAILED = 'FAILED',
  FINISHED = 'FINISHED',
}

export interface LoginData {
  userName: string;
  webToken: string;
  email?: string;
}

export interface CurrentProject {
  name: string;
  id: number;
  description: string;
  jobsLeft: number;
}

export interface RootState {
  authentication: AuthenticationState;
  application: ApplicationState;
  onlineMode: AnnotationState;
  demoMode: AnnotationState;
  localMode: LocalBundleCollectionState;
  urlMode: AnnotationState;
  user: UserState;
}

export function getModeState(
  appState: RootState,
): AnnotationState | undefined {
  switch (appState.application.mode) {
    case LoginMode.DEMO:
      return appState.demoMode;
    case LoginMode.LOCAL:
      return resolveLocalBundleState(appState.localMode);
    case LoginMode.URL:
      return appState.urlMode;
    case LoginMode.ONLINE:
      return appState.onlineMode;
  }

  return undefined;
}
