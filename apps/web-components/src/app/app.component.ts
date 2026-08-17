import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TrattComponentsModule } from '@tratt/ngx-components';
import { TrattUtilitiesModule } from '@tratt/ngx-utilities';

@Component({
  imports: [RouterOutlet, TrattUtilitiesModule, TrattComponentsModule],
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /* ngDoBootstrap() {
    const audioPlayer = createCustomElement(AudioplayerComponent, {
      injector: this.injector,
    });
    customElements.define('tratt-audioplayer', audioPlayer);

    const audioViewer = createCustomElement(AudioViewerComponent, {
      injector: this.injector,
    });
    customElements.define('tratt-audioviewer', audioViewer);
  } */
}
