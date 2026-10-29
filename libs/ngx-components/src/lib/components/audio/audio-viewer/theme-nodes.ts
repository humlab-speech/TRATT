/**
 * Konva node names used to recolour existing canvas shapes when the theme
 * changes (Konva bakes fill/stroke in at creation).
 */
export const THEME_NODE = {
  lineBackground: 'theme-line-bg',
  lineFrame: 'theme-line-frame',
  lineGrid: 'theme-line-grid',
  lineSignal: 'theme-line-signal',
  selection: 'theme-selection',
  caret: 'theme-caret',
  textLabel: 'theme-text-label',
  scrollBackground: 'theme-scroll-bg',
  scrollSelector: 'theme-scroll-selector',
} as const;

export interface ThemableNode {
  setAttrs(attrs: Record<string, string>): unknown;
}

/** Applies `attrs[name]` to every node found by `.name`. */
export function applyThemeToNodes(
  find: (selector: string) => ArrayLike<ThemableNode>,
  attrs: Record<string, Record<string, string>>,
): void {
  for (const name of Object.keys(attrs)) {
    Array.from(find(`.${name}`)).forEach((n) => n.setAttrs(attrs[name]));
  }
}
