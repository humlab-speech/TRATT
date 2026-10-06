import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../shared/service/local-translation.service', () => ({
  LocalTranslationService: class LocalTranslationService {},
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import { LocalTranslationService } from '../../shared/service/local-translation.service';
import { AutoTranslateOptionsComponent } from './auto-translate-options.component';

describe('AutoTranslateOptionsComponent', () => {
  let fixture: ComponentFixture<AutoTranslateOptionsComponent>;
  let component: AutoTranslateOptionsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutoTranslateOptionsComponent],
      providers: [
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() calls this to resolve the scope
            // before it will call translate() at all — needed here because
            // the compact mode tests below call fixture.detectChanges().
            _loadDependencies: () => of({}),
          },
        },
        LocalTranslationService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AutoTranslateOptionsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('annotationAlreadyLoaded', false);
    fixture.componentRef.setInput('transcribeWillRun', true);
  });

  // Task 5: compact input, added so /workbench's narrow persistent settings
  // panel can suppress the decorative "model cached after download" hint.
  // The availability-path status messages (direct/pivot/unavailable/probing)
  // are NOT suppressed — they are load-bearing status the user needs to judge
  // whether translation will work. Default false keeps /local's mount unchanged.
  describe('compact', () => {
    it('suppresses the caching hint but keeps availability status in compact mode', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('transcribeWillRun', true);
      component.enabled.set(true);
      component['availabilityKind'].set('direct');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain(
        'login.translation.model cached after download',
      );
      expect(text).toContain('login.translation.path direct');
    });

    it('renders the caching hint when compact is false or omitted', () => {
      fixture.componentRef.setInput('compact', false);
      fixture.componentRef.setInput('transcribeWillRun', true);
      component.enabled.set(true);
      component['availabilityKind'].set('direct');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('login.translation.model cached after download');
    });

    it('keeps availability status visible in compact mode for pivot path', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('transcribeWillRun', true);
      component.enabled.set(true);
      component['availabilityKind'].set('pivot');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain(
        'login.translation.model cached after download',
      );
      expect(text).toContain('login.translation.path pivot');
    });

    it('keeps unavailable status visible in compact mode', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('transcribeWillRun', true);
      component.enabled.set(true);
      component['availabilityKind'].set('unavailable');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain(
        'login.translation.model cached after download',
      );
      expect(text).toContain('login.translation.path unavailable');
    });

    it('keeps probing status visible in compact mode', () => {
      fixture.componentRef.setInput('compact', true);
      fixture.componentRef.setInput('transcribeWillRun', true);
      component.enabled.set(true);
      component['availabilityKind'].set('probing');
      fixture.detectChanges();

      const text = fixture.nativeElement.textContent as string;
      expect(text).not.toContain(
        'login.translation.model cached after download',
      );
      expect(text).toContain('login.translation.path probing');
    });
  });
});

describe('AutoTranslateOptionsComponent persistKey', () => {
  const KEY = 'test.pipeline.translate';

  async function create() {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AutoTranslateOptionsComponent],
      providers: [
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
            _loadDependencies: () => of({}),
          },
        },
        {
          provide: LocalTranslationService,
          useValue: {
            resolveReachableTargets: async (_src: string, codes: string[]) =>
              new Map(codes.map((c) => [c, 'direct'])),
            resolveAvailability: async () => ({
              kind: 'direct',
              estimatedBytes: 0,
            }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AutoTranslateOptionsComponent);
    fixture.componentRef.setInput('transcribeWillRun', true);
    fixture.componentRef.setInput('persistKey', KEY);
    return fixture.componentInstance;
  }

  beforeEach(() => localStorage.clear());

  it('restores enabled, the picked target and skip-cache on the next visit', async () => {
    const first = await create();
    await first.ngOnInit();
    first.enabled.set(true);
    first.onEnabledChange();
    first.targetLanguage = 'fr';
    first.onTargetChange();
    first.skipBrowserCache.set(true);
    first.emitChange();

    const next = await create();
    await next.ngOnInit();

    expect(next.enabled()).toBe(true);
    expect(next.targetLanguage).toBe('fr');
    expect(next.skipBrowserCache()).toBe(true);
  });

  it('remembers switching translation off', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ enabled: true, targetLanguage: 'de' }),
    );
    const component = await create();
    await component.ngOnInit();
    component.enabled.set(false);
    component.onEnabledChange();

    expect(JSON.parse(localStorage.getItem(KEY)!).enabled).toBe(false);
  });
});
