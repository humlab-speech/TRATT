import { unitsCoveredBy } from '@tratt/annotation';

/** Where to show the merge popup and which units (inclusive) it would merge. */
export interface MergeOffer {
  x: number;
  y: number;
  from: number;
  to: number;
}

/**
 * Offer for a drag selection that covers 2+ units; `undefined` otherwise.
 * `endTimes[i]` = end (in samples) of unit i.
 */
export function mergeOfferFor(
  event: { clientX: number; clientY: number },
  endTimes: number[],
  selection:
    { start: { samples: number }; end: { samples: number } } | undefined,
): MergeOffer | undefined {
  if (!selection) {
    return undefined;
  }
  const range = unitsCoveredBy(
    endTimes,
    selection.start.samples,
    selection.end.samples,
  );
  return range && { x: event.clientX, y: event.clientY, ...range };
}

/** True when the pointer moved far enough between down and up to be a drag. */
export function isDrag(
  down: { clientX: number; clientY: number } | undefined,
  up: { clientX: number; clientY: number },
  threshold = 4,
): boolean {
  return (
    !!down &&
    Math.hypot(up.clientX - down.clientX, up.clientY - down.clientY) >=
      threshold
  );
}
