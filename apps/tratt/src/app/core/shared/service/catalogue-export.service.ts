import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppInfo } from '../../../app.info';
import { Observable } from 'rxjs';
import { strToU8, zipSync } from 'fflate';
import { RootState } from '../../store/index';
import { selectLocalMode } from '../../store/login-mode/annotation/annotation.selectors';
import { IdentifiedAnnotationState } from '../../store/login-mode/annotation/local-bundle-collection';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';
import { BUILD_INFO } from '../../../build-info';

export interface CatalogueExportProgress {
  completedBundles: number;
  totalBundles: number;
  currentBundleName: string | null;
  /** Set only on the final emission. */
  archive?: Uint8Array;
  /** Per-bundle/per-file problems that didn't abort the export. */
  warnings: string[];
}

interface ManifestRow {
  bundleId: string;
  sourceFilename: string;
  durationSamples: number;
  sampleRate: number;
  model: string | null;
  language: string | null;
  stagesRun: string[];
  unitCounts: number;
  appVersion: string;
}

/**
 * Turns N bundles into one downloadable zip: `bundles/<slug>/<name>.<ext>`
 * per requested converter format, plus `manifest.json`/`manifest.csv`.
 *
 * Deliberately sequential (one bundle `ensureResident()`d at a time, never
 * `forkJoin`'d) — see the spec's Step 4 design, finding #5: this is the
 * actual memory bound the master plan's "stream, don't buffer" language was
 * written for. Uses `fflate.zipSync()` (whole archive in memory) rather than
 * the streaming `Zip` API on purpose — annotation exports are text-sized;
 * see the same spec section's "Simplification, deliberate" note.
 */
@Injectable({ providedIn: 'root' })
export class CatalogueExportService {
  // Bound once, matching AudioService/BundleListComponent's own
  // `selectSignal` convention — read fresh inside run()'s loop via
  // `this.localMode()`, not re-bound per bundle.
  private localMode = this.store.selectSignal(selectLocalMode);

  constructor(
    private store: Store<RootState>,
    private audioService: AudioService,
    private pipelineQueueService: PipelineQueueService,
  ) {}

  exportBundles(
    bundleIds: string[],
    converterNames: string[],
  ): Observable<CatalogueExportProgress> {
    return new Observable<CatalogueExportProgress>((subscriber) => {
      void this.run(bundleIds, converterNames, subscriber);
    });
  }

  private async run(
    bundleIds: string[],
    converterNames: string[],
    subscriber: {
      next: (v: CatalogueExportProgress) => void;
      complete: () => void;
      error: (e: unknown) => void;
    },
  ): Promise<void> {
    const converters = AppInfo.converters.filter((c) =>
      converterNames.includes(c.name),
    );
    const files: Record<string, Uint8Array> = {};
    const manifestRows: ManifestRow[] = [];
    const warnings: string[] = [];
    const usedSlugs = new Set<string>();

    for (let i = 0; i < bundleIds.length; i++) {
      const bundleId = bundleIds[i];
      const isLast = i === bundleIds.length - 1;
      const entity = this.localMode().bundles.entities[bundleId];
      if (!entity) {
        warnings.push(`Skipped ${bundleId}: bundle no longer exists.`);
        if (!isLast) {
          subscriber.next({
            completedBundles: i + 1,
            totalBundles: bundleIds.length,
            currentBundleName: null,
            warnings: [...warnings],
          });
        }
        continue;
      }

      const resident = await this.audioService.ensureResident(bundleId);
      const manager = resident
        ? this.audioService.getManager(bundleId)
        : undefined;
      if (!manager) {
        warnings.push(
          `Skipped ${bundleId} (${entity.sessionFile?.name ?? 'unknown file'}): audio could not be made resident.`,
        );
        if (!isLast) {
          subscriber.next({
            completedBundles: i + 1,
            totalBundles: bundleIds.length,
            currentBundleName: entity.sessionFile?.name ?? null,
            warnings: [...warnings],
          });
        }
        continue;
      }

      const slug = this.uniqueSlug(
        entity.sessionFile?.name ?? bundleId,
        usedSlugs,
      );
      const oAudioFile = manager.resource.getOAudioFile();
      const oannotjson = entity.transcript.serialize(
        entity.audio.fileName,
        manager.sampleRate,
        manager.resource.info.duration,
      );

      let unitCounts = 0;
      for (const level of oannotjson.levels) {
        unitCounts += (level as { items?: unknown[] }).items?.length ?? 0;
      }

      for (const converter of converters) {
        // Non-multitier converters (SRT, ELAN, ...) require an explicit
        // level number — the same default ExportFilesModalComponent applies
        // for its single-bundle export (`updateParentFormat()`).
        const levelnum = converter.multitiers ? undefined : 0;
        const result = converter.export(oannotjson, oAudioFile, levelnum);
        if (result.error || !result.file) {
          warnings.push(
            `${entity.sessionFile?.name ?? bundleId}: ${converter.name} export failed — ${result.error ?? 'no file produced'}.`,
          );
          continue;
        }
        const bytes =
          result.file.encoding === 'binary'
            ? (result.file.content as unknown as Uint8Array)
            : strToU8(result.file.content);
        files[`bundles/${slug}/${result.file.name}`] = bytes;
      }

      const options = this.pipelineQueueService.getTranscribeOptions();
      const stagesRun: string[] = [];
      if (options) {
        stagesRun.push('asr');
        if (options.diarization) {
          stagesRun.push('diarization');
        }
      }
      manifestRows.push({
        bundleId,
        sourceFilename: entity.sessionFile?.name ?? '',
        durationSamples: manager.resource.info.duration.samples,
        sampleRate: manager.sampleRate,
        model: options?.modelId ?? null,
        language: options?.language ?? null,
        stagesRun,
        unitCounts,
        appVersion: BUILD_INFO.version,
      });

      if (!isLast) {
        subscriber.next({
          completedBundles: i + 1,
          totalBundles: bundleIds.length,
          currentBundleName: entity.sessionFile?.name ?? null,
          warnings: [...warnings],
        });
      }
    }

    // One emission per bundle overall: the loop above emits the first
    // N-1 (or fewer, for a skipped/failed final bundle), and this is
    // always the final ("N-th") emission — the one that carries the
    // archive, per CatalogueExportProgress's own doc comment.
    files['manifest.json'] = strToU8(JSON.stringify(manifestRows, null, 2));
    files['manifest.csv'] = strToU8(this.toCsv(manifestRows));

    const archive = zipSync(files);
    subscriber.next({
      completedBundles: bundleIds.length,
      totalBundles: bundleIds.length,
      currentBundleName: null,
      archive,
      warnings: [...warnings],
    });
    subscriber.complete();
  }

  /** Matches step 2.7's basename-collision handling: first writer keeps the
   * bare slug, later same-name bundles get a `-2`, `-3`, ... suffix. */
  private uniqueSlug(fileName: string, used: Set<string>): string {
    const base = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_');
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n++}`;
    }
    used.add(slug);
    return slug;
  }

  private toCsv(rows: ManifestRow[]): string {
    const headers: (keyof ManifestRow)[] = [
      'bundleId',
      'sourceFilename',
      'durationSamples',
      'sampleRate',
      'model',
      'language',
      'stagesRun',
      'unitCounts',
      'appVersion',
    ];
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => {
            const v = row[h];
            const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(','),
      );
    }
    return lines.join('\n');
  }
}
