import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../db/migrations.ts";
import { createSqliteTrackRepository } from "../repositories/tracks.ts";
import { createServer } from "../server.ts";
import { readServerConfig } from "../config.ts";
import { WorkspaceStore, hashSecret } from "./store.ts";

const origin = "https://demo.example.test";
type Owner = {
  workspaceId: string;
  secret: string;
  csrfToken: string;
  cookie: string;
  set: { id: string; revision: number; trackIds: string[] };
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "djdesk-public-"));
  const databasePath = join(root, "data.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  await runMigrations(db);
  const repo = createSqliteTrackRepository(db);
  const track = await repo.createTrack({
    title: "Публичный трек",
    bpm: 100,
    comment: "Private operator note",
  });
  const metadata = await repo.createTrack({ title: "Metadata only" });
  const hidden = await repo.createTrack({ title: "Hidden" });
  const file = join(root, "private-original-name.mp3");
  await writeFile(file, "0123456789");
  for (const id of [track.id, metadata.id, hidden.id]) await repo.updateTrackAudioPath(id, file);
  db.prepare("INSERT INTO public_catalog (track_id, audio_enabled) VALUES (?, 1), (?, 0)").run(
    track.id,
    metadata.id,
  );
  const legacy = await repo.createSetDraft({ name: "Owner's existing set" });
  await repo.replaceSetDraftTracks(legacy.id, [track.id, track.id]);
  const config = readServerConfig({
    APP_MODE: "public",
    PUBLIC_ORIGIN: origin,
    DATABASE_PATH: databasePath,
  });
  const app = await createServer(config);
  async function owner(ip = "192.0.2.1"): Promise<Owner> {
    const response = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { origin },
      remoteAddress: ip,
      payload: { name: "My set", trackIds: [track.id] },
    });
    assert.equal(response.statusCode, 201, response.body);
    return { ...response.json(), cookie: String(response.headers["set-cookie"]).split(";")[0]! };
  }
  const headers = (access: Owner) => ({
    origin,
    cookie: access.cookie,
    "x-csrf-token": access.csrfToken,
  });
  return {
    app,
    db,
    root,
    databasePath,
    config,
    track,
    metadata,
    hidden,
    legacy,
    owner,
    headers,
    async close() {
      await app.close();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("public errors include stable codes and safe limits while retaining the legacy message", async () => {
  const f = await fixture();
  try {
    const missing = await f.app.inject({ url: "/api/sets" });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().code, "SESSION_REQUIRED");
    assert.equal(missing.json().message, "Open your secret access link to continue.");
    const access = await f.owner();
    const limit = await f.app.inject({
      method: "POST",
      url: "/api/sets",
      headers: f.headers(access),
      payload: { name: "Too many", trackIds: Array(301).fill(f.track.id) },
    });
    assert.equal(limit.statusCode, 400);
    assert.deepEqual(limit.json(), {
      code: "TRACK_LIMIT",
      params: { limit: 300 },
      message: "A set can contain up to 300 track IDs.",
    });
    const conflict = await f.app.inject({
      method: "PATCH",
      url: `/api/sets/${access.set.id}`,
      headers: f.headers(access),
      payload: { revision: 100, name: "Conflict", trackIds: [] },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, "REVISION_CONFLICT");
    assert.ok(!conflict.body.includes(f.root));
  } finally {
    await f.close();
  }
});

test("public catalogue is opt-in, strips private data and closes all operator routes", async () => {
  const f = await fixture();
  try {
    const response = await f.app.inject({ url: "/api/tracks" });
    assert.equal(response.statusCode, 200);
    const tracks = response.json().tracks;
    assert.deepEqual(
      new Set(tracks.map((t: { id: string }) => t.id)),
      new Set([f.track.id, f.metadata.id]),
    );
    assert.equal(tracks.find((t: { id: string }) => t.id === f.metadata.id).audioUrl, null);
    assert.doesNotMatch(response.body, /audioPath|private-original|Private operator|probe_error/);
    for (const [method, url] of [
      ["GET", "/api/audio-library"],
      ["POST", "/api/tracks"],
      ["PATCH", `/api/tracks/${f.track.id}/analysis`],
      ["POST", `/api/tracks/${f.track.id}/audio`],
      ["POST", `/api/tracks/${f.track.id}/retrievals`],
      ["GET", "/api/retrievals/x"],
    ] as const) {
      assert.equal((await f.app.inject({ method, url, headers: { origin } })).statusCode, 404, url);
    }
    assert.equal((await f.app.inject({ url: "/api/sets" })).statusCode, 401);
    assert.equal(
      (await f.app.inject({ url: `/api/tracks/${f.hidden.id}/harmony` })).statusCode,
      404,
    );
    for (const track of [f.hidden, f.metadata])
      assert.equal((await f.app.inject({ url: `/api/tracks/${track.id}/audio` })).statusCode, 404);
    const audio = await f.app.inject({
      url: `/api/tracks/${f.track.id}/audio?download=1`,
      headers: { range: "bytes=2-5" },
    });
    assert.equal(audio.statusCode, 206);
    assert.equal(audio.body, "2345");
    assert.match(String(audio.headers["content-disposition"]), /^attachment;/);
    assert.doesNotMatch(String(audio.headers["content-disposition"]), /private-original/);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/tracks/${f.track.id}/audio`,
          headers: { range: "bytes=100-" },
        })
      ).statusCode,
      416,
    );
    f.db.prepare("DELETE FROM public_catalog WHERE track_id = ?").run(f.track.id);
    assert.equal((await f.app.inject({ url: `/api/tracks/${f.track.id}/audio` })).statusCode, 404);
  } finally {
    await f.close();
  }
});

test("workspace isolation, cookie flags, cross-device access and access rotation", async () => {
  const f = await fixture();
  try {
    const a = await f.owner();
    const b = await f.owner();
    assert.equal(a.secret.length, 43);
    assert.match(a.cookie, /^__Host-djdesk=/);
    const stored = f.db
      .prepare("SELECT secret_hash FROM workspaces WHERE id = ?")
      .get(a.workspaceId) as { secret_hash: string };
    assert.equal(stored.secret_hash, hashSecret(a.secret));
    assert.notEqual(stored.secret_hash, a.secret);
    const aSets = await f.app.inject({ url: "/api/sets", headers: f.headers(a) });
    assert.deepEqual(
      aSets.json().sets.map((s: { id: string }) => s.id),
      [a.set.id],
    );
    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await f.app.inject({
        method,
        url: `/api/sets/${a.set.id}`,
        headers: f.headers(b),
        payload: { name: "stolen", revision: 0 },
      });
      assert.equal(response.statusCode, 404);
    }
    const exchange = await f.app.inject({
      method: "POST",
      url: "/api/session/exchange",
      headers: { origin },
      payload: { workspaceId: a.workspaceId, secret: a.secret },
    });
    assert.equal(exchange.statusCode, 200);
    assert.match(
      String(exchange.headers["set-cookie"]),
      /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/,
    );
    const cookie2 = String(exchange.headers["set-cookie"]).split(";")[0]!;
    assert.equal(
      (await f.app.inject({ url: "/api/sets", headers: { cookie: cookie2 } })).json().sets[0].id,
      a.set.id,
    );
    const rotated = await f.app.inject({
      method: "POST",
      url: "/api/workspace/rotate",
      headers: f.headers(a),
      payload: {},
    });
    assert.equal(rotated.statusCode, 200);
    for (const cookie of [a.cookie, cookie2])
      assert.equal((await f.app.inject({ url: "/api/sets", headers: { cookie } })).statusCode, 401);
    const current = String(rotated.headers["set-cookie"]).split(";")[0]!;
    assert.equal(
      (await f.app.inject({ url: "/api/sets", headers: { cookie: current } })).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/session/exchange",
          headers: { origin },
          payload: { workspaceId: a.workspaceId, secret: a.secret },
        })
      ).statusCode,
      401,
    );
    assert.equal((await f.app.inject({ url: "/api/sets", headers: f.headers(b) })).statusCode, 200);
  } finally {
    await f.close();
  }
});

test("cross-site writes and missing CSRF rejected; revisions preserve concurrent changes and duplicates", async () => {
  const f = await fixture();
  try {
    const a = await f.owner();
    const url = `/api/sets/${a.set.id}`;
    const payload = {
      name: "Changed",
      trackIds: [f.track.id, f.track.id, f.metadata.id],
      revision: 0,
    };
    for (const headers of [
      { cookie: a.cookie },
      { ...f.headers(a), origin: "https://attacker.test" },
      { origin, cookie: a.cookie },
    ]) {
      assert.equal(
        (await f.app.inject({ method: "PATCH", url, headers, payload })).statusCode,
        403,
      );
    }
    const saved = await f.app.inject({ method: "PATCH", url, headers: f.headers(a), payload });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().revision, 1);
    assert.deepEqual(saved.json().trackIds, payload.trackIds);
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url,
          headers: f.headers(a),
          payload: { ...payload, name: "Stale" },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url,
          headers: f.headers(a),
          payload: { revision: 0 },
        })
      ).statusCode,
      409,
    );
    f.db.prepare("DELETE FROM public_catalog WHERE track_id = ?").run(f.metadata.id);
    const retained = await f.app.inject({
      method: "PATCH",
      url,
      headers: f.headers(a),
      payload: { ...payload, revision: 1 },
    });
    assert.equal(retained.statusCode, 200, retained.body);
    const hidden = await f.app.inject({
      method: "PATCH",
      url,
      headers: f.headers(a),
      payload: { trackIds: [f.hidden.id], revision: 2 },
    });
    assert.equal(hidden.statusCode, 400);
    assert.equal(
      (await f.app.inject({ url: "/api/sets", headers: f.headers(a) })).json().sets[0].name,
      "Changed",
    );
  } finally {
    await f.close();
  }
});

test("quotas persist across restarts and consistent SQLite backup restores access and sets", async () => {
  const f = await fixture();
  try {
    const a = await f.owner();
    for (let i = 0; i < 4; i++) await f.owner();
    const denied = await f.app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { origin },
      remoteAddress: "192.0.2.1",
      payload: { name: "Too many" },
    });
    assert.equal(denied.statusCode, 429);
    const snapshotPath = join(f.root, "snapshot.sqlite");
    await backup(f.db, snapshotPath);
    const restored = await createServer({ ...f.config, databasePath: snapshotPath });
    try {
      const sets = await restored.inject({ url: "/api/sets", headers: f.headers(a) });
      assert.equal(sets.statusCode, 200);
      assert.deepEqual(sets.json().sets[0].trackIds, [f.track.id]);
      assert.equal(
        (
          await restored.inject({
            method: "POST",
            url: "/api/workspaces",
            headers: { origin },
            remoteAddress: "192.0.2.1",
            payload: { name: "Still denied" },
          })
        ).statusCode,
        429,
      );
    } finally {
      await restored.close();
    }
    const store = new WorkspaceStore(f.db, {
      ...f.config.public!,
      setsPerWorkspace: 1,
      tracksPerSet: 2,
    });
    assert.throws(
      () => store.transaction(() => store.createSet(a.workspaceId, { name: "Second" })),
      /set limit/,
    );
    assert.throws(
      () =>
        store.transaction(() =>
          store.updateSet(a.workspaceId, a.set.id, {
            revision: 0,
            trackIds: [f.track.id, f.track.id, f.track.id],
          }),
        ),
      /up to 2/,
    );
    f.db.prepare("UPDATE workspace_sessions SET expires_at = 0").run();
    assert.equal((await f.app.inject({ url: "/api/sets", headers: f.headers(a) })).statusCode, 401);
  } finally {
    await f.close();
  }
});

test("public configuration rejects unsafe origins and invalid limits", () => {
  for (const value of [
    "http://demo.test",
    "https://demo.test/path",
    "https://user:pass@demo.test",
  ]) {
    assert.throws(() => readServerConfig({ APP_MODE: "public", PUBLIC_ORIGIN: value }));
  }
  assert.throws(() => readServerConfig({ APP_MODE: "public" }));
  assert.throws(() => readServerConfig({ APP_MODE: "publik" }));
  assert.throws(() =>
    readServerConfig({ APP_MODE: "public", PUBLIC_ORIGIN: origin, PUBLIC_SETS_PER_WORKSPACE: "0" }),
  );
  assert.equal(
    readServerConfig({ APP_MODE: "public", PUBLIC_ORIGIN: "http://localhost:5173" }).host,
    "127.0.0.1",
  );
});
