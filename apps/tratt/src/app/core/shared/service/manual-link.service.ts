import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppInfo } from '../../../app.info';

/**
 * Which manual page a given application route should open.
 *
 * The first matching prefix wins, so more specific routes go first. A route
 * with no entry opens the manual's front page, which routes the reader itself.
 * Page names are the file names in docs/manual, without extension; see
 * docs/manual/CONTRIBUTING.md for the contract between the app and the manual.
 */
const ROUTE_PAGES: { prefix: string; page: string }[] = [
  { prefix: '/workbench', page: 'workbench' },
];

/** The manual page for `url`, or undefined for the front page. */
export function manualPageForUrl(url: string): string | undefined {
  // Query string and fragment are never part of the decision.
  const path = url.split(/[?#]/)[0];
  return ROUTE_PAGES.find(
    ({ prefix }) => path === prefix || path.startsWith(`${prefix}/`),
  )?.page;
}

/**
 * The manual link to offer from wherever the user currently is.
 *
 * Both doors into the manual (the navigation bar's "Manual" entry and the Help
 * dialog) go through this, so they can never disagree. The language follows the
 * interface language, which `AppInfo` already tracks.
 */
@Injectable({ providedIn: 'root' })
export class ManualLinkService {
  private router = inject(Router);

  /** Manual page for the route the user is on. */
  get href(): string {
    const page = manualPageForUrl(this.router.url);
    return page ? AppInfo.manualLink(page) : AppInfo.manualURL;
  }

  /** The manual's keyboard-shortcut reference, in the interface language. */
  get shortcutsHref(): string {
    return AppInfo.manualLink('shortcuts');
  }
}
