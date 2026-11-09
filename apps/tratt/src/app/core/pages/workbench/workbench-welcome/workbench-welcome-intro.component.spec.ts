import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, jest } from '@jest/globals';
import { TranslocoPipe, TranslocoTestingModule } from '@jsverse/transloco';
import { SettingsService } from '../../../shared/service';
import { AppStorageService } from '../../../shared/service/appstorage.service';
import { CompatibilityService } from '../../../shared/service/compatibility.service';
import { WorkbenchWelcomeIntroComponent } from './workbench-welcome-intro.component';

describe('WorkbenchWelcomeIntroComponent', () => {
  let fixture: ComponentFixture<WorkbenchWelcomeIntroComponent>;
  let el: HTMLElement;

  const create = async (compatible: boolean) => {
    TestBed.configureTestingModule({
      imports: [
        WorkbenchWelcomeIntroComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: { workbench: { welcome: { title: 'Turn speech into text' } } },
          },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: SettingsService, useValue: { appSettings: undefined } },
        { provide: AppStorageService, useValue: {} },
        {
          provide: CompatibilityService,
          useValue: { testCompability: async () => compatible },
        },
      ],
    });
    // The browser test and the banner are checked by their own specs.
    TestBed.overrideComponent(WorkbenchWelcomeIntroComponent, {
      set: { imports: [TranslocoPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    fixture = TestBed.createComponent(WorkbenchWelcomeIntroComponent);
    el = fixture.nativeElement;
    const reported = jest.fn();
    fixture.componentInstance.compatibility.subscribe(reported);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return reported;
  };

  it('shows the title and reports a supported browser', async () => {
    const reported = await create(true);
    expect(el.querySelector('h1')?.textContent).toContain(
      'Turn speech into text',
    );
    expect(el.querySelector('tratt-browser-test')).toBeNull();
    expect(reported).toHaveBeenCalledWith(true);
  });

  it('shows the browser check in an unsupported browser', async () => {
    const reported = await create(false);
    expect(el.querySelector('tratt-browser-test')).not.toBeNull();
    expect(reported).toHaveBeenCalledWith(false);
  });
});
