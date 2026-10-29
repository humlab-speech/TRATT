import { applyThemeToNodes, THEME_NODE } from './theme-nodes';

describe('applyThemeToNodes', () => {
  const makeNode = (attrs: Record<string, string>) => ({
    attrs,
    setAttrs(a: Record<string, string>) {
      Object.assign(this.attrs, a);
    },
  });

  it('recolours existing nodes by name and leaves others alone', () => {
    const bg = makeNode({ fill: '#FFFFFF' });
    const grid = makeNode({ stroke: '#D9D9D9' });
    const other = makeNode({ fill: 'red' });
    const byName: Record<string, ReturnType<typeof makeNode>[]> = {
      [`.${THEME_NODE.lineBackground}`]: [bg],
      [`.${THEME_NODE.lineGrid}`]: [grid],
    };
    applyThemeToNodes((sel) => byName[sel] ?? [], {
      [THEME_NODE.lineBackground]: { fill: '#121212' },
      [THEME_NODE.lineGrid]: { stroke: '#333333' },
    });
    expect(bg.attrs['fill']).toBe('#121212');
    expect(grid.attrs['stroke']).toBe('#333333');
    expect(other.attrs['fill']).toBe('red');
  });
});
