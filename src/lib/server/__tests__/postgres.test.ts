/**
 * Runs against a real Postgres when TEST_DATABASE_URL is set (it uses a fresh
 * schema and drops it afterwards); skipped otherwise.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { exampleApplications } from "../../permits/examples.ts";
import { connect, PostgresStore } from "../postgres.ts";

const url = process.env.TEST_DATABASE_URL;
const schema = `permits_test_${process.pid}`;
let store: PostgresStore;

before(async () => {
  if (!url) return;
  const admin = connect(url);
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  store = new PostgresStore(connect(`${url}${url.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`));
});

after(async () => {
  if (!url) return;
  await store.sql.end();
  const admin = connect(url);
  await admin.unsafe(`drop schema ${schema} cascade`);
  await admin.end();
});

test("applications round-trip, list by owner and newest first", { skip: !url }, async () => {
  const [a, b, c] = exampleApplications(Date.UTC(2026, 9, 9));
  await store.put(a);
  await store.put({ ...b, ownerId: "someone" });
  await store.put(c);
  assert.deepEqual(await store.get(a.ref), a);
  assert.equal(await store.get("MT-NOPE"), null);
  assert.deepEqual((await store.listAll()).map((x) => x.ref), [c, a, b].map((x) => x.ref));
  assert.deepEqual((await store.listByOwner("someone")).map((x) => x.ref), [b.ref]);

  await store.put({ ...a, status: "info", updatedAt: a.updatedAt + 1 });
  assert.equal((await store.get(a.ref))?.status, "info");
  await store.remove(a.ref);
  assert.equal(await store.get(a.ref), null);
});

test("rate limits count per window and reset in the next one", { skip: !url }, async () => {
  const t = 1_000_000;
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await store.allow("k", 3, 60_000, t + i));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(await store.allow("k", 3, 60_000, t + 60_000), true);
  assert.equal(await store.allow("other", 3, 60_000, t), true);
});
