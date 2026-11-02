import { renamePlaceholderLevels } from './placeholder-level';

describe('renamePlaceholderLevels', () => {
  it('renames placeholder levels and labels only', () => {
    const annot = {
      levels: [
        { name: 'OCTRA_1', items: [{ labels: [{ name: 'OCTRA_1' }] }] },
        { name: 'Speaker', items: [{ labels: [{ name: 'Speaker' }] }] },
      ],
    };
    expect(renamePlaceholderLevels(annot, 'Standardnivå')).toBe(true);
    expect(annot.levels[0].name).toBe('Standardnivå');
    expect(annot.levels[0].items[0].labels[0].name).toBe('Standardnivå');
    expect(annot.levels[1].name).toBe('Speaker');
    expect(renamePlaceholderLevels(annot, 'x')).toBe(false);
  });
});
