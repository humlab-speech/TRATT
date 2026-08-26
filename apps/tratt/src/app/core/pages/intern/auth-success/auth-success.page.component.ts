import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { DefaultComponent } from '../../../component/default.component';
import { ApplicationStoreService } from '../../../store/application/application-store.service';

@Component({
  selector: 'tratt-re-authentication-page',
  templateUrl: './auth-success.page.component.html',
  styleUrls: ['./auth-success.page.component.scss'],
  imports: [TranslocoPipe],
})
export class AuthSuccessPageComponent
  extends DefaultComponent
  implements OnInit
{
  constructor(
    private appService: ApplicationStoreService,
    private route: ActivatedRoute,
  ) {
    super();
  }

  ngOnInit() {
    const nonce = this.route.snapshot.queryParamMap.get('nonce');
    const bc = new BroadcastChannel('ocb_authentication');
    bc.postMessage({ ok: true, nonce });
    bc.close();
    window.close();
  }
}
