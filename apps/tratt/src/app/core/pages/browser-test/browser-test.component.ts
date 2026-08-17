import { NgStyle } from '@angular/common';
import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TRATT_COLORS } from '@tratt/ngx-components';
import { BrowserInfo } from '@tratt/web-media';
import { CompatibilityService } from '../../shared/service/compatibility.service';

@Component({
  selector: 'tratt-browser-test',
  templateUrl: './browser-test.component.html',
  styleUrls: ['./browser-test.component.scss'],
  imports: [NgStyle, RouterLink],
})
export class BrowserTestComponent {
  public get browserName(): string {
    return BrowserInfo.browser!;
  }

  constructor(
    private router: Router,
    public compatibilityService: CompatibilityService,
  ) {}

  getStateIcon(rule: any) {
    switch (rule.state) {
      case 'processing':
        return 'bi bi-spinner';
      case 'failed':
        return 'bi bi-x-lg';
      case 'ok':
        return 'bi bi-check-lg';
    }
    return 'spinner';
  }

  getStateColor(rule: any): string {
    switch (rule.state) {
      case 'processing':
        return TRATT_COLORS.textPrimary;
      case 'failed':
        return TRATT_COLORS.accentError;
      case 'ok':
        return TRATT_COLORS.accentGreen;
    }
    return 'processing';
  }

  test() {
    window.location.href = 'chrome://settings/content/cookies';
  }
}
