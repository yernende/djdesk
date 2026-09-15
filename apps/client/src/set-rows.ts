/** Keep positions aligned, including repeated or withdrawn catalogue entries. */
export function resolveSetRows<T extends { id: string }>(
  ids: readonly string[],
  catalogue: readonly T[],
  missing: (id: string) => T,
): T[] {
  const byId = new Map(catalogue.map((track) => [track.id, track]));
  return ids.map((id) => byId.get(id) ?? missing(id));
}
