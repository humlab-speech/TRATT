import { Component, OnDestroy } from '@angular/core';
import { SubscriberComponent } from '@tratt/ngx-utilities';

@Component({
  selector: 'tratt-default',
  template: '',
  standalone: true,
})
export class DefaultComponent
  extends SubscriberComponent
  implements OnDestroy {}
