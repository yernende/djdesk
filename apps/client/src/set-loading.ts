/** Merge a fetched list without reverting local edits or reviving successful deletions. */
export function mergeLoadedSets<T extends { id: string }>(
  current: readonly T[],
  loaded: readonly T[],
  deletedIds: ReadonlySet<string>,
): T[] {
  const merged = current.filter((set) => !deletedIds.has(set.id));
  const knownIds = new Set(merged.map((set) => set.id));
  for (const set of loaded) {
    if (deletedIds.has(set.id) || knownIds.has(set.id)) continue;
    merged.push(set);
    knownIds.add(set.id);
  }
  return merged;
}
