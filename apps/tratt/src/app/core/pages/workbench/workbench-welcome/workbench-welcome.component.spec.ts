import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, jest } from '@jest/globals';
import { TranslocoPipe, TranslocoTestingModule } from '@jsverse/transloco';
import { WorkbenchWelcomeComponent } from './workbench-welcome.component';

describe('WorkbenchWelcomeComponent', () => {
  let fixture: ComponentFixture<WorkbenchWelcomeComponent>;
  let el: HTMLElement;

  const create = async () => {
    TestBed.configureTestingModule({
      imports: [
        WorkbenchWelcomeComponent,
        TranslocoTestingModule.forRoot({
          langs: {
            en: {
              workbench: {
                welcome: {
                  language: 'Transcription language: {{language}}',
                },
              },
            },
          },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
    // Credits and footer are checked by their own specs.
    TestBed.overrideComponent(WorkbenchWelcomeComponent, {
      set: { imports: [TranslocoPipe], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    fixture = TestBed.createComponent(WorkbenchWelcomeComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const file = (name: string) => new File(['x'], name, { type: 'audio/wav' });

  it('shows the other ways in, the steps and the footer', async () => {
    await create();
    expect(el.querySelector('.welcome__manual')).not.toBeNull();
    expect(el.querySelectorAll('.welcome__step').length).toBe(3);
    expect(el.querySelector('tratt-footer')).not.toBeNull();
  });

  it('picks files to transcribe by hand', async () => {
    await create();
    const emitted = jest.fn();
    fixture.componentInstance.addByHand.subscribe(emitted);
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = jest
      .spyOn(input, 'click')
      .mockImplementation(() => undefined);

    el.querySelector<HTMLButtonElement>('.welcome__manual button')!.click();
    expect(click).toHaveBeenCalled();
    const files = [file('a.wav')];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(emitted).toHaveBeenCalledWith(files);
  });

  it('asks for the demo recording, and waits while it loads', async () => {
    await create();
    const demo = jest.fn();
    fixture.componentInstance.startDemo.subscribe(demo);
    const button = el.querySelector<HTMLButtonElement>(
      '.welcome__options > button',
    )!;
    button.click();
    expect(demo).toHaveBeenCalled();

    fixture.componentRef.setInput('demoLoading', true);
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.spinner-border')).not.toBeNull();
  });

  it('names the transcription language and opens the settings', async () => {
    await create();
    expect(el.querySelector('.welcome__settings')).toBeNull();
    fixture.componentRef.setInput('language', 'Swedish');
    fixture.detectChanges();

    const line = el.querySelector('.welcome__settings')!;
    expect(line.textContent).toContain('Transcription language: Swedish');
    const open = jest.fn();
    fixture.componentInstance.openSettings.subscribe(open);
    line.querySelector<HTMLButtonElement>('button')!.click();
    expect(open).toHaveBeenCalled();
  });
});
