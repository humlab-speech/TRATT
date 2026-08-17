import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { OAnnotJSON, OLabel, OSegment, OSegmentLevel } from '@tratt/annotation';
import { getEnglishLanguageLabel } from '@tratt/utilities';
import { Observable, Subject } from 'rxjs';
import type {
  PlanStage,
  TranslationPlan,
  TranslationSegment,
  TWorkerOutMessage,
  WorkerTranslateMessage,
} from '../../workers/translation.worker';

export interface TranslationDownloadProgress {
  type: 'download-progress';
  loaded: number;
  total: number;
  file: string;
}

export interface TranslationModelInit {
  type: 'model-init';
}

export interface TranslationStart {
  type: 'translate-start';
  total: number;
}

export interface TranslationSegmentProgress {
  type: 'segment-progress';
  index: number;
  total: number;
}

export interface TranslationResult {
  type: 'result';
  annotJson: OAnnotJSON;
}

export interface TranslationSegmentsResult {
  type: 'segments';
  translated: TranslationSegment[];
}

export interface TranslationError {
  type: 'error';
  message: string;
}

export type TranslationEvent =
  | TranslationDownloadProgress
  | TranslationModelInit
  | TranslationStart
  | TranslationSegmentProgress
  | TranslationResult
  | TranslationSegmentsResult
  | TranslationError;

export interface TranslationOptions {
  sourceLanguage: string;
  targetLanguage: string;
  skipBrowserCache?: boolean;
}

export type TranslationAvailability =
  | { kind: 'direct'; modelId: string; estimatedBytes: number }
  | { kind: 'pivot'; legA: string; legB: string; estimatedBytes: number }
  | { kind: 'unavailable'; reason: string };

export const TRANSLATION_REQUIRED_BYTES = 200_000_000;

export const MULTILINGUAL_MODEL_ID = 'Xenova/m2m100_418M';
export const MULTILINGUAL_BYTES = 450_000_000;
export const OPUS_MT_BYTES_PER_PAIR = 80_000_000;

const HF_BASE = 'https://huggingface.co';

/**
 * Curated list of `Xenova/opus-mt-<src>-<tgt>` model pairs known to exist on
 * Hugging Face. Probing any pair outside this set returns 401 (the CDN does
 * not return 404 for unknown opus-mt paths), spamming the DevTools console.
 * Extend this list as Xenova publishes more pairs.
 *
 * Source coverage is intentionally narrow — for an absent target the
 * translate-modal still pivots through English when both legs exist here.
 */
const OPUS_MT_AVAILABLE: ReadonlySet<string> = new Set<string>([
  // English ↔ many languages (well covered by Helsinki-NLP / Xenova)
  'en-de',
  'en-fr',
  'en-es',
  'en-it',
  'en-pt',
  'en-nl',
  'en-sv',
  'en-da',
  'en-fi',
  'en-pl',
  'en-cs',
  'en-hu',
  'en-ro',
  'en-ru',
  'en-uk',
  'en-ar',
  'en-zh',
  'en-hi',
  'en-vi',
  'en-id',
  'de-en',
  'fr-en',
  'es-en',
  'it-en',
  'pt-en',
  'nl-en',
  'sv-en',
  'da-en',
  'fi-en',
  'pl-en',
  'cs-en',
  'hu-en',
  'ro-en',
  'ru-en',
  'uk-en',
  'ar-en',
  'zh-en',
  'hi-en',
  'vi-en',
  'id-en',
  // A few non-English direct pairs that exist
  'de-fr',
  'fr-de',
  'de-es',
  'es-de',
  'fr-es',
  'es-fr',
]);

function opusMtPairKey(modelId: string): string | undefined {
  const m = /^Xenova\/opus-mt-([a-z]{2,3})-([a-z]{2,3})$/.exec(modelId);
  return m ? `${m[1]}-${m[2]}` : undefined;
}

@Injectable({ providedIn: 'root' })
export class LocalTranslationService implements OnDestroy {
  private worker: Worker | null = null;
  private subject: Subject<TranslationEvent> | null = null;
  private readonly probeCache = new Map<string, Promise<boolean>>();

  constructor(private ngZone: NgZone) {}

  async resolveAvailability(
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<TranslationAvailability> {
    if (sourceLanguage === targetLanguage) {
      return { kind: 'unavailable', reason: 'source and target are the same' };
    }
    const direct = opusMtId(sourceLanguage, targetLanguage);
    if (await this.probeModel(direct)) {
      return {
        kind: 'direct',
        modelId: direct,
        estimatedBytes: OPUS_MT_BYTES_PER_PAIR,
      };
    }
    if (sourceLanguage !== 'en' && targetLanguage !== 'en') {
      const a = opusMtId(sourceLanguage, 'en');
      const b = opusMtId('en', targetLanguage);
      const [okA, okB] = await Promise.all([
        this.probeModel(a),
        this.probeModel(b),
      ]);
      if (okA && okB) {
        return {
          kind: 'pivot',
          legA: a,
          legB: b,
          estimatedBytes: OPUS_MT_BYTES_PER_PAIR * 2,
        };
      }
    }
    return {
      kind: 'unavailable',
      reason: `No local opus-mt path for ${sourceLanguage}\u2192${targetLanguage}.`,
    };
  }

  async resolveReachableTargets(
    src: string,
    candidates: readonly string[],
  ): Promise<Map<string, 'direct' | 'pivot'>> {
    const results = new Map<string, 'direct' | 'pivot'>();
    const targets = candidates.filter((c) => c !== src);

    await Promise.all(
      targets.map(async (tgt) => {
        if (await this.probeModel(opusMtId(src, tgt))) {
          results.set(tgt, 'direct');
        }
      }),
    );

    if (src !== 'en') {
      const canSrcToEn = await this.probeModel(opusMtId(src, 'en'));
      if (canSrcToEn) {
        await Promise.all(
          targets
            .filter((tgt) => tgt !== 'en' && !results.has(tgt))
            .map(async (tgt) => {
              if (await this.probeModel(opusMtId('en', tgt))) {
                results.set(tgt, 'pivot');
              }
            }),
        );
      }
    }

    return results;
  }

  private probeModel(modelId: string): Promise<boolean> {
    const hit = this.probeCache.get(modelId);
    if (hit) return hit;

    // Short-circuit known-absent OPUS-MT pairs to avoid 401 console noise.
    // The HF CDN returns 401 (not 404) for opus-mt paths that do not exist.
    const pairKey = opusMtPairKey(modelId);
    if (pairKey && !OPUS_MT_AVAILABLE.has(pairKey)) {
      const p = Promise.resolve(false);
      this.probeCache.set(modelId, p);
      return p;
    }

    const url = `${HF_BASE}/${modelId}/resolve/main/config.json`;
    const p = fetch(url, { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
    this.probeCache.set(modelId, p);
    return p;
  }

  translate(
    annotJson: OAnnotJSON,
    options: TranslationOptions,
  ): Observable<TranslationEvent> {
    const sourceLevel = (annotJson.levels ?? []).find(
      (l): l is OSegmentLevel<OSegment> => l instanceof OSegmentLevel,
    );

    if (!sourceLevel) {
      this.cancel();
      const subject = new Subject<TranslationEvent>();
      this.subject = subject;
      queueMicrotask(() =>
        subject.error(new Error('No segment level found to translate')),
      );
      return subject.asObservable();
    }

    const sourceTexts = sourceLevel.items.map(
      (item) => item.labels?.[0]?.value ?? '',
    );

    return this.runWorker(sourceTexts, options, (translated, subject) => {
      try {
        const augmented = this.appendTranslatedLevel(
          annotJson,
          sourceLevel,
          translated,
          options,
        );
        subject.next({ type: 'result', annotJson: augmented });
      } catch (err: unknown) {
        subject.error(err);
        return;
      }
      subject.complete();
    });
  }

  /**
   * Translate an arbitrary array of source texts and emit a `'segments'`
   * event with the translated array — used by the editor-time linked-tier
   * translate flow, which patches an existing linked level rather than
   * appending new levels.
   */
  translateSegments(
    sourceTexts: string[],
    options: TranslationOptions,
  ): Observable<TranslationEvent> {
    return this.runWorker(sourceTexts, options, (translated, subject) => {
      subject.next({ type: 'segments', translated });
      subject.complete();
    });
  }

  private runWorker(
    sourceTexts: string[],
    options: TranslationOptions,
    onResult: (
      translated: TranslationSegment[],
      subject: Subject<TranslationEvent>,
    ) => void,
  ): Observable<TranslationEvent> {
    this.cancel();

    const subject = new Subject<TranslationEvent>();
    this.subject = subject;

    const segments: TranslationSegment[] = sourceTexts.map((text, idx) => ({
      id: idx,
      text,
    }));

    if (!segments.some((s) => s.text.trim().length > 0)) {
      queueMicrotask(() =>
        subject.error(new Error('Source level contains no text to translate')),
      );
      return subject.asObservable();
    }

    const skipCache = options.skipBrowserCache === true;

    void (async () => {
      const availability = await this.resolveAvailability(
        options.sourceLanguage,
        options.targetLanguage,
      );
      if (availability.kind === 'unavailable') {
        this.ngZone.run(() => {
          subject.error(new Error(availability.reason));
          this.cleanup();
        });
        return;
      }

      const requiredBytes = availability.estimatedBytes;
      if (!skipCache && navigator.storage?.estimate) {
        try {
          const { quota = 0, usage = 0 } = await navigator.storage.estimate();
          const available = quota - usage;
          if (available > 0 && available < requiredBytes) {
            this.ngZone.run(() => {
              subject.error(
                new Error(
                  `Not enough browser storage for the translation model. ` +
                    `Need ~${(requiredBytes / 1e6).toFixed(0)} MB free, ` +
                    `have ${(available / 1e6).toFixed(0)} MB. ` +
                    `Free space, or enable "Skip browser cache" in the translation options.`,
                ),
              );
              this.cleanup();
            });
            return;
          }
        } catch {
          // estimate not available; fall through
        }
      }
      try {
        await navigator.storage?.persist?.();
      } catch {
        // best-effort
      }

      const plan = buildPlanFromAvailability(
        availability,
        options.sourceLanguage,
        options.targetLanguage,
      );
      this.spawnWorker(segments, subject, skipCache, plan, onResult);
    })();

    return subject.asObservable();
  }

  private spawnWorker(
    segments: TranslationSegment[],
    subject: Subject<TranslationEvent>,
    skipCache: boolean,
    plan: TranslationPlan,
    onResult: (
      translated: TranslationSegment[],
      subject: Subject<TranslationEvent>,
    ) => void,
  ): void {
    const worker = new Worker(
      new URL('../../workers/translation.worker', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;

    worker.onmessage = ({ data }: MessageEvent<TWorkerOutMessage>) => {
      this.ngZone.run(() => {
        if (data.type === 'result') {
          try {
            onResult(data.translated, subject);
          } catch (err: unknown) {
            subject.error(err);
          }
          this.cleanup();
        } else if (data.type === 'error') {
          subject.error(new Error(this.friendlyError(data.message)));
          this.cleanup();
        } else {
          subject.next(data);
        }
      });
    };

    worker.onerror = (err) => {
      this.ngZone.run(() => {
        subject.error(new Error(this.friendlyError(err.message ?? '')));
        this.cleanup();
      });
    };

    const message: WorkerTranslateMessage = {
      type: 'translate',
      plan,
      segments,
      skipBrowserCache: skipCache,
    };
    worker.postMessage(message);
  }

  cancel(): void {
    if (this.worker) {
      this.cleanup();
    }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private cleanup(): void {
    const w = this.worker;
    this.worker = null;
    w?.terminate();
    if (this.subject && !this.subject.closed) {
      this.subject.complete();
    }
    this.subject = null;
  }

  private appendTranslatedLevel(
    annotJson: OAnnotJSON,
    sourceLevel: OSegmentLevel<OSegment>,
    translated: TranslationSegment[],
    options: TranslationOptions,
  ): OAnnotJSON {
    const sourceLevelName = getEnglishLanguageLabel(options.sourceLanguage);
    const targetLevelName = getEnglishLanguageLabel(options.targetLanguage);

    const usedNames = new Set(annotJson.levels.map((l) => l.name));

    let uniqueSourceName = sourceLevelName;
    let counter = 2;
    while (usedNames.has(uniqueSourceName)) {
      uniqueSourceName = `${sourceLevelName} (${counter++})`;
    }
    usedNames.add(uniqueSourceName);

    let uniqueTargetName = targetLevelName;
    counter = 2;
    while (usedNames.has(uniqueTargetName)) {
      uniqueTargetName = `${targetLevelName} (${counter++})`;
    }

    const extraLabelsOf = (item: OSegment) =>
      (item.labels ?? []).slice(1).map((l) => new OLabel(l.name, l.value));

    const sourceItems = sourceLevel.items.map((item, idx) => {
      const label = item.labels?.[0];
      const labels: OLabel[] = label
        ? [new OLabel(uniqueSourceName, label.value)]
        : [];
      labels.push(...extraLabelsOf(item));
      return new OSegment(idx + 1, item.sampleStart, item.sampleDur, labels);
    });

    const targetItems = sourceLevel.items.map((item, idx) => {
      const tr = translated.find((t) => t.id === idx);
      const text = tr?.text ?? '';
      const labels: OLabel[] = [new OLabel(uniqueTargetName, text)];
      labels.push(...extraLabelsOf(item));
      return new OSegment(idx + 1, item.sampleStart, item.sampleDur, labels);
    });

    const sourceLevel_ = new OSegmentLevel<OSegment>(
      uniqueSourceName,
      sourceItems,
    );
    const targetLevel = new OSegmentLevel<OSegment>(
      uniqueTargetName,
      targetItems,
      uniqueSourceName,
      'translation',
    );

    const mergedLevels = [
      sourceLevel_.serialize(),
      ...(annotJson.levels ?? [])
        .filter((l) => l.name !== sourceLevel.name)
        .map((l) => l.serialize()),
      targetLevel.serialize(),
    ];
    const mergedLinks = (annotJson.links ?? []).map((l) => l.serialize());
    return new OAnnotJSON(
      annotJson.annotates,
      annotJson.name,
      annotJson.sampleRate,
      mergedLevels,
      mergedLinks,
    );
  }

  private friendlyError(raw: string): string {
    if (/^\d+$/.test(raw.trim())) {
      return (
        `Translation engine crashed (code ${raw}). The model is likely too large ` +
        `for browser memory. Try reloading; if it persists, switch to a smaller pair.`
      );
    }
    return raw;
  }
}

export function opusMtId(src: string, tgt: string): string {
  return `Xenova/opus-mt-${src}-${tgt}`;
}

function buildPlanFromAvailability(
  a: Exclude<TranslationAvailability, { kind: 'unavailable' }>,
  src: string,
  tgt: string,
): TranslationPlan {
  if (a.kind === 'direct') {
    const stage: PlanStage = {
      modelId: a.modelId,
      family: 'opus-mt',
      srcLang: src,
      tgtLang: tgt,
    };
    return { stages: [stage] };
  }
  return {
    stages: [
      { modelId: a.legA, family: 'opus-mt', srcLang: src, tgtLang: 'en' },
      { modelId: a.legB, family: 'opus-mt', srcLang: 'en', tgtLang: tgt },
    ],
  };
}
