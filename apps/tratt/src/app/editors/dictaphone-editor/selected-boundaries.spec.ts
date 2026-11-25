import { describe, expect, it } from '@jest/globals';
import { selectedBoundarySamples } from './selected-boundaries';

function setup() {
  const root = document.createElement('div');
  root.innerHTML =
    '<p>one<img data-samples="10"> two<img data-samples="20"> three</p>';
  const p = root.firstChild as HTMLElement;
  return { root, p };
}

describe('selectedBoundarySamples', () => {
  it('returns the markers inside the range in order', () => {
    const { root, p } = setup();
    const range = document.createRange();
    range.setStart(p.firstChild!, 1);
    range.setEnd(p.lastChild!, 2);
    expect(selectedBoundarySamples(root, range)).toEqual([10, 20]);
  });

  it('skips markers outside the range', () => {
    const { root, p } = setup();
    const range = document.createRange();
    range.setStart(p.childNodes[2], 1); // " two"
    range.setEnd(p.childNodes[2], 3);
    expect(selectedBoundarySamples(root, range)).toEqual([]);
  });

  it('is empty for a collapsed range', () => {
    const { root, p } = setup();
    const range = document.createRange();
    range.setStart(p.firstChild!, 1);
    range.collapse(true);
    expect(selectedBoundarySamples(root, range)).toEqual([]);
  });
});
