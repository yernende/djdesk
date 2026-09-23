export interface NavigationState {
  trackId: string | null;
  setId: string | null;
  workspaceId: string | null;
  secret: string | null;
}

interface NavigationPatch {
  trackId?: string | null;
  setId?: string | null;
}

const PARSING_ORIGIN = "https://djdesk.invalid";

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value, PARSING_ORIGIN);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function normalizeId(value: string | null): string | null {
  return value?.trim() || null;
}

function readWorkspaceId(pathname: string): string | null {
  const match = /^\/w\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const id = normalizeId(decodeURIComponent(match[1]));
    return id?.includes("/") ? null : id;
  } catch {
    return null;
  }
}

export function readNavigation(value: string): NavigationState {
  const url = parseUrl(value);
  return {
    trackId: normalizeId(url?.searchParams.get("track") ?? null),
    setId: normalizeId(url?.searchParams.get("set") ?? null),
    workspaceId: url ? readWorkspaceId(url.pathname) : null,
    secret: normalizeId(new URLSearchParams(url?.hash.slice(1)).get("key")),
  };
}

export function updateNavigationUrl(
  value: string,
  patch: NavigationPatch,
  options: { stripSecret?: boolean } = {},
): string {
  const url = parseUrl(value) ?? new URL("/", PARSING_ORIGIN);
  for (const [property, parameter] of [
    ["trackId", "track"],
    ["setId", "set"],
  ] as const) {
    if (patch[property] === undefined) continue;
    const id = normalizeId(patch[property]);
    if (id) url.searchParams.set(parameter, id);
    else url.searchParams.delete(parameter);
  }
  if (options.stripSecret) {
    // Keep unrelated fragment anchors and parameters byte-for-byte intact.
    url.hash = url.hash
      .slice(1)
      .split("&")
      .filter((part) => !new URLSearchParams(part).has("key"))
      .join("&");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function trackHref(trackId: string): string {
  return updateNavigationUrl("/", { trackId });
}

export function trackShareUrl(origin: string, trackId: string): string {
  const url = new URL(origin);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("A track link requires an HTTP or HTTPS origin.");
  return new URL(trackHref(trackId), url.origin).href;
}
