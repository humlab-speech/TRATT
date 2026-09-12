import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { SessionFile } from '../../obj/SessionFile';
import { LoginMode, RootState } from '../../store/index';
import { localBundleAdapter } from '../../store/login-mode/annotation/local-bundle-collection';
import { LoginModeActions } from '../../store/login-mode/login-mode.actions';
import { BundleListComponent } from './bundle-list.component';

// Convention: mock Store via @ngrx/store/testing's provideMockStore with a
// real initialState (rather than overrideSelector), matching
// audio.service.spec.ts / annotation.selectors.spec.ts — this exercises the
// real selectAllBundleSummaries selector against real state.
describe('BundleListComponent', () => {
  let fixture: ComponentFixture<BundleListComponent>;
  let store: MockStore<RootState>;

  const bundleA = {
    bundleId: 'bundle-a',
    sessionFile: new SessionFile('a.wav', 1, new Date(), 'audio/wav'),
  } as any;
  const bundleB = {
    bundleId: 'bundle-b',
    sessionFile: new SessionFile('b.wav', 2, new Date(), 'audio/wav'),
  } as any;

  const initialState = {
    application: { mode: LoginMode.LOCAL },
    localMode: {
      bundles: localBundleAdapter.setAll(
        [bundleA, bundleB],
        localBundleAdapter.getInitialState(),
      ),
      selectedBundleId: 'bundle-b',
    },
  } as unknown as RootState;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BundleListComponent],
      providers: [
        provideMockStore({ initialState }),
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            config: { reRenderOnLangChange: false },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BundleListComponent);
    store = TestBed.inject(MockStore);
    fixture.detectChanges();
  });

  it('renders one row per bundle summary', () => {
    const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
    expect(rows.length).toBe(2);
  });

  it('dispatches selectBundle with the clicked row bundleId when a non-selected row is clicked', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
    // bundle-a is the non-selected row (selectedBundleId is bundle-b)
    rows[0].triggerEventHandler('click', null);

    expect(dispatchSpy).toHaveBeenCalledWith(
      LoginModeActions.selectBundle({
        mode: LoginMode.LOCAL,
        bundleId: 'bundle-a',
      }),
    );
  });

  it('marks the currently-selected bundle row as active', () => {
    const rows = fixture.debugElement.queryAll(By.css('.bundle-list__item'));
    const rowA = rows.find((r) =>
      r.nativeElement.textContent.includes('a.wav'),
    );
    const rowB = rows.find((r) =>
      r.nativeElement.textContent.includes('b.wav'),
    );

    expect(rowA!.nativeElement.classList.contains('active')).toBe(false);
    expect(rowB!.nativeElement.classList.contains('active')).toBe(true);
  });
});
