import { describe, expect, it } from '@jest/globals';
import { clusterSpeakerTurns } from './speaker-clustering';

describe('clusterSpeakerTurns', () => {
  it('returns no labels for no embeddings', () => {
    expect(clusterSpeakerTurns([])).toEqual([]);
  });

  it('returns a single cluster for a single embedding', () => {
    expect(clusterSpeakerTurns([[1, 0]])).toEqual([0]);
  });

  it('merges identical embeddings', () => {
    expect(
      clusterSpeakerTurns([
        [1, 0],
        [1, 0],
      ]),
    ).toEqual([0, 0]);
  });

  it('keeps dissimilar embeddings as separate speakers', () => {
    expect(
      clusterSpeakerTurns([
        [1, 0],
        [0, 1],
      ]),
    ).toEqual([0, 1]);
  });

  it('numSpeakers forces a merge that the threshold would reject', () => {
    // [1,0] and [0,1] are orthogonal (distance 1 > threshold), but numSpeakers=2
    // still collapses the three turns into two speakers: the two identical
    // [1,0] turns merge, [0,1] stays apart.
    expect(
      clusterSpeakerTurns(
        [
          [1, 0],
          [0, 1],
          [1, 0],
        ],
        { numSpeakers: 2 },
      ),
    ).toEqual([0, 1, 0]);
  });
});
