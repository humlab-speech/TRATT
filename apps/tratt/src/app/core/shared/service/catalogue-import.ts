import { AudioManager } from '@tratt/web-media';
import { strFromU8, unzipSync } from 'fflate';
import { AppInfo } from '../../../app.info';
import { audioBasename } from '../../component/tratt-dropzone/transcript-pairing';

const ANNOT_SUFFIX = '_annot.json';

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

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
  const annots = paths.filter(
    (p) =>
      isAnnot(p) &&
      audio.some(
        (a) =>
          dirOf(a) === dirOf(p) &&
          audioBasename(nameOf(a)) + ANNOT_SUFFIX === nameOf(p),
      ),
  );
  return [
    ...audio.map(
      (p) =>
        new File([entries[p] as BlobPart], nameOf(p), {
          type: types.get(p) ?? '',
        }),
    ),
    ...annots.map(
      (p) =>
        new File([entries[p] as BlobPart], nameOf(p), {
          type: 'application/json',
        }),
    ),
  ];
}
