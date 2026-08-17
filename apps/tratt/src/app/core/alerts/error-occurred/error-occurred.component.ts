import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'tratt-error-occurred',
  templateUrl: './error-occurred.component.html',
  styleUrls: ['./error-occurred.component.scss'],
  imports: [RouterLink, TranslocoPipe],
})
export class ErrorOccurredComponent {
  public static componentName = 'ErrorOccurredComponent';
}
