import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection, provideZoneChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { bootstrapApplication } from '@angular/platform-browser';
import { AudioViewerComponent } from '@tratt/ngx-components';

bootstrapApplication(AudioViewerComponent, {
  providers: [
    provideZoneChangeDetection(),provideZonelessChangeDetection(),
    provideHttpClient(),
  ],
})
  .then((appRef) => {
    const element = createCustomElement(AudioViewerComponent, {
      injector: appRef.injector,
    });
    customElements.define('tratt-audio-viewer', element);
  })
  .catch((err) => console.error(err));
