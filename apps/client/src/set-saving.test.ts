import assert from "node:assert/strict";
import test from "node:test";
import { SetSaveQueue } from "./set-saving.ts";
import { resolveSetRows } from "./set-rows.ts";

test("rapid saves use latest revision without stale responses replacing the UI", async () => {
  const queue = new SetSaveQueue();
  queue.remember("set", 0);
  const revisions: (number | undefined)[] = [];
  const applied: string[] = [];
  const first = queue.save(
    "set",
    async (revision) => {
      revisions.push(revision);
      return { revision: 1, name: "first" };
    },
    (result) => applied.push(result.name),
  );
  const second = queue.save(
    "set",
    async (revision) => {
      revisions.push(revision);
      return { revision: 2, name: "latest" };
    },
    (result) => applied.push(result.name),
  );
  await Promise.all([first, second]);
  assert.deepEqual(revisions, [0, 1]);
  assert.deepEqual(applied, ["latest"]);
});

test("failed saves stop dependent writes but other sets and explicit retry still work", async () => {
  const queue = new SetSaveQueue();
  let writes = 0;
  const failed = queue.save(
    "one",
    async () => {
      throw new Error("conflict");
    },
    () => assert.fail(),
  );
  const blocked = queue.save(
    "one",
    async () => {
      writes++;
      return { revision: 2 };
    },
    () => assert.fail(),
  );
  const other = queue.save(
    "two",
    async () => {
      writes++;
      return { revision: 1 };
    },
    () => {},
  );
  await assert.rejects(failed, /conflict/);
  await Promise.all([blocked, other]);
  assert.equal(writes, 1);
  queue.unblock("one");
  await queue.save(
    "one",
    async () => ({ revision: 3 }),
    () => writes++,
  );
  assert.equal(queue.revision("one"), 3);
  assert.equal(writes, 2);
});

test("withdrawn tracks preserve row positions and repeated IDs during remove/reorder", () => {
  const ids = ["a", "missing", "b", "a"];
  const rows = resolveSetRows(ids, [{ id: "a" }, { id: "b" }], (id) => ({ id }));
  assert.deepEqual(
    rows.map((r) => r.id),
    ids,
  );
  assert.deepEqual(
    ids.filter((_, index) => index !== 2),
    ["a", "missing", "a"],
  );
  const reordered = [...rows];
  reordered.splice(0, 0, reordered.splice(2, 1)[0]!);
  assert.deepEqual(
    reordered.map((r) => r.id),
    ["b", "a", "missing", "a"],
  );
});
