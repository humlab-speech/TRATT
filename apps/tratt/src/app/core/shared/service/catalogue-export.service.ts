import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { OAnnotJSON } from '@tratt/annotation';
import { OAudiofile, SampleUnit } from '@tratt/media';
import { strToU8, zipSync } from 'fflate';
import { Observable } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { BUILD_INFO } from '../../../build-info';
import { RootState } from '../../store/index';
import { selectLocalMode } from '../../store/login-mode/annotation/annotation.selectors';
import { IdentifiedAnnotationState } from '../../store/login-mode/annotation/local-bundle-collection';
import { transcriptEnd } from '../transcript-timing';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';

export interface CatalogueExportProgress {
  completedBundles: number;
  totalBundles: number;
  currentBundleName: string | null;
  /** Set only on the final emission. */
  archive?: Uint8Array;
  /** Per-bundle/per-file problems that didn't abort the export. */
  warnings: string[];
}

export interface ResolvedMedia {
  oAudioFile: OAudiofile;
  sampleRate: number;
  duration: SampleUnit;
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
      this.run(bundleIds, converterNames, subscriber).catch((err) =>
        subscriber.error(err),
      );
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

      let media: ResolvedMedia | undefined;
      let oannotjson: OAnnotJSON | undefined;
      let skipReason = 'audio could not be made resident';
      try {
        media = await this.resolveMedia(bundleId, entity);
        if (media) {
          oannotjson = entity.transcript.serialize(
            entity.audio.fileName || media.oAudioFile.name,
            media.sampleRate,
            media.duration,
          );
        }
      } catch (error) {
        // One unreadable bundle must not abort (or, as before, silently
        // hang) the whole catalogue: record it and carry on.
        skipReason = error instanceof Error ? error.message : String(error);
        media = undefined;
        oannotjson = undefined;
      }
      if (!media || !oannotjson) {
        warnings.push(
          `Skipped ${bundleId} (${entity.sessionFile?.name ?? 'unknown file'}): ${skipReason}.`,
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

      let unitCounts = 0;
      for (const level of oannotjson.levels) {
        unitCounts += (level as { items?: unknown[] }).items?.length ?? 0;
      }

      // A bundle that never produced a transcript (failed, cancelled, or not
      // run yet) would only yield empty DOCX/SRT/ELAN files: leave it out and
      // say so, rather than archiving blank "transcriptions".
      if (unitCounts === 0) {
        warnings.push(
          `Skipped ${entity.sessionFile?.name ?? bundleId}: it has no transcript yet.`,
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
      const oAudioFile = media.oAudioFile;

      for (const converter of converters) {
        // Multitier converters (ELAN, JSON, ...) take all levels at once.
        // Single-tier ones (SRT, DOCX, ...) need an explicit level number —
        // export every segment tier (e.g. the transcript AND its translation)
        // so a translated bundle gets translated subtitles too, not just tier 0.
        const levelnums: (number | undefined)[] = converter.multitiers
          ? [undefined]
          : this.segmentLevelNumbers(oannotjson);
        for (const levelnum of levelnums) {
          let result;
          try {
            result = converter.export(oannotjson, oAudioFile, levelnum);
          } catch (error) {
            result = {
              error: error instanceof Error ? error.message : String(error),
              file: undefined,
            };
          }
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
          files[this.uniquePath(files, `bundles/${slug}`, result.file.name)] =
            bytes;
        }
      }

      const options = this.pipelineQueueService.getTranscribeOptions();
      const stagesRun: string[] = [];
      if (options) {
        stagesRun.push('asr');
        if (options.diarization) {
          stagesRun.push('diarization');
        }
        if (this.pipelineQueueService.getTranslateOptions()) {
          stagesRun.push('translation');
        }
      }
      manifestRows.push({
        bundleId,
        sourceFilename: entity.sessionFile?.name ?? '',
        durationSamples: media.duration.samples,
        sampleRate: media.sampleRate,
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

  /**
   * `resolveMedia()` for one bundle by id — what the workbench's per-file
   * "Export this transcription" uses, so it works without attached audio.
   */
  async resolveBundleMedia(
    bundleId: string,
  ): Promise<ResolvedMedia | undefined> {
    const entity = this.localMode()?.bundles.entities[bundleId];
    return entity ? this.resolveMedia(bundleId, entity) : undefined;
  }

  /**
   * Everything an export needs from a bundle's media — sample rate, duration
   * and an `OAudiofile` description — resolved as cheaply as possible:
   *
   * 1. Media info captured when the audio was registered this session (no
   *    decode at all; none of the catalogue's converters reads audio bytes).
   * 2. A resident / re-decodable manager (`ensureResident()`).
   * 3. For a bundle restored from IndexedDB whose audio was never re-attached
   *    this session: the transcript itself — segment times carry their
   *    sample rate and the last segment ends at the audio's end (ASR results
   *    are padded to the full duration). Without this, every restored bundle
   *    was skipped until its file was re-attached by hand.
   */
  private async resolveMedia(
    bundleId: string,
    entity: IdentifiedAnnotationState,
  ): Promise<ResolvedMedia | undefined> {
    const describe = (
      name: string,
      type: string | undefined,
      size: number,
      sampleRate: number,
      duration: SampleUnit,
    ): ResolvedMedia => {
      const oAudioFile = new OAudiofile();
      oAudioFile.name = name;
      oAudioFile.type = type ?? '';
      oAudioFile.size = size;
      oAudioFile.sampleRate = sampleRate;
      oAudioFile.duration = duration.samples;
      return { oAudioFile, sampleRate, duration };
    };

    const info = this.audioService.getMediaInfo(bundleId);
    if (info) {
      return describe(
        info.fullname,
        entity.sessionFile?.type,
        info.size,
        info.sampleRate,
        info.duration,
      );
    }

    if (this.audioService.canRestore(bundleId)) {
      const resident = await this.audioService.ensureResident(bundleId);
      const manager = resident
        ? this.audioService.getManager(bundleId)
        : undefined;
      if (manager) {
        return {
          oAudioFile: manager.resource.getOAudioFile(),
          sampleRate: manager.sampleRate,
          duration: manager.resource.info.duration,
        };
      }
      return undefined;
    }

    const end = transcriptEnd(entity.transcript);
    if (!end) {
      return undefined;
    }
    return describe(
      entity.sessionFile?.name ?? entity.audio.fileName ?? bundleId,
      entity.sessionFile?.type,
      entity.sessionFile?.size ?? 0,
      end.sampleRate,
      end,
    );
  }

  /** Indices of the levels a single-tier converter can export (segment tiers);
   * falls back to level 0 so a file without any is still attempted. */
  private segmentLevelNumbers(annot: OAnnotJSON): number[] {
    const nums = annot.levels
      .map((l, idx) => (l.type === 'SEGMENT' ? idx : -1))
      .filter((idx) => idx >= 0);
    return nums.length > 0 ? nums : [0];
  }

  /** `dir/name`, or `dir/name-2.ext`, ... when two tiers map to one name. */
  private uniquePath(
    files: Record<string, Uint8Array>,
    dir: string,
    name: string,
  ): string {
    // Converter file names derive from imported file names: strip directory
    // parts so `../` or `/` can't escape `dir` inside the zip (zip-slip).
    name = name.replace(/^.*[\\/]/, '').replace(/^\.+$/, '') || 'file';
    let path = `${dir}/${name}`;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (path in files) {
      path = `${dir}/${stem}-${n++}${ext}`;
    }
    return path;
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
