// Always creates its own throwaway loopback database. No DATABASE_URL is read.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "onpar-shared-pg-"));
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const logs = [];
const database = new EmbeddedPostgres({
  databaseDir: path.join(directory, "db"), user: "postgres",
  password: randomBytes(32).toString("hex"), port, persistent: false,
  postgresFlags: ["-h", "127.0.0.1", "-k", directory, "-c", "max_connections=10"],
  onLog: (line) => logs.push(line), onError: (line) => logs.push(String(line)),
});
const clients = [];
let passed = 0;
const group = { group: "bowling", resourceIds: ["bowling-3", "bowling-4"],
  startsAt: "2026-10-21T20:00:00Z", endsAt: "2026-10-21T21:00:00Z" };
const identity = { ownerReference: "fictional-event", eventId: "event-1", kind: "event",
  approvalReference: "verified-decision-1", expectedRevision: 0,
  sourceRevisions: { "event-host": "r1", rexreplace: "r1", waitlist: "r1" } };
const request = (overrides = {}) => ({ ...identity, ...group, replaceClaimIds: [], ...overrides });
const mutation = (overrides = {}) => ({ ...identity, action: "replace", claims: [group], replaceClaimIds: [], ...overrides });
const rpc = async (client, action, key, data, writer = "final-call") =>
  (await client.query(`select shared_inventory_${action}($1,$2,$3::jsonb) result`, [writer, key, JSON.stringify(data)])).rows[0].result;
const observe = (promise) => promise.then(value => ({ value }), error => ({ error }));
try {
  await database.initialise();
  await database.start();
  for (let index = 0; index < 4; index++) {
    const client = database.getPgClient("postgres", "127.0.0.1");
    clients.push(client);
    await client.connect();
    await client.query("set statement_timeout='8s'");
    client.pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid;
  }
  const [admin, first, second, blocker] = clients;
  assert.equal(new Set(clients.map(c => c.pid)).size, 4, "must use separate database connections");
  console.log(`Isolated PostgreSQL ${(await admin.query("show server_version")).rows[0].server_version}; four separate connections`);
  await admin.query("create role anon; create role authenticated; create role service_role bypassrls; alter default privileges grant all on tables to service_role;");
  for (const name of [
    "20260729152402_entertainment_schedule.sql",
    "20261013182233_shared_reservation_authority.sql",
    "20261020175405_shared_reservation_lifecycle.sql",
  ]) await admin.query(await readFile(path.join(root, "supabase/migrations", name), "utf8"));

  const waitForLock = async (...waiting) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const rows = (await admin.query("select pid from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [waiting.map(c => c.pid)])).rows;
      if (rows.length === waiting.length) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("contenders did not reach the database lock");
  };
  const lock = async () => { await blocker.query("begin"); await blocker.query("select * from shared_inventory.control for update"); };
  const reset = async () => {
    for (const client of [first, second, blocker]) await client.query("rollback; reset role; reset lock_timeout");
    await admin.query(`truncate shared_inventory.operations,shared_inventory.claims;
      update shared_inventory.control set enabled=true,baseline_ready=true,revision=0;
      update shared_inventory.writers set enabled=true;
      insert into shared_inventory.checkpoints values
        ('event-host','r1',true,clock_timestamp(),'2026-10-01','2026-11-01'),
        ('rexreplace','r1',true,clock_timestamp(),'2026-10-01','2026-11-01'),
        ('waitlist','r1',true,clock_timestamp(),'2026-10-01','2026-11-01')
      on conflict(source) do update set checked_at=excluded.checked_at,complete=true,revision='r1';`);
  };
  const scenario = async (name, run) => { await reset(); await run(); console.log(`PASS ${name}`); passed++; };

  await scenario("competing applications serialize and cannot both secure the same revision", async () => {
    await lock();
    const a = observe(rpc(first, "claim", "race-event", request()));
    const b = observe(rpc(second, "claim", "race-walkin", request({ ownerReference: "walkin", eventId: null, kind: "walk-in" }), "waitlist"));
    await waitForLock(first, second);
    await blocker.query("commit");
    const results = await Promise.all([a, b]);
    assert.ok(results.every(r => !r.error));
    assert.deepEqual(results.map(r => r.value.status).sort(), ["secured", "unknown"]);
    assert.equal(results.find(r => r.value.status === "unknown").value.reason, "revision_changed");
    assert.equal((await admin.query("select count(*)::int n from shared_inventory.claims where active")).rows[0].n, 1);
    assert.equal((await rpc(second, "claim", "refreshed-competitor", request({ expectedRevision: 1 }))).status, "conflict");
  });
  await scenario("simultaneous duplicate keys create exactly one claim", async () => {
    await lock();
    const a = observe(rpc(first, "claim", "same-operation", request()));
    const b = observe(rpc(second, "claim", "same-operation", request()));
    await waitForLock(first, second);
    await blocker.query("commit");
    const results = await Promise.all([a, b]);
    assert.ok(results.every(r => !r.error));
    assert.deepEqual(results[0].value, results[1].value);
    assert.equal(results[0].value.status, "secured");
    assert.equal((await admin.query("select revision from shared_inventory.control")).rows[0].revision, "1");
  });
  await scenario("lock timeout leaves no accepted operation or partial claim", async () => {
    await lock();
    await first.query("set lock_timeout='200ms'");
    const call = observe(rpc(first, "claim", "timed-out-operation", request()));
    await waitForLock(first);
    const result = await call;
    assert.equal(result.error?.code, "55P03");
    await blocker.query("commit");
    assert.equal((await rpc(second, "operation", "timed-out-operation", request())).reason, "operation_not_found");
    assert.equal((await admin.query("select count(*)::int n from shared_inventory.claims")).rows[0].n, 0);
  });
  await scenario("lost response after commit can be recovered from another connection", async () => {
    const accepted = await rpc(first, "mutate", "lost-response", mutation());
    assert.equal(accepted.status, "applied");
    const recovered = await rpc(second, "operation", "lost-response", mutation());
    assert.deepEqual(recovered, accepted);
    assert.deepEqual(await rpc(second, "mutate", "lost-response", mutation()), accepted);
  });
  await scenario("rolled-back acceptance is never reported as committed", async () => {
    await first.query("begin");
    assert.equal((await rpc(first, "mutate", "rolled-back-operation", mutation())).status, "applied");
    assert.equal((await rpc(second, "operation", "rolled-back-operation", mutation())).reason, "operation_not_found");
    await first.query("rollback");
    assert.equal((await admin.query("select count(*)::int n from shared_inventory.claims")).rows[0].n, 0);
  });
  await scenario("checkout expiry is rechecked after waiting for the venue lock", async () => {
    const expiry = (await admin.query("select clock_timestamp()+interval '400 milliseconds' as expires")).rows[0].expires.toISOString();
    const held = await rpc(first, "claim", "short-lived-hold", request({ kind: "checkout-hold", eventId: null, expiresAt: expiry }), "rexreplace");
    await lock();
    const call = observe(rpc(second, "mutate", "expired-conversion", mutation({
      action: "convert", kind: "room-booking", eventId: null, expectedRevision: 1,
      replaceClaimIds: [held.claimId], confirmationReference: "verified-payment",
    }), "rexreplace"));
    await waitForLock(second);
    await admin.query("select pg_sleep(0.5)");
    await blocker.query("commit");
    assert.match((await call).error?.message ?? "", /ownership/);
    assert.equal((await rpc(first, "operation", "short-lived-hold", request({ kind: "checkout-hold", eventId: null, expiresAt: expiry }), "rexreplace")).reason, "claim_no_longer_active");
  });
  await scenario("source freshness is checked after the lock, using the database clock", async () => {
    await admin.query("update shared_inventory.checkpoints set checked_at=clock_timestamp()-interval '119.7 seconds' where source='waitlist'");
    await lock();
    const call = observe(rpc(first, "claim", "stale-during-wait", request()));
    await waitForLock(first);
    await admin.query("select pg_sleep(0.4)");
    await blocker.query("commit");
    assert.equal((await call).value.reason, "source_evidence_incomplete");
  });
  await scenario("conversion commits before cancellation can observe a stale hold", async () => {
    const expiry = new Date(Date.now() + 600000).toISOString();
    const held = await rpc(first, "claim", "checkout-hold", request({ kind: "checkout-hold", eventId: null, expiresAt: expiry }), "rexreplace");
    await first.query("begin");
    const converted = await rpc(first, "mutate", "paid-conversion", mutation({
      action: "convert", kind: "room-booking", eventId: null, expectedRevision: 1,
      replaceClaimIds: [held.claimId], confirmationReference: "verified-payment",
    }), "rexreplace");
    assert.equal(converted.status, "applied");
    const cancel = observe(rpc(second, "mutate", "late-cancellation", mutation({
      action: "release", kind: "checkout-hold", eventId: null, expectedRevision: 1, claims: [],
      replaceClaimIds: [held.claimId], confirmationReference: "verified-cancellation",
    }), "rexreplace"));
    await waitForLock(second);
    await first.query("commit");
    assert.equal((await cancel).value.reason, "revision_changed");
    assert.deepEqual((await admin.query("select kind,expires_at from shared_inventory.claims where active")).rows,
      [{ kind: "room-booking", expires_at: null }]);
  });
  await scenario("multi-group failure preserves original capacity and rolls back all intermediate claims", async () => {
    const old = await rpc(first, "mutate", "old-event", mutation());
    await rpc(second, "claim", "occupied-dart", request({ expectedRevision: 1, group: "darts", resourceIds: ["darts-2"], ownerReference: "another", eventId: "another" }));
    const result = await rpc(first, "mutate", "failed-batch", mutation({
      expectedRevision: 2, replaceClaimIds: [old.claims[0].claimId],
      claims: [{ ...group, resourceIds: ["bowling-8"] }, { ...group, group: "darts", resourceIds: ["darts-2"] }],
    }));
    assert.equal(result.status, "conflict");
    assert.deepEqual(await rpc(second, "operation", "old-event", mutation()), old);
    assert.equal((await admin.query("select count(*)::int n from shared_inventory.claims")).rows[0].n, 2);
  });
  await scenario("service caller works; browser roles cannot claim, mutate or read operation history", async () => {
    await first.query("set role service_role");
    assert.equal((await rpc(first, "mutate", "service-call", mutation())).status, "applied");
    for (const role of ["anon", "authenticated"]) {
      await second.query(`set role ${role}`);
      for (const action of ["claim", "mutate", "operation"]) {
        await assert.rejects(rpc(second, action, "browser-call", mutation()), { code: "42501" });
      }
    }
  });
  console.log(`${passed} real PostgreSQL scenarios passed. No external database used.`);
} catch (error) {
  console.error(error);
  if (!clients.length) console.error(logs.slice(-5).join("\n"));
  process.exitCode = 1;
} finally {
  // End blocked/aborted transactions before shutting down the isolated cluster.
  await Promise.allSettled(clients.map(async client => { await client.query("rollback").catch(() => {}); await client.end(); }));
  await database.stop();
  await rm(directory, { recursive: true, force: true });
}
