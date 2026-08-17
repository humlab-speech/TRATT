import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ErrorModalComponent } from '../../modals/error-modal/error-modal.component';
import { OctraModalService } from '../../modals/octra-modal.service';
import { isIgnoredAction, isIgnoredConsoleAction } from '../../shared';
import { ApplicationActions } from './application.actions';

@Injectable({
  providedIn: 'root',
})
export class ApplicationUiEffects {
  showErrorMessage$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.showErrorModal.do),
        tap((a) => {
          this.modalService.openModalRef<ErrorModalComponent>(
            ErrorModalComponent,
            {
              ...ErrorModalComponent.options,
              backdrop: a.showOKButton ? true : 'static',
            },
            {
              text: a.error,
              showOKButton: a.showOKButton,
            },
          );
        }),
      ),
    { dispatch: false },
  );

  logActionsToConsole$ = createEffect(
    () =>
      this.actions$.pipe(
        tap((action) => {
          if (
            !isIgnoredConsoleAction(action.type) &&
            environment.debugging.enabled &&
            environment.debugging.logging.actions &&
            action.type.indexOf('Set Console Entries') < 0 &&
            (!environment.production || !isIgnoredAction(action.type))
          ) {
            console.groupCollapsed(`ACTION ${action.type} ---`);
            console.log(action);
            console.groupEnd();
          }
        }),
      ),
    {
      dispatch: false,
    },
  );

  appLoadingFail$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ApplicationActions.loadSettings.fail),
        tap((a) => {
          this.modalService.openModalRef<ErrorModalComponent>(
            ErrorModalComponent,
            {
              ...ErrorModalComponent.options,
              backdrop: 'static',
            },
            {
              text: `Can't load application settings: ${a.error}`,
              showOKButton: false,
            },
          );
        }),
      ),
    { dispatch: false },
  );

  constructor(
    private actions$: Actions,
    private modalService: OctraModalService,
  ) {}
}
