import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  CapacityService,
  RAM_BUDGET_BYTES,
  ResidentMemoryEstimate,
  StorageCapacity,
} from '../../shared/service/capacity.service';
import {
  CapacityIndicatorComponent,
  formatBytes,
} from './capacity-indicator.component';

describe('formatBytes', () => {
  it('renders sub-gigabyte figures as whole decimal MB', () => {
    expect(formatBytes(400_000_000)).toBe('400 MB');
  });

  it('renders gigabyte figures with one decimal', () => {
    expect(formatBytes(8_000_000_000)).toBe('8.0 GB');
  });

  it('renders zero as 0 MB rather than an empty string', () => {
    expect(formatBytes(0)).toBe('0 MB');
  });

  it('clamps a negative figure to zero', () => {
    expect(formatBytes(-5)).toBe('0 MB');
  });
});

describe('CapacityIndicatorComponent', () => {
  let fixture: ComponentFixture<CapacityIndicatorComponent>;
  let storage: WritableSignal<StorageCapacity>;
  let residentMemory: WritableSignal<ResidentMemoryEstimate>;

  function memoryFill(): HTMLElement {
    return fixture.debugElement.query(
      By.css('.capacity-indicator__memory-fill'),
    ).nativeElement as HTMLElement;
  }

  function text(selector: string): string {
    return (
      fixture.debugElement.query(By.css(selector)).nativeElement as HTMLElement
    ).textContent!.trim();
  }

  beforeEach(async () => {
    storage = signal<StorageCapacity>({
      usedBytes: 500_000_000,
      quotaBytes: 8_000_000_000,
      modelsEstimateBytes: 400_000_000,
    });
    residentMemory = signal<ResidentMemoryEstimate>({
      estimatedBytes: 200_000_000,
      residentCount: 2,
      budgetBytes: RAM_BUDGET_BYTES,
    });

    await TestBed.configureTestingModule({
      imports: [CapacityIndicatorComponent],
      providers: [
        // A stub CapacityService built on REAL writable signals. This is the
        // mechanism that actually supports reactivity under OnPush — unlike
        // workbench.component.spec.ts's outer suite, whose hand-rolled
        // selectSignal returns plain closures that never re-evaluate. See the
        // "live" test at the bottom of this suite.
        { provide: CapacityService, useValue: { storage, residentMemory } },
        {
          provide: TranslocoService,
          useValue: {
            getActiveLang: () => 'en',
            langChanges$: of('en'),
            translate: (key: string) => key,
            selectTranslate: () => of(''),
            config: { reRenderOnLangChange: false },
            // TranslocoPipe.transform() resolves its scope through this
            // before it will call translate() at all — without it every
            // piped label renders as the pipe's empty initial value.
            _loadDependencies: () => of({}),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CapacityIndicatorComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders both bars', () => {
    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__storage-models')),
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(
        By.css('.capacity-indicator__storage-annotations'),
      ),
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__memory-fill')),
    ).toBeTruthy();
  });

  it('splits the storage bar into a models segment and an annotations segment', () => {
    const models = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-models'),
    ).nativeElement as HTMLElement;
    const annotations = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-annotations'),
    ).nativeElement as HTMLElement;

    // 400 MB of 8 GB = 5%; the remaining 100 MB of the 500 MB used = 1.25%.
    expect(models.style.width).toBe('5%');
    expect(annotations.style.width).toBe('1.25%');
  });

  it('never lets a configured-but-undownloaded model overflow the used figure', () => {
    storage.set({
      usedBytes: 100_000_000,
      quotaBytes: 8_000_000_000,
      modelsEstimateBytes: 1_200_000_000,
    });
    fixture.detectChanges();

    const models = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-models'),
    ).nativeElement as HTMLElement;
    const annotations = fixture.debugElement.query(
      By.css('.capacity-indicator__storage-annotations'),
    ).nativeElement as HTMLElement;

    // Models clamp to the real 100 MB used (1.25%), annotations to zero.
    expect(models.style.width).toBe('1.25%');
    expect(annotations.style.width).toBe('0%');
  });

  it('shows the unavailable note instead of the breakdown when there is no quota', () => {
    storage.set({ usedBytes: 0, quotaBytes: 0, modelsEstimateBytes: 0 });
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__storage-note')),
    ).toBeFalsy();
    expect(text('.capacity-indicator__storage-unavailable')).toBe(
      'workbench.capacity.storage_unavailable',
    );
  });

  // F1 (step 3c final review): nothing configured yet means the
  // models/annotations split is UNKNOWN, not genuinely zero. Before the fix,
  // this state rendered the normal breakdown note claiming "Models 0 MB
  // cached", confidently misattributing any real cached-model bytes (from
  // `/local`, which this route can't see) entirely to "annotations".
  it('shows a breakdown-unavailable note instead of a confident 0 MB models split when nothing is configured, even with heavy real usage', () => {
    storage.set({
      usedBytes: 1_500_000_000,
      quotaBytes: 8_000_000_000,
      modelsEstimateBytes: 0,
    });
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('.capacity-indicator__storage-note')),
    ).toBeFalsy();
    expect(
      fixture.debugElement.query(
        By.css('.capacity-indicator__storage-breakdown-unavailable'),
      ),
    ).toBeTruthy();
    expect(text('.capacity-indicator__storage-breakdown-unavailable')).toBe(
      'workbench.capacity.storage_breakdown_unavailable',
    );
  });

  it('still renders the normal models/annotations breakdown once a model is configured', () => {
    // Default beforeEach state already has modelsEstimateBytes: 400_000_000
    // (non-zero) — this is the happy-path regression guard for F1's fix.
    expect(
      fixture.debugElement.query(
        By.css('.capacity-indicator__storage-breakdown-unavailable'),
      ),
    ).toBeFalsy();
    expect(text('.capacity-indicator__storage-note')).toBe(
      'workbench.capacity.storage_note',
    );
  });

  it('colours the memory bar green below 55% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.3,
      residentCount: 1,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--ok',
    );
  });

  it('colours the memory bar amber between 55% and 80% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.6,
      residentCount: 3,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--warn',
    );
  });

  it('colours the memory bar red above 80% of budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.9,
      residentCount: 5,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--danger',
    );
  });

  it('caps the memory bar width at 100% when the estimate exceeds the budget', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 2,
      residentCount: 9,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().style.width).toBe('100%');
  });

  // The coverage gap step 3b-i's own review had to retro-fix: a suite that
  // only ever renders one fixed state proves nothing about a LIVE bar. This
  // drives the same fixture through two states and asserts both the colour
  // class and the width actually change.
  it('re-renders live when the resident-memory signal changes under it', () => {
    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.1,
      residentCount: 1,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();
    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--ok',
    );
    expect(memoryFill().style.width).toBe('10%');

    residentMemory.set({
      estimatedBytes: RAM_BUDGET_BYTES * 0.85,
      residentCount: 6,
      budgetBytes: RAM_BUDGET_BYTES,
    });
    fixture.detectChanges();

    expect(memoryFill().classList).toContain(
      'capacity-indicator__memory-fill--danger',
    );
    expect(memoryFill().classList).not.toContain(
      'capacity-indicator__memory-fill--ok',
    );
    expect(memoryFill().style.width).toBe('85%');
  });

  it('exposes the formatted figures the copy interpolates', () => {
    const component = fixture.componentInstance;

    expect(component.storageUsedText()).toBe('500 MB');
    expect(component.storageQuotaText()).toBe('8.0 GB');
    expect(component.modelsText()).toBe('400 MB');
    expect(component.annotationsText()).toBe('100 MB');
    expect(component.memoryUsedText()).toBe('200 MB');
    expect(component.memoryBudgetText()).toBe('2.0 GB');
    expect(component.residentCount()).toBe(2);
  });
});
