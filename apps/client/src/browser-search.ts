import { getTransitionProfile, type Track } from "@djdesk/domain";

import { compareBpmDescending, findClosestBpmTrack } from "./bpm-sorting.ts";

export type BrowserPriority = { kind: "sections"; sections: number[] } | { kind: "unknown" } | null;

type KeyedTrack = Pick<Track, "key">;
type BrowserSearchTrack = Pick<Track, "id" | "title" | "artist" | "bpm" | "key" | "tags"> & {
  keyLabel?: string;
};

export function getTrackSections(track: KeyedTrack): number[] {
  const profile = getTransitionProfile(track.key);

  if (!profile) return [];

  switch (profile.kind) {
    case "home":
      return [profile.section];
    case "pure-modal":
      return [profile.targetSection];
    case "modal-mixture":
      return [...profile.boundarySections];
  }
}

export function matchesBrowserPriority(track: KeyedTrack, priority: BrowserPriority): boolean {
  if (!priority) return true;
  if (priority.kind === "unknown") return track.key === null;

  return getTrackSections(track).some((section) => priority.sections.includes(section));
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .trim();
}

export function getTrackSearchScore(
  track: Pick<BrowserSearchTrack, "title" | "artist" | "tags" | "keyLabel">,
  query: string,
  displayKeyLabel: string,
): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const title = normalizeSearchText(track.title);
  const artist = normalizeSearchText(track.artist ?? "");
  const keyLabel = normalizeSearchText(`${displayKeyLabel} ${track.keyLabel ?? ""}`);
  const tags = track.tags.map(normalizeSearchText);

  if (title === normalizedQuery) return 1000;
  if (title.startsWith(normalizedQuery)) return 900;
  if (title.includes(normalizedQuery)) return 800;
  if (artist.startsWith(normalizedQuery)) return 700;
  if (artist.includes(normalizedQuery)) return 600;
  if (tags.some((tag) => tag.includes(normalizedQuery))) return 500;
  if (keyLabel.includes(normalizedQuery)) return 400;

  const combined = [title, artist, keyLabel, ...tags].filter(Boolean).join(" ");
  const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);

  return queryParts.length > 1 && queryParts.every((part) => combined.includes(part)) ? 300 : 0;
}

export function rankBrowserTracks<T extends BrowserSearchTrack>(
  tracks: readonly T[],
  options: {
    query: string;
    priority: BrowserPriority;
    keyLabel: (track: T) => string;
  },
): T[] {
  const query = normalizeSearchText(options.query);

  return tracks
    .map((track) => ({
      track,
      score: query ? getTrackSearchScore(track, query, options.keyLabel(track)) : 0,
      preferred: matchesBrowserPriority(track, options.priority),
    }))
    .filter(({ score }) => !query || score > 0)
    .sort(
      (first, second) =>
        second.score - first.score ||
        Number(second.preferred) - Number(first.preferred) ||
        compareBpmDescending(first.track, second.track) ||
        (first.track.artist ?? "").localeCompare(second.track.artist ?? "") ||
        first.track.id.localeCompare(second.track.id),
    )
    .map(({ track }) => track);
}

export function getPriorityBpmTarget<T extends Pick<Track, "key" | "bpm" | "title">>(
  targetBpm: number,
  tracks: readonly T[],
  priority: BrowserPriority,
): T | null {
  const candidates = tracks.filter((track) => matchesBrowserPriority(track, priority));

  return findClosestBpmTrack(targetBpm, candidates) ?? candidates[0] ?? null;
}
