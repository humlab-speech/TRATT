import { Directive, ViewContainerRef } from '@angular/core';

@Directive({ selector: '[trattLoadeditor]' })
export class LoadeditorDirective {
  constructor(public viewContainerRef: ViewContainerRef) {}
}
