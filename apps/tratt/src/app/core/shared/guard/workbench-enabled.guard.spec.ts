import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { WORKBENCH_ENABLED_GUARD } from './workbench-enabled.guard';
import { environment } from '../../../../environments/environment';

describe('WORKBENCH_ENABLED_GUARD', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { parseUrl: jest.fn((url: string) => url) } }],
    });
    router = TestBed.inject(Router);
  });

  it('allows activation when environment.workbenchEnabled is true', () => {
    (environment as any).workbenchEnabled = true;
    const result = TestBed.runInInjectionContext(() =>
      WORKBENCH_ENABLED_GUARD({} as any, {} as any),
    );
    expect(result).toBe(true);
  });

  it('redirects to /local when environment.workbenchEnabled is false', () => {
    (environment as any).workbenchEnabled = false;
    const result = TestBed.runInInjectionContext(() =>
      WORKBENCH_ENABLED_GUARD({} as any, {} as any),
    );
    expect(router.parseUrl).toHaveBeenCalledWith('/local');
    expect(result).toBe('/local');
  });
});
