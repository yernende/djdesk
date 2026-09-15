import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PublicConfig } from "./config.ts";

export interface SavedSet {
  id: string;
  name: string;
  comment: string | null;
  trackIds: string[];
  revision: number;
}

export interface WorkspaceAccess {
  workspaceId: string;
  accessVersion: number;
}

export class PublicError extends Error {
  statusCode: number;
  code: string;
  params: Record<string, number>;
  constructor(
    statusCode: number,
    message: string,
    code: string,
    params: Record<string, number> = {},
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.params = params;
  }
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfToken(sessionToken: string): string {
  return hashSecret(`djdesk-csrf:${sessionToken}`);
}

export class WorkspaceStore {
  database: DatabaseSync;
  config: PublicConfig;

  constructor(database: DatabaseSync, config: PublicConfig) {
    this.database = database;
    this.config = config;
  }

  transaction<T>(action: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  consumeLimit(bucket: string, subject: string, max: number, seconds: number): void {
    const now = Math.floor(Date.now() / 1000);
    this.database.prepare("DELETE FROM public_rate_limits WHERE expires_at <= ?").run(now);
    this.database.prepare("DELETE FROM workspace_sessions WHERE expires_at <= ?").run(now);
    const key = hashSecret(subject);
    const row = this.database
      .prepare(`
      INSERT INTO public_rate_limits (bucket, subject_hash, count, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(bucket, subject_hash)
      DO UPDATE SET count = count + 1 RETURNING count
    `)
      .get(bucket, key, now + seconds) as { count: number };
    if (row.count > max)
      throw new PublicError(429, "Too many requests. Please try again later.", "RATE_LIMITED");
  }

  createWorkspace(): WorkspaceAccess & { secret: string } {
    const workspaceId = randomUUID();
    const secret = newSecret();
    this.database
      .prepare("INSERT INTO workspaces (id, secret_hash) VALUES (?, ?)")
      .run(workspaceId, hashSecret(secret));
    return { workspaceId, secret, accessVersion: 1 };
  }

  exchange(workspaceId: unknown, secret: unknown): WorkspaceAccess {
    if (
      typeof workspaceId !== "string" ||
      typeof secret !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret)
    ) {
      throw new PublicError(
        401,
        "This access link is invalid or has been replaced.",
        "ACCESS_LINK_INVALID",
      );
    }
    const row = this.database
      .prepare("SELECT id, access_version FROM workspaces WHERE id = ? AND secret_hash = ?")
      .get(workspaceId, hashSecret(secret)) as { id: string; access_version: number } | undefined;
    if (!row)
      throw new PublicError(
        401,
        "This access link is invalid or has been replaced.",
        "ACCESS_LINK_INVALID",
      );
    return { workspaceId: row.id, accessVersion: row.access_version };
  }

  createSession(access: WorkspaceAccess): string {
    const token = newSecret();
    this.database
      .prepare(
        `INSERT INTO workspace_sessions (token_hash, workspace_id, access_version, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(
        hashSecret(token),
        access.workspaceId,
        access.accessVersion,
        Math.floor(Date.now() / 1000) + 30 * 86400,
      );
    return token;
  }

  authenticate(token: string | undefined): WorkspaceAccess | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.database
      .prepare(`
      SELECT w.id, w.access_version FROM workspace_sessions s
      JOIN workspaces w ON w.id = s.workspace_id AND w.access_version = s.access_version
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
      .get(hashSecret(token), Math.floor(Date.now() / 1000)) as
      | { id: string; access_version: number }
      | undefined;
    return row ? { workspaceId: row.id, accessVersion: row.access_version } : null;
  }

  rotate(access: WorkspaceAccess): WorkspaceAccess & { secret: string } {
    const secret = newSecret();
    const result = this.database
      .prepare(
        "UPDATE workspaces SET secret_hash = ?, access_version = access_version + 1 WHERE id = ? AND access_version = ?",
      )
      .run(hashSecret(secret), access.workspaceId, access.accessVersion);
    if (!result.changes)
      throw new PublicError(401, "Open your current access link again.", "SESSION_REVOKED");
    this.database
      .prepare("DELETE FROM workspace_sessions WHERE workspace_id = ?")
      .run(access.workspaceId);
    return { workspaceId: access.workspaceId, accessVersion: access.accessVersion + 1, secret };
  }

  publication(): Map<string, boolean> {
    const rows = this.database
      .prepare(`SELECT p.track_id, p.audio_enabled FROM public_catalog p
      JOIN tracks t ON t.id = p.track_id WHERE t.does_not_fit = 0`)
      .all() as { track_id: string; audio_enabled: number }[];
    return new Map(rows.map((row) => [row.track_id, Boolean(row.audio_enabled)]));
  }

  listSets(workspaceId: string): SavedSet[] {
    const rows = this.database
      .prepare(
        "SELECT id, name, comment, revision FROM set_drafts WHERE workspace_id = ? ORDER BY created_at, id",
      )
      .all(workspaceId) as Omit<SavedSet, "trackIds">[];
    const tracks = this.database
      .prepare(`SELECT st.set_draft_id, st.track_id FROM set_draft_tracks st
      JOIN set_drafts s ON s.id = st.set_draft_id WHERE s.workspace_id = ? ORDER BY st.set_draft_id, st.position`)
      .all(workspaceId) as { set_draft_id: string; track_id: string }[];
    const ids = new Map<string, string[]>();
    for (const row of tracks) {
      const items = ids.get(row.set_draft_id) ?? [];
      items.push(row.track_id);
      ids.set(row.set_draft_id, items);
    }
    return rows.map((row) => ({ ...row, trackIds: ids.get(row.id) ?? [] }));
  }

  getSet(workspaceId: string, setId: string): SavedSet {
    const saved = this.listSets(workspaceId).find((set) => set.id === setId);
    if (!saved) throw new PublicError(404, "Set not found.", "SET_NOT_FOUND");
    return saved;
  }

  createSet(
    workspaceId: string,
    input: { name?: unknown; trackIds?: unknown; id?: unknown },
  ): SavedSet {
    const name = validateName(input.name);
    const ids = this.validateTracks(workspaceId, input.trackIds ?? []);
    const id =
      typeof input.id === "string" && /^[a-f0-9-]{36}$/.test(input.id) ? input.id : randomUUID();
    const current = this.listSets(workspaceId);
    // Client-generated IDs make retrying an interrupted creation safe.
    const existing = current.find((set) => set.id === id);
    if (existing) return existing;
    if (current.length >= this.config.setsPerWorkspace)
      throw new PublicError(422, "This workspace has reached its set limit.", "SET_LIMIT", {
        limit: this.config.setsPerWorkspace,
      });
    if (this.database.prepare("SELECT 1 FROM set_drafts WHERE id = ?").get(id))
      throw new PublicError(400, "Invalid set ID.", "SET_ID_INVALID");
    this.database
      .prepare("INSERT INTO set_drafts (id, name, workspace_id) VALUES (?, ?, ?)")
      .run(id, name, workspaceId);
    this.writeTracks(id, ids);
    return this.getSet(workspaceId, id);
  }

  updateSet(
    workspaceId: string,
    id: string,
    input: { revision?: unknown; name?: unknown; trackIds?: unknown },
  ): SavedSet {
    const current = this.checkRevision(workspaceId, id, input.revision);
    const name = input.name === undefined ? current.name : validateName(input.name);
    const ids =
      input.trackIds === undefined
        ? current.trackIds
        : this.validateTracks(workspaceId, input.trackIds);
    this.database
      .prepare(
        "UPDATE set_drafts SET name = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ? AND workspace_id = ?",
      )
      .run(name, id, workspaceId);
    this.writeTracks(id, ids);
    return this.getSet(workspaceId, id);
  }

  deleteSet(workspaceId: string, id: string, revision: unknown): void {
    this.checkRevision(workspaceId, id, revision);
    this.database
      .prepare("DELETE FROM set_drafts WHERE id = ? AND workspace_id = ?")
      .run(id, workspaceId);
  }

  checkRevision(workspaceId: string, id: string, revision: unknown): SavedSet {
    const current = this.getSet(workspaceId, id);
    if (!Number.isSafeInteger(revision) || Number(revision) < 0)
      throw new PublicError(400, "A set revision is required.", "REVISION_REQUIRED");
    if (revision !== current.revision)
      throw new PublicError(
        409,
        "This set changed on another device. Your changes have been kept.",
        "REVISION_CONFLICT",
      );
    return current;
  }

  validateTracks(workspaceId: string, value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      value.length > this.config.tracksPerSet ||
      value.some((id) => typeof id !== "string" || id.length > 200)
    ) {
      throw new PublicError(
        400,
        `A set can contain up to ${this.config.tracksPerSet} track IDs.`,
        "TRACK_LIMIT",
        { limit: this.config.tracksPerSet },
      );
    }
    const published = this.publication();
    const owned = new Set(this.listSets(workspaceId).flatMap((set) => set.trackIds));
    if (value.some((id: string) => !published.has(id) && !owned.has(id)))
      throw new PublicError(
        400,
        "A track is not available in the public catalogue.",
        "TRACK_UNAVAILABLE",
      );
    return value as string[];
  }

  private writeTracks(setId: string, ids: readonly string[]): void {
    this.database.prepare("DELETE FROM set_draft_tracks WHERE set_draft_id = ?").run(setId);
    const insert = this.database.prepare(
      "INSERT INTO set_draft_tracks (set_draft_id, position, track_id) VALUES (?, ?, ?)",
    );
    ids.forEach((id, index) => insert.run(setId, index, id));
  }
}

function validateName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) {
    throw new PublicError(400, "Set name must contain 1–120 characters.", "SET_NAME_INVALID");
  }
  return value.trim();
}
