export interface PublicConfig {
  origin: string;
  workspacesPerDay: number;
  setsPerWorkspace: number;
  tracksPerSet: number;
  writesPerMinute: number;
}

export function readPublicConfig(env: NodeJS.ProcessEnv): PublicConfig | undefined {
  const mode = env.APP_MODE ?? "local";
  if (mode !== "local" && mode !== "public") throw new Error("APP_MODE must be local or public");
  if (mode === "local") return undefined;
  if (!env.PUBLIC_ORIGIN) throw new Error("PUBLIC_ORIGIN is required in public mode");
  const url = new URL(env.PUBLIC_ORIGIN);
  if (url.href !== `${url.origin}/` || url.username || url.password) {
    throw new Error("PUBLIC_ORIGIN must contain only scheme and host");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("PUBLIC_ORIGIN requires HTTPS (except local development)");
  }
  return {
    origin: url.origin,
    workspacesPerDay: positive(env.PUBLIC_WORKSPACES_PER_DAY, 5),
    setsPerWorkspace: positive(env.PUBLIC_SETS_PER_WORKSPACE, 100),
    tracksPerSet: positive(env.PUBLIC_TRACKS_PER_SET, 300),
    writesPerMinute: positive(env.PUBLIC_WRITES_PER_MINUTE, 120),
  };
}

function positive(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error("Public limits must be positive integers");
  return parsed;
}
