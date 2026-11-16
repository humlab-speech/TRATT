import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Converter, ExportResult, OAnnotJSON } from '@tratt/annotation';
import { OAudiofile, SampleUnit } from '@tratt/media';
import { strToU8, Zippable, zipSync } from 'fflate';
import { Observable } from 'rxjs';
import { AppInfo } from '../../../app.info';
import { BUILD_INFO } from '../../../build-info';
import { audioBasename } from '../../component/tratt-dropzone/transcript-pairing';
import { RootState } from '../../store/index';
import {
  breakMarkerCodeOf,
  selectLocalMode,
  transcriptHasContent,
} from '../../store/login-mode/annotation/annotation.selectors';
import { IdentifiedAnnotationState } from '../../store/login-mode/annotation/local-bundle-collection';
import { transcriptEnd } from '../transcript-timing';
import { AudioService } from './audio.service';
import { PipelineQueueService } from './pipeline-queue.service';

/** What an export hands the browser to save: one file as it is, or a .zip. */
export interface ExportDownload {
  name: string;
  bytes: Uint8Array;
  type: string;
  /** True when several files were packed into a .zip. */
  archive: boolean;
}

export interface CatalogueExportProgress {
  completedBundles: number;
  totalBundles: number;
  currentBundleName: string | null;
  /** Set only on the final emission; absent when nothing could be exported. */
  download?: ExportDownload;
  /** Recordings actually exported (skipped bundles excluded); set on the final emission. */
  exportedCount?: number;
  /** Per-bundle/per-file problems that didn't abort the export. */
  warnings: string[];
}

export interface ExportOptions {
  /** Put each recording's attached audio next to its transcripts. */
  includeAudio?: boolean;
}

/** One file an export produces, before it is decided whether to zip. */
interface ExportedFile {
  name: string;
  bytes: Uint8Array;
  type: string;
}

/** Tratt's own transcript format: added to every .zip so it loads back. */
export const NATIVE_FORMAT = 'AnnotJSON';

/**
 * The level numbers a converter is called with to export every tier:
 * once with all segment tiers for a format that holds several (DOCX, ODT,
 * plain text), once per segment tier for a single-tier one (SRT, WebVTT,
 * ...), and once without a level for one that carries the whole annotation
 * in its own structure (ELAN, TextGrid, ...).
 */
export function exportCalls(
  converter: Converter,
  annot: OAnnotJSON,
): { levelnum?: number; levelnums?: number[] }[] {
  const segments = annot.levels
    .map((l, idx) => (l.type === 'SEGMENT' ? idx : -1))
    .filter((idx) => idx >= 0);
  // A file without any segment tier is still attempted with level 0.
  const tiers = segments.length > 0 ? segments : [0];
  if (converter.multiTierExport) {
    return [{ levelnums: tiers }];
  }
  if (converter.multitiers) {
    return [{}];
  }
  return tiers.map((levelnum) => ({ levelnum }));
}

/**
 * Converts one recording's annotation into a file per format (several for a
 * single-tier format and several tiers). Failures become warnings.
 */
export function convertAnnotation(
  annot: OAnnotJSON,
  audio: OAudiofile,
  converters: Converter[],
  label: string,
  warnings: string[],
): ExportedFile[] {
  const out: ExportedFile[] = [];
  for (const converter of converters) {
    for (const call of exportCalls(converter, annot)) {
      let result: ExportResult;
      try {
        result = converter.export(annot, audio, call.levelnum, call.levelnums);
      } catch (error) {
        result = {
          error: error instanceof Error ? error.message : String(error),
        } as ExportResult;
      }
      if (result.error || !result.file) {
        warnings.push(
          `${label}: ${converter.name} export failed — ${result.error ?? 'no file produced'}.`,
        );
        continue;
      }
      out.push({
        name: result.file.name,
        bytes:
          result.file.encoding === 'binary'
            ? (result.file.content as unknown as Uint8Array)
            : strToU8(result.file.content),
        type: result.file.type || 'application/octet-stream',
      });
    }
  }
  return out;
}

/** Sets the per-recording converter options every export depends on. */
export function prepareConverters(
  converters: Converter[],
  breakMarkerCode: string,
): void {
  for (const converter of converters) {
    if (converter.options && 'breakMarkerCode' in converter.options) {
      converter.options.breakMarkerCode = breakMarkerCode;
    }
  }
}

export interface ResolvedMedia {
  oAudioFile: OAudiofile;
  sampleRate: number;
  duration: SampleUnit;
}

/** `tratt_<recordings>_<yyyymmdd>@<hhmm>.zip`, in local time. */
export function archiveFileName(count: number, when = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}`;
  return `tratt_${count}_${date}@${p(when.getHours())}${p(when.getMinutes())}.zip`;
}

/**
 * The folder a recording bundle gets under `bundles/` in the archive. Matches
 * step 2.7's basename-collision handling: first writer keeps the bare slug,
 * later same-name bundles get a `-2`, `-3`, ... suffix. Exported so the save
 * dialog can preview the archive's contents with the same names.
 */
export function archiveFolderName(fileName: string, used: Set<string>): string {
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
  /** Archive path of the bundled audio ('' if its source file is gone). */
  audioPath: string;
  audioType: string;
}

/**
 * Exports N bundles: one file per requested format and tier (plus the audio,
 * if asked for). Exactly one such file downloads as it is; more go in one
 * zip, `bundles/<slug>/<name>.<ext>`, with Tratt's own transcript per bundle
 * and `manifest.json`/`manifest.csv`, so the zip loads back into Tratt.
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
    options: ExportOptions = {},
  ): Observable<CatalogueExportProgress> {
    return new Observable<CatalogueExportProgress>((subscriber) => {
      this.run(bundleIds, converterNames, options, subscriber).catch((err) =>
        subscriber.error(err),
      );
    });
  }

  /**
   * Exports the transcript on screen outside the list (online, demo and URL
   * modes): no audio, no manifests. One file downloads as it is; several
   * (formats, or tiers of a single-tier format) go in a .zip with Tratt's
   * own transcript file.
   */
  exportTranscript(
    annot: OAnnotJSON,
    audio: OAudiofile,
    converterNames: string[],
    breakMarkerCode: string,
  ): { download?: ExportDownload; warnings: string[] } {
    const converters = AppInfo.converters.filter((c) =>
      converterNames.includes(c.name),
    );
    prepareConverters(converters, breakMarkerCode);
    const warnings: string[] = [];
    const files = convertAnnotation(
      annot,
      audio,
      converters,
      audio.name,
      warnings,
    );
    if (files.length === 0) {
      return { warnings };
    }
    if (files.length === 1) {
      return { download: { ...files[0], archive: false }, warnings };
    }
    const zip: Zippable = {};
    for (const file of files) {
      zip[this.uniquePath(zip, '', file.name)] = file.bytes;
    }
    if (!converterNames.includes(NATIVE_FORMAT)) {
      zip[this.uniquePath(zip, '', annot.name + '_annot.json')] = strToU8(
        JSON.stringify(annot),
      );
    }
    return {
      download: {
        name: archiveFileName(1),
        bytes: zipSync(zip),
        type: 'application/zip',
        archive: true,
      },
      warnings,
    };
  }

  private async run(
    bundleIds: string[],
    converterNames: string[],
    options: ExportOptions,
    subscriber: {
      next: (v: CatalogueExportProgress) => void;
      complete: () => void;
      error: (e: unknown) => void;
    },
  ): Promise<void> {
    const includeAudio = options.includeAudio ?? true;
    const converters = AppInfo.converters.filter((c) =>
      converterNames.includes(c.name),
    );
    const nativeTicked = converterNames.includes(NATIVE_FORMAT);
    // What the user asked for: files per format, and audio. Only these
    // count towards "one file, or a .zip".
    const chosen: { dir: string; file: ExportedFile }[] = [];
    // Tratt's own transcript per recording, added only to a .zip.
    const natives: { dir: string; file: ExportedFile }[] = [];
    const manifestRows: ManifestRow[] = [];
    const warnings: string[] = [];
    const usedSlugs = new Set<string>();

    const progress = (i: number, name: string | null) => {
      if (i < bundleIds.length - 1) {
        subscriber.next({
          completedBundles: i + 1,
          totalBundles: bundleIds.length,
          currentBundleName: name,
          warnings: [...warnings],
        });
      }
    };

    for (let i = 0; i < bundleIds.length; i++) {
      const bundleId = bundleIds[i];
      const entity = this.localMode().bundles.entities[bundleId];
      if (!entity) {
        warnings.push(`Skipped ${bundleId}: bundle no longer exists.`);
        progress(i, null);
        continue;
      }
      const label = entity.sessionFile?.name ?? bundleId;

      // No transcript yet (failed, cancelled, or not run): its formats would
      // only be blank files, so it goes along for its audio alone, when the
      // audio is asked for. Same rule as the list's "Not transcribed" (a new
      // bundle is seeded with one empty segment), so the dialog's preview
      // matches what is written.
      if (
        !transcriptHasContent(
          entity.transcript,
          breakMarkerCodeOf(entity.guidelines),
        )
      ) {
        const audio = includeAudio ? await this.audioFor(bundleId) : undefined;
        if (!audio?.file) {
          warnings.push(
            audio
              ? `Skipped ${label}: it has no transcript yet, and its ${audio.problem}.`
              : `Skipped ${label}: it has no transcript yet.`,
          );
          progress(i, entity.sessionFile?.name ?? null);
          continue;
        }
        const dir = `bundles/${this.uniqueSlug(label, usedSlugs)}`;
        chosen.push({ dir, file: audio.file });
        const info = this.audioService.getMediaInfo(bundleId);
        manifestRows.push({
          bundleId,
          sourceFilename: entity.sessionFile?.name ?? '',
          durationSamples: info?.duration.samples ?? 0,
          sampleRate: info?.sampleRate ?? 0,
          model: null,
          language: null,
          stagesRun: [],
          unitCounts: 0,
          appVersion: BUILD_INFO.version,
          audioPath: `${dir}/${audio.file.name}`,
          audioType: audio.file.type,
        });
        progress(i, entity.sessionFile?.name ?? null);
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
        // hang) the whole export: record it and carry on.
        skipReason = error instanceof Error ? error.message : String(error);
        media = undefined;
        oannotjson = undefined;
      }
      if (!media || !oannotjson) {
        warnings.push(
          `Skipped ${bundleId} (${entity.sessionFile?.name ?? 'unknown file'}): ${skipReason}.`,
        );
        progress(i, entity.sessionFile?.name ?? null);
        continue;
      }

      let unitCounts = 0;
      for (const level of oannotjson.levels) {
        unitCounts += (level as { items?: unknown[] }).items?.length ?? 0;
      }

      const dir = `bundles/${this.uniqueSlug(label, usedSlugs)}`;
      prepareConverters(
        converters,
        breakMarkerCodeOf(entity.guidelines) ?? '<P>',
      );
      for (const file of convertAnnotation(
        oannotjson,
        media.oAudioFile,
        converters,
        label,
        warnings,
      )) {
        chosen.push({ dir, file });
      }

      // The native annotation goes in every .zip whatever formats were
      // ticked: it is the lossless one, and it is the only transcript an
      // archive without this recording's audio can still hand back (see
      // filesFromExportZip). With audio next to it the archive re-loads
      // whole.
      if (!nativeTicked) {
        const source = this.audioService.getSourceFile(bundleId);
        natives.push({
          dir,
          file: {
            name:
              audioBasename(
                source?.name ?? entity.sessionFile?.name ?? bundleId,
              ) + '_annot.json',
            bytes: strToU8(JSON.stringify(oannotjson)),
            type: 'application/json',
          },
        });
      }

      let audioPath = '';
      let audioType = '';
      if (includeAudio) {
        const audio = await this.audioFor(bundleId);
        if (audio.file) {
          audioPath = `${dir}/${audio.file.name}`;
          audioType = audio.file.type;
          chosen.push({ dir, file: audio.file });
        } else {
          warnings.push(
            `${label}: ${audio.problem}, so it is not in the export. Its transcript is, and loads into the file of the same name in the list.`,
          );
        }
      }

      const pipeline = this.pipelineQueueService.getTranscribeOptions();
      const stagesRun: string[] = [];
      if (pipeline) {
        stagesRun.push('asr');
        if (pipeline.diarization) {
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
        model: pipeline?.modelId ?? null,
        language: pipeline?.language ?? null,
        stagesRun,
        unitCounts,
        appVersion: BUILD_INFO.version,
        audioPath,
        audioType,
      });

      progress(i, entity.sessionFile?.name ?? null);
    }

    // The final ("N-th") emission always comes from here, carrying the
    // download: the one file as it is, or everything in a .zip.
    let download: ExportDownload | undefined;
    if (chosen.length === 1) {
      const file = chosen[0].file;
      download = {
        ...file,
        name: this.uniquePath({}, '', file.name),
        archive: false,
      };
    } else if (chosen.length > 1) {
      const files: Zippable = {};
      for (const { dir, file } of [...chosen, ...natives]) {
        const path = this.uniquePath(files, dir, file.name);
        // Audio is already compressed, so it is stored, not deflated.
        files[path] =
          file.type.startsWith('audio/') || file.type.startsWith('video/')
            ? [file.bytes, { level: 0 }]
            : file.bytes;
      }
      files['manifest.json'] = strToU8(JSON.stringify(manifestRows, null, 2));
      files['manifest.csv'] = strToU8(this.toCsv(manifestRows));
      download = {
        name: archiveFileName(manifestRows.length),
        bytes: zipSync(files),
        type: 'application/zip',
        archive: true,
      };
    }
    subscriber.next({
      completedBundles: bundleIds.length,
      totalBundles: bundleIds.length,
      currentBundleName: null,
      download,
      exportedCount: manifestRows.length,
      warnings: [...warnings],
    });
    subscriber.complete();
  }

  /**
   * A bundle's audio for the export: the attached file, or (VISP) the
   * recording fetched from the server. Otherwise, why there is none.
   */
  private async audioFor(
    bundleId: string,
  ): Promise<{ file?: ExportedFile; problem: string }> {
    if (!this.audioService.hasAudioFile(bundleId)) {
      return { problem: 'audio not attached' };
    }
    try {
      const source = await this.audioService.getAudioFile(bundleId);
      if (!source) {
        return { problem: 'audio not attached' };
      }
      return {
        file: {
          name: source.name,
          bytes: new Uint8Array(await source.arrayBuffer()),
          type: source.type || 'application/octet-stream',
        },
        problem: '',
      };
    } catch (error) {
      return {
        problem: `audio could not be fetched (${error instanceof Error ? error.message : String(error)})`,
      };
    }
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
      // A stored recording whose file is gone (not re-attached this
      // session) cannot be decoded: fall through to the transcript below
      // instead of dropping the whole bundle from the export.
      const resident = await this.audioService
        .ensureResident(bundleId)
        .catch(() => false);
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

  /** `dir/name`, or `dir/name-2.ext`, ... when two tiers map to one name. */
  private uniquePath(files: Zippable, dir: string, name: string): string {
    // Converter file names derive from imported file names: strip directory
    // parts so `../` or `/` can't escape `dir` inside the zip (zip-slip).
    name = name.replace(/^.*[\\/]/, '').replace(/^\.+$/, '') || 'file';
    const prefix = dir ? `${dir}/` : '';
    let path = `${prefix}${name}`;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (path in files) {
      path = `${prefix}${stem}-${n++}${ext}`;
    }
    return path;
  }

  private uniqueSlug(fileName: string, used: Set<string>): string {
    return archiveFolderName(fileName, used);
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
      'audioPath',
      'audioType',
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
