/** Level and label name the converters give a tier whose name is unknown. */
export const PLACEHOLDER_LEVEL_NAME = 'OCTRA_1';

interface RenamableAnnotation {
  levels?: {
    name: string;
    items?: { labels?: { name: string }[] }[];
  }[];
}

/**
 * Renames the converters' `OCTRA_1` placeholder (levels and their labels)
 * to `newName`, in place. Returns whether anything changed.
 */
export function renamePlaceholderLevels(
  annotation: RenamableAnnotation | undefined | null,
  newName: string,
): boolean {
  let changed = false;
  for (const level of annotation?.levels ?? []) {
    if (level.name === PLACEHOLDER_LEVEL_NAME) {
      level.name = newName;
      changed = true;
    }
    for (const item of level.items ?? []) {
      for (const label of item.labels ?? []) {
        if (label.name === PLACEHOLDER_LEVEL_NAME) {
          label.name = newName;
          changed = true;
        }
      }
    }
  }
  return changed;
}
