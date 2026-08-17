import { provideHttpClient } from '@angular/common/http';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { bootstrapApplication } from '@angular/platform-browser';
import { AudioplayerComponent } from '@tratt/ngx-components';

bootstrapApplication(AudioplayerComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideHttpClient(),
  ],
})
  .then((appRef) => {
    const element = createCustomElement(AudioplayerComponent, {
      injector: appRef.injector,
    });
    customElements.define('tratt-audio-player', element);
  })
  .catch((err) => console.error(err));
