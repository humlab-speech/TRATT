/**
 * Agglomerative hierarchical clustering over speaker embeddings, recovering
 * the global speaker identity that the segmentation model cannot provide: its
 * speaker slots are local to each analysis window, so the same slot in two
 * windows may be two different people (and the same person two different
 * slots). Clustering their embeddings is how we "attempt to track speakers
 * across a recording".
 */

export const DEFAULT_CLUSTER_THRESHOLD = 0.7;

export interface ClusterOptions {
  /** Exact target cluster count. When set (≥ 1), merging ignores `threshold`. */
  numSpeakers?: number | null;
  /** Cosine distance above which two clusters are treated as different speakers. */
  threshold?: number;
}

/**
 * Returns a cluster label (0-based) for each embedding, using average-linkage
 * agglomerative clustering with cosine distance. `numSpeakers` forces an exact
 * cluster count; otherwise merging stops once the closest pair is farther
 * apart than `threshold` cosine distance.
 */
export function clusterSpeakerTurns(
  embeddings: number[][],
  options?: ClusterOptions,
): number[] {
  const n = embeddings.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [0];
  }

  const target = options?.numSpeakers != null && options.numSpeakers >= 1
    ? options.numSpeakers
    : null;
  const threshold = options?.threshold ?? DEFAULT_CLUSTER_THRESHOLD;

  const members: number[][] = embeddings.map((_, i) => [i]);

  while (members.length > 1) {
    if (target != null && members.length <= target) {
      break;
    }

    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const d = averageLinkageDistance(members[i], members[j], embeddings);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (target == null && bestDist > threshold) {
      break;
    }

    members[bestI] = members[bestI].concat(members[bestJ]);
    members.splice(bestJ, 1);
  }

  const labels = new Array<number>(n).fill(0);
  members.forEach((member, cluster) => {
    for (const idx of member) {
      labels[idx] = cluster;
    }
  });
  return labels;
}

function averageLinkageDistance(
  a: number[],
  b: number[],
  embeddings: number[][],
): number {
  let sum = 0;
  for (const i of a) {
    for (const j of b) {
      sum += cosineDistance(embeddings[i], embeddings[j]);
    }
  }
  return sum / (a.length * b.length);
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k];
    normA += a[k] * a[k];
    normB += b[k] * b[k];
  }
  if (normA === 0 || normB === 0) {
    return 1;
  }
  return 1 - dot / Math.sqrt(normA * normB);
}
