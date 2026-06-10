// Reciprocal Rank Fusion. score(id) = Σ 1/(k + rank), rank 1-based per list.
export function rrfMerge(lexIds: string[], vecIds: string[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  lexIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  vecIds.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  return scores;
}
