import { Component, OnDestroy } from '@angular/core';
import { SubscriberComponent } from '@octra/ngx-utilities';

@Component({
  selector: 'octra-default',
  template: '',
  standalone: true,
})
export class DefaultComponent
  extends SubscriberComponent
  implements OnDestroy {}
