import {
  Component,
  computed,
  DestroyRef,
  effect,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgbTooltipModule } from '@ng-bootstrap/ng-bootstrap';
import { getEnglishLanguageLabel } from '@tratt/utilities';
import {
  LocalTranslationService,
  TranslationAvailability,
  TranslationOptions,
} from '../../shared/service/local-translation.service';

export const HYMT_LANGUAGES: readonly string[] = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'sv',
  'da',
  'no',
  'fi',
  'pl',
  'cs',
  'sk',
  'hu',
  'ro',
  'bg',
  'el',
  'tr',
  'ru',
  'uk',
  'ar',
  'he',
  'fa',
  'hi',
  'zh',
  'ja',
  'ko',
  'vi',
  'id',
  'th',
];

@Component({
  selector: 'tratt-auto-translate-options',
  standalone: true,
  imports: [FormsModule, NgbTooltipModule, TranslocoPipe],
  template: `
    @if (visible()) {
      <div class="auto-translate-options mt-2 p-2 border rounded">
        <div class="form-check mb-1">
          <input
            class="form-check-input"
            type="checkbox"
            id="autoTranslateCheck"
            [(ngModel)]="enabledModel"
            (ngModelChange)="onEnabledChange()"
          />
          <label class="form-check-label" for="autoTranslateCheck">
            {{ 'login.translation.enable label' | transloco }}
          </label>
        </div>

        @if (enabled()) {
          <div class="mb-2">
            <label for="translateFrom" class="form-label form-label-sm mb-1">
              {{ 'login.translation.from' | transloco }}
            </label>
            <select
              class="form-select form-select-sm"
              id="translateFrom"
              [(ngModel)]="sourceLanguage"
              (ngModelChange)="onSourceChange()"
              [disabled]="sourceDisabled()"
            >
              @for (lang of languages; track lang.code) {
                <option [value]="lang.code">{{ lang.label }}</option>
              }
            </select>
          </div>
          <div class="mb-2">
            <label for="translateTo" class="form-label form-label-sm mb-1">
              {{ 'login.translation.to' | transloco }}
            </label>
            <select
              class="form-select form-select-sm"
              id="translateTo"
              [(ngModel)]="targetLanguage"
              (ngModelChange)="onTargetChange()"
              [disabled]="targetProbing()"
            >
              @if (targetProbing()) {
                <option value="">
                  {{ 'login.translation.path probing' | transloco }}
                </option>
              }
              @for (lang of targetOptions(); track lang.code) {
                <option [value]="lang.code">{{ lang.label }}</option>
              }
            </select>
          </div>

          <div
            class="form-check mb-2"
            [ngbTooltip]="'login.translation.skip cache help' | transloco"
          >
            <input
              class="form-check-input"
              type="checkbox"
              id="skipBrowserCacheCheck"
              [(ngModel)]="skipBrowserCacheModel"
              (ngModelChange)="emitChange()"
            />
            <label class="form-check-label" for="skipBrowserCacheCheck">
              {{ 'login.translation.skip cache label' | transloco }}
            </label>
          </div>

          @if (availabilityKind() === 'direct') {
            <small class="text-muted d-block mb-1">
              <i class="bi bi-cloud-download"></i>
              {{ 'login.translation.path direct' | transloco }} —
              {{ formatBytes(estimatedBytes()) }}
            </small>
          } @else if (availabilityKind() === 'pivot') {
            <small class="text-muted d-block mb-1">
              <i class="bi bi-arrow-left-right"></i>
              {{ 'login.translation.path pivot' | transloco }} —
              {{ formatBytes(estimatedBytes()) }}
            </small>
          } @else if (availabilityKind() === 'unavailable') {
            <small class="text-danger d-block mb-1">
              <i class="bi bi-exclamation-triangle"></i>
              {{ 'login.translation.path unavailable' | transloco }}
            </small>
          } @else if (availabilityKind() === 'probing') {
            <small class="text-muted d-block mb-1">
              <i class="bi bi-hourglass-split"></i>
              {{ 'login.translation.path probing' | transloco }}
            </small>
          }

          <small class="text-muted mt-1 d-block">
            <i class="bi bi-info-circle"></i>
            {{ 'login.translation.model cached after download' | transloco }}
          </small>
        }
      </div>
    }
  `,
  styles: [
    `
      .auto-translate-options {
        background-color: var(--tratt-surface-background);
        font-size: 0.9rem;
      }
    `,
  ],
})
export class AutoTranslateOptionsComponent implements OnInit {
  readonly annotationAlreadyLoaded = input<boolean>(false);
  readonly transcribeWillRun = input<boolean>(false);
  readonly sourceLanguageHint = input<string | undefined>(undefined);
  readonly optionsChange = output<TranslationOptions | null>();

  readonly enabled = signal(false);

  get enabledModel(): boolean {
    return this.enabled();
  }
  set enabledModel(v: boolean) {
    this.enabled.set(v);
  }

  readonly languages = HYMT_LANGUAGES.map((code) => ({
    code,
    label: getEnglishLanguageLabel(code),
  }));

  sourceLanguage = 'en';
  targetLanguage = 'de';
  readonly skipBrowserCache = signal(false);

  readonly availabilityKind = signal<
    'direct' | 'pivot' | 'unavailable' | 'probing' | 'idle'
  >('idle');
  readonly estimatedBytes = signal(0);

  readonly targetOptions = signal<
    Array<{ code: string; label: string; path: 'direct' | 'pivot' }>
  >([]);
  readonly targetProbing = signal(false);
  private targetProbeSeq = 0;

  get skipBrowserCacheModel(): boolean {
    return this.skipBrowserCache();
  }
  set skipBrowserCacheModel(v: boolean) {
    this.skipBrowserCache.set(v);
  }
  private userOverrodeSource = false;
  private probeSeq = 0;

  readonly visible = computed(
    () => this.annotationAlreadyLoaded() || this.transcribeWillRun(),
  );

  readonly sourceDisabled = computed(() => this.transcribeWillRun());

  constructor(
    private readonly transloco: TranslocoService,
    private readonly destroyRef: DestroyRef,
    private readonly translationService: LocalTranslationService,
  ) {
    effect(() => {
      this.annotationAlreadyLoaded();
      this.transcribeWillRun();
      this.emitChange();
    });

    effect(() => {
      const hint = this.sourceLanguageHint();
      if (hint && !this.userOverrodeSource) {
        this.applySourceHint(hint);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.applySourceHint(
      this.sourceLanguageHint() ?? this.transloco.getActiveLang(),
    );

    this.transloco.langChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lang) => {
        if (!this.userOverrodeSource && !this.sourceLanguageHint()) {
          this.applySourceHint(lang);
        }
      });
  }

  private async refreshTargetLanguages(): Promise<void> {
    if (!this.visible() || !this.enabled()) {
      this.targetOptions.set([]);
      this.targetProbing.set(false);
      return;
    }
    const seq = ++this.targetProbeSeq;
    this.targetProbing.set(true);
    this.targetOptions.set([]);

    const reachable = await this.translationService.resolveReachableTargets(
      this.sourceLanguage,
      HYMT_LANGUAGES,
    );
    if (seq !== this.targetProbeSeq) return;

    const pivotSuffix = this.transloco.translate(
      'login.translation.path pivot suffix',
    );
    const newOptions = HYMT_LANGUAGES.filter((code) => reachable.has(code)).map(
      (code) => ({
        code,
        label:
          getEnglishLanguageLabel(code) +
          (reachable.get(code) === 'pivot' ? pivotSuffix : ''),
        path: reachable.get(code)!,
      }),
    );

    this.targetProbing.set(false);
    this.targetOptions.set(newOptions);

    if (!reachable.has(this.targetLanguage)) {
      this.targetLanguage = newOptions[0]?.code ?? '';
    }
    void this.refreshAvailability();
  }

  private applySourceHint(hint: string): void {
    const code = hint.split('-')[0].toLowerCase();
    this.sourceLanguage = HYMT_LANGUAGES.includes(code) ? code : 'en';
    this.targetLanguage = this.sourceLanguage === 'en' ? 'de' : 'en';
    void this.refreshTargetLanguages();
  }

  onEnabledChange(): void {
    this.userOverrodeSource = false;
    void this.refreshTargetLanguages();
  }

  onSourceChange(): void {
    this.userOverrodeSource = true;
    void this.refreshTargetLanguages();
  }

  onTargetChange(): void {
    void this.refreshAvailability();
  }

  private async refreshAvailability(): Promise<void> {
    if (!this.visible() || !this.enabled()) {
      this.availabilityKind.set('idle');
      this.estimatedBytes.set(0);
      this.optionsChange.emit(null);
      return;
    }
    if (this.sourceLanguage === this.targetLanguage) {
      this.availabilityKind.set('unavailable');
      this.estimatedBytes.set(0);
      this.optionsChange.emit(null);
      return;
    }
    const seq = ++this.probeSeq;
    this.availabilityKind.set('probing');
    const a: TranslationAvailability =
      await this.translationService.resolveAvailability(
        this.sourceLanguage,
        this.targetLanguage,
      );
    if (seq !== this.probeSeq) return;
    this.availabilityKind.set(a.kind);
    this.estimatedBytes.set(a.kind === 'unavailable' ? 0 : a.estimatedBytes);
    if (a.kind === 'unavailable') {
      this.optionsChange.emit(null);
      return;
    }
    this.emitChange();
  }

  emitChange(): void {
    if (!this.visible() || !this.enabled()) {
      this.optionsChange.emit(null);
      return;
    }
    if (this.sourceLanguage === this.targetLanguage) {
      this.optionsChange.emit(null);
      return;
    }
    if (
      this.availabilityKind() === 'unavailable' ||
      this.availabilityKind() === 'idle' ||
      this.availabilityKind() === 'probing'
    ) {
      this.optionsChange.emit(null);
      return;
    }
    this.optionsChange.emit({
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      skipBrowserCache: this.skipBrowserCache(),
    });
  }

  formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${(bytes / 1e6).toFixed(0)} MB`;
  }
}
