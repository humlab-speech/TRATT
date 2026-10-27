import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslocoService } from '@jsverse/transloco';
import { of } from 'rxjs';
import {
  DataSelectorComponent,
  DataSelectorHeader,
} from './data-selector.component';

describe('DataSelectorComponent', () => {
  let fixture: ComponentFixture<DataSelectorComponent>;
  const files = [
    { id: 'a', name: 'a.wav' },
    { id: 'b', name: 'b.wav' },
    { id: 'c', name: 'c.wav' },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DataSelectorComponent],
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
      ],
    });
    fixture = TestBed.createComponent(DataSelectorComponent);
  });

  const set = (header: DataSelectorHeader, selectedId = 'b') => {
    fixture.componentRef.setInput('header', header);
    fixture.componentRef.setInput('files', files);
    fixture.componentRef.setInput('selectedId', selectedId);
    fixture.detectChanges();
  };
  const text = () => fixture.nativeElement.textContent as string;

  it('shows name and metadata', () => {
    set({
      name: 'b.wav',
      durationText: '0:12',
      sampleRateKhz: 44.1,
      channels: 1,
      sizeText: '1 MB',
    });
    expect(text()).toContain('b.wav');
    expect(text()).toContain('0:12 · 44.1 kHz');
    expect(text()).toContain('1 MB');
  });

  it('shows audio_not_attached without durationText', () => {
    set({ name: 'b.wav' });
    expect(text()).toContain('workbench.editor_header.audio_not_attached');
  });

  it('computes the position of the selected file', () => {
    set({ name: 'b.wav' });
    expect(fixture.componentInstance.position()).toEqual({
      index: 2,
      total: 3,
    });
  });

  it('emits selectFile when a menu item is clicked', () => {
    set({ name: 'b.wav' });
    const emitted: string[] = [];
    fixture.componentInstance.selectFile.subscribe((id) => emitted.push(id));
    const items = fixture.debugElement.queryAll(By.css('.dropdown-item'));
    expect(items.length).toBe(3);
    items[2].nativeElement.click();
    expect(emitted).toEqual(['c']);
  });
});
