import { AudioManager } from '@tratt/web-media';
import { strFromU8, unzipSync } from 'fflate';
import { AppInfo } from '../../../app.info';
import { audioBasename } from '../../component/tratt-dropzone/transcript-pairing';

const ANNOT_SUFFIX = '_annot.json';

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const groups = new WeakMap<File, string>();

/**
 * The archive recording a file from `filesFromExportZip` belongs to. Names do
 * not identify it: two recordings may share a basename (`take.wav`,
 * `take.wma`), so the dropzone pairs by this instead.
 */
export function markArchiveGroup(file: File, group: string): File {
  groups.set(file, group);
  return file;
}

export function archiveGroupOf(file: File): string | undefined {
  return groups.get(file);
}

/**
 * The files to feed the dropzone to restore an archive made by
 * `CatalogueExportService`: each bundle's audio, then its `_annot.json`
 * (only when its audio is in the archive too). Everything else (DOCX, SRT,
 * ELAN, manifests) is output-only and skipped without being inflated.
 */
export function filesFromExportZip(zip: Uint8Array): File[] {
  const isAudio = (path: string) =>
    AudioManager.isValidAudioFileName(nameOf(path), AppInfo.audioformats);
  const isAnnot = (path: string) => path.endsWith(ANNOT_SUFFIX);
  const entries = unzipSync(zip, {
    filter: ({ name }) =>
      name === 'manifest.json' || isAudio(name) || isAnnot(name),
  });

  const types = new Map<string, string>();
  try {
    for (const row of JSON.parse(
      strFromU8(entries['manifest.json'] ?? new Uint8Array()) || '[]',
    )) {
      if (row?.audioPath) {
        types.set(row.audioPath, row.audioType ?? '');
      }
    }
  } catch {
    // No/bad manifest: types stay unset, the file name decides.
  }

  const paths = Object.keys(entries).sort();
  const audio = paths.filter(isAudio);
  const group = (file: File, path: string) =>
    markArchiveGroup(file, `archive:${dirOf(path)}`);
  const annotFor = (audioPath: string) => {
    const inDir = paths.filter(
      (p) => isAnnot(p) && dirOf(p) === dirOf(audioPath),
    );
    // The exact name first; a folder holds one recording, so a lone other
    // `_annot.json` (renamed on a name clash) is still its transcript.
    return (
      inDir.find(
        (p) => nameOf(p) === audioBasename(nameOf(audioPath)) + ANNOT_SUFFIX,
      ) ?? (inDir.length === 1 ? inDir[0] : undefined)
    );
  };
  const claimed = new Set<string>();
  const annots = audio.flatMap((a) => {
    const p = annotFor(a);
    if (!p || claimed.has(p)) {
      return [];
    }
    claimed.add(p);
    return [{ audio: a, annot: p }];
  });
  // A recording exported without its audio leaves only its transcript: hand
  // it over ungrouped, so it pairs by name with the file of that name in the
  // list.
  const orphans = paths.filter((p) => isAnnot(p) && !claimed.has(p));
  return [
    ...audio.map((p) =>
      group(
        new File([entries[p] as BlobPart], nameOf(p), {
          type: types.get(p) ?? '',
        }),
        p,
      ),
    ),
    ...annots.map(({ audio: a, annot: p }) =>
      group(
        new File([entries[p] as BlobPart], nameOf(p), {
          type: 'application/json',
        }),
        a,
      ),
    ),
    ...orphans.map(
      (p) =>
        new File([entries[p] as BlobPart], nameOf(p), {
          type: 'application/json',
        }),
    ),
  ];
}
