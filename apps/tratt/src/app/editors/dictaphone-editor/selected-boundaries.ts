/**
 * Sample positions of the boundary markers (`<img data-samples>`) the range
 * touches, in document order.
 */
export function selectedBoundarySamples(
  root: ParentNode,
  range: Range,
): number[] {
  if (range.collapsed) {
    return [];
  }
  return Array.from(root.querySelectorAll('img[data-samples]'))
    .filter((img) => range.intersectsNode(img))
    .map((img) => Number(img.getAttribute('data-samples')));
}
